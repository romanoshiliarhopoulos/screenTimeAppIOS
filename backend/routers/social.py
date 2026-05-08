"""
Social features router — gateway, shame (video + quick), lock, SOS,
wall of shame, streaks, morning pact, group stats, ghost mode, awards.
"""

import logging
import os
from datetime import datetime, timezone, timedelta, date as dt_date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Header, Query
from pydantic import BaseModel

from auth import get_uid
from firestore_client import db

router = APIRouter(tags=["social"])
logger = logging.getLogger(__name__)


# ── helpers ───────────────────────────────────────────────────────────

def _get_friend_ids(user_id: str) -> list[str]:
    groups = (
        db.collection("groups")
        .where("memberIds", "array_contains", user_id)
        .stream()
    )
    friend_ids: set[str] = set()
    for group in groups:
        for mid in group.to_dict().get("memberIds", []):
            if mid != user_id:
                friend_ids.add(mid)
    return list(friend_ids)


def _get_display_name(uid: str) -> str:
    doc = (
        db.collection("users").document(uid)
        .collection("profile").document("info").get()
    )
    return doc.to_dict().get("displayName", "A friend") if doc.exists else "A friend"


def _check_shortcut_key(x_api_key: Optional[str] = Header(None)):
    required = os.environ.get("SHORTCUT_API_KEY", "")
    if required and x_api_key != required:
        raise HTTPException(status_code=401, detail="Invalid API key")


def _today_str() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _parse_time(t: str) -> datetime:
    """Parse ISO timestamp (with or without Z) to datetime."""
    t = t.replace("Z", "+00:00")
    try:
        return datetime.fromisoformat(t)
    except ValueError:
        return datetime.now(timezone.utc)


# ══════════════════════════════════════════════════════════════════════
# 1. GATEWAY — called by Shortcuts on every app open
# ══════════════════════════════════════════════════════════════════════

@router.get("/api/gateway")
def gateway(
    userId: str = Query(...),
    app: str = Query(...),
    _: None = Depends(_check_shortcut_key),
):
    """
    The Shortcut calls this before opening any tracked app.
    Returns { action, ...params } to control what happens.
    Decision priority: shame_pending > block (lock) > block (quiet hours) > delay > allow.
    """
    now = datetime.now(timezone.utc)
    now_iso = now.isoformat()

    # ── 1. Check shame queue ──
    shame_docs = list(
        db.collection("shameQueue")
        .where("toUserId", "==", userId)
        .where("watched", "==", False)
        .limit(1)
        .stream()
    )
    if shame_docs:
        shame = shame_docs[0].to_dict()
        return {
            "action": "shame_pending",
            "shameId": shame_docs[0].id,
            "from": shame.get("fromName", "A friend"),
            "type": shame.get("type", "quick"),
            "reaction": shame.get("reaction"),
            "videoUrl": shame.get("videoUrl"),
            "message": f"{shame.get('fromName', 'A friend')} shamed you",
        }

    # ── 2. Check friend-triggered lock ──
    gw_doc = (
        db.collection("users").document(userId)
        .collection("gatewayState").document("current").get()
    )
    if gw_doc.exists:
        gw = gw_doc.to_dict()
        if gw.get("locked"):
            locked_until = _parse_time(gw.get("lockedUntil", ""))
            if locked_until > now:
                remaining = int((locked_until - now).total_seconds())
                return {
                    "action": "block",
                    "seconds": remaining,
                    "lockedBy": gw.get("lockedBy", "A friend"),
                    "message": f"{gw.get('lockedByName', 'A friend')} locked you out",
                }
            else:
                # Lock expired — clear it
                db.collection("users").document(userId).collection(
                    "gatewayState"
                ).document("current").update({"locked": False})

    # ── 3. Check ghost mode ──
    ghost_doc = (
        db.collection("users").document(userId)
        .collection("gatewayState").document("ghost").get()
    )
    ghost_active = False
    if ghost_doc.exists:
        gd = ghost_doc.to_dict()
        ghost_until = _parse_time(gd.get("until", ""))
        if ghost_until > now:
            ghost_active = True

    # ── 4. Load user settings ──
    settings_doc = (
        db.collection("users").document(userId)
        .collection("notificationSettings").document("config").get()
    )
    settings = settings_doc.to_dict() if settings_doc.exists else {}

    # ── 5. Check quiet hours ──
    quiet_start = settings.get("quietHoursStart")
    quiet_end = settings.get("quietHoursEnd")
    if quiet_start and quiet_end:
        try:
            h_now, m_now = now.hour, now.minute
            h_start, m_start = map(int, quiet_start.split(":"))
            h_end, m_end = map(int, quiet_end.split(":"))
            now_mins = h_now * 60 + m_now
            start_mins = h_start * 60 + m_start
            end_mins = h_end * 60 + m_end
            if start_mins > end_mins:
                # Wraps midnight
                in_quiet = now_mins >= start_mins or now_mins < end_mins
            else:
                in_quiet = start_mins <= now_mins < end_mins
            if in_quiet:
                return {
                    "action": "block",
                    "message": f"Quiet hours until {quiet_end}",
                }
        except (ValueError, AttributeError):
            pass

    # ── 6. Check daily open limits / delay escalation ──
    today = _today_str()
    summary_doc = (
        db.collection("users").document(userId)
        .collection("dailySummaries").document(today).get()
    )
    today_data = summary_doc.to_dict() if summary_doc.exists else {}

    # Count today's opens for this app from openCounts
    open_counts = today_data.get("openCounts", {})
    opens_today = open_counts.get(app, 0)

    # Increment open count
    new_count = opens_today + 1
    open_counts[app] = new_count
    if summary_doc.exists:
        db.collection("users").document(userId).collection(
            "dailySummaries"
        ).document(today).update({"openCounts": open_counts})
    else:
        db.collection("users").document(userId).collection(
            "dailySummaries"
        ).document(today).set({
            "date": today,
            "totalSeconds": 0,
            "sessionCount": 0,
            "byApp": {},
            "maxSessionSeconds": 0,
            "openCounts": open_counts,
        })

    # Delay escalation based on opens today
    delay = 0
    message = ""
    if new_count > 16:
        delay = 60
        message = f"You've opened {app} {new_count} times today"
        # Auto wall of shame
        _add_wall_of_shame(userId, "excessive_opens", {
            "appName": app,
            "openCount": new_count,
            "date": today,
        })
    elif new_count > 12:
        delay = 60
        message = f"You've opened {app} {new_count} times today"
    elif new_count > 8:
        delay = 30
        message = f"Opening #{new_count} today"
    elif new_count > 5:
        delay = 15
        message = f"Opening #{new_count} today"

    # Also check daily time limit
    daily_limits = settings.get("dailyLimits", {})
    app_limit = daily_limits.get(app, {})
    time_limit_secs = app_limit.get("minutes", 0) * 60 if isinstance(app_limit, dict) else 0
    if time_limit_secs > 0:
        app_seconds = today_data.get("byApp", {}).get(app, 0)
        if app_seconds >= time_limit_secs:
            delay = max(delay, 60)
            message = f"You've exceeded your {app} time limit"

    if delay > 0:
        return {
            "action": "delay",
            "seconds": delay,
            "opensToday": new_count,
            "message": message,
        }

    # ── 7. Allow ──
    return {"action": "allow", "opensToday": new_count}


# ══════════════════════════════════════════════════════════════════════
# 2. SHAME — enhanced with video + quick reactions
# ══════════════════════════════════════════════════════════════════════

class ShamePayload(BaseModel):
    type: str = "quick"  # "quick" or "video"
    reaction: Optional[str] = None  # emoji for quick shame
    videoUrl: Optional[str] = None  # URL for video shame
    message: Optional[str] = None


@router.post("/api/shame", status_code=201)
def send_shame(
    toUserId: str = Query(...),
    payload: Optional[ShamePayload] = None,
    uid: str = Depends(get_uid),
):
    """Send a shame to a friend. Supports quick (emoji) and video shame."""
    if payload is None:
        payload = ShamePayload()

    # Must be friends
    if toUserId not in _get_friend_ids(uid):
        raise HTTPException(status_code=403, detail="Not friends")

    # Check cooldown (15 min per friend)
    cooldown_cutoff = (
        datetime.now(timezone.utc) - timedelta(minutes=15)
    ).isoformat()
    recent = list(
        db.collection("shameQueue")
        .where("fromUserId", "==", uid)
        .where("toUserId", "==", toUserId)
        .where("createdAt", ">=", cooldown_cutoff)
        .limit(1)
        .stream()
    )
    if recent:
        return {"status": "cooldown", "message": "Wait before shaming again"}

    from_name = _get_display_name(uid)
    now = _now_iso()

    # Emergency shame check — once per day per pair
    is_emergency = payload.reaction == "emergency"
    if is_emergency:
        day_cutoff = (
            datetime.now(timezone.utc) - timedelta(hours=24)
        ).isoformat()
        emergency_recent = list(
            db.collection("shameQueue")
            .where("fromUserId", "==", uid)
            .where("toUserId", "==", toUserId)
            .where("reaction", "==", "emergency")
            .where("createdAt", ">=", day_cutoff)
            .limit(1)
            .stream()
        )
        if emergency_recent:
            return {"status": "cooldown", "message": "Emergency shame: once per day"}

    # Create shame document
    shame_ref = db.collection("shameQueue").document()
    shame_ref.set({
        "fromUserId": uid,
        "toUserId": toUserId,
        "fromName": from_name,
        "type": payload.type,
        "reaction": payload.reaction,
        "videoUrl": payload.videoUrl,
        "message": payload.message,
        "watched": False,
        "skipped": False,
        "createdAt": now,
    })

    # Also record in shameEvents for stats
    db.collection("shameEvents").add({
        "fromUserId": uid,
        "toUserId": toUserId,
        "type": payload.type,
        "sentAt": now,
    })

    # Send Bark/push notification
    _send_shame_notification(toUserId, from_name, is_emergency)

    # If emergency, also lock them for 60s
    if is_emergency:
        _lock_user(toUserId, uid, from_name, 60)

    return {"status": "sent", "shameId": shame_ref.id}


@router.post("/api/shame/{shame_id}/watched")
def mark_shame_watched(shame_id: str, uid: str = Depends(get_uid)):
    """Mark a shame as watched."""
    ref = db.collection("shameQueue").document(shame_id)
    doc = ref.get()
    if not doc.exists:
        raise HTTPException(status_code=404, detail="Shame not found")
    data = doc.to_dict()
    if data.get("toUserId") != uid:
        raise HTTPException(status_code=403, detail="Not your shame")
    ref.update({"watched": True, "watchedAt": _now_iso()})

    # Notify shamer
    from_id = data.get("fromUserId")
    if from_id:
        _send_notification_to_user(
            from_id,
            f"{_get_display_name(uid)} watched your shame",
            "They got the message",
        )
    return {"status": "ok"}


@router.post("/api/shame/{shame_id}/skipped")
def mark_shame_skipped(shame_id: str, uid: str = Depends(get_uid)):
    """Log a shame bypass — auto-added to wall of shame."""
    ref = db.collection("shameQueue").document(shame_id)
    doc = ref.get()
    if not doc.exists:
        raise HTTPException(status_code=404, detail="Shame not found")
    data = doc.to_dict()
    if data.get("toUserId") != uid:
        raise HTTPException(status_code=403, detail="Not your shame")
    ref.update({"skipped": True, "skippedAt": _now_iso()})

    _add_wall_of_shame(uid, "shame_bypass", {
        "fromName": data.get("fromName"),
        "shameType": data.get("type"),
    })
    return {"status": "ok"}


@router.get("/api/shame/pending")
def get_pending_shames(uid: str = Depends(get_uid)):
    """Get unwatched shames for the current user."""
    docs = list(
        db.collection("shameQueue")
        .where("toUserId", "==", uid)
        .where("watched", "==", False)
        .stream()
    )
    return [{"shameId": d.id, **d.to_dict()} for d in docs]


# ══════════════════════════════════════════════════════════════════════
# 3. LOCK — friend-triggered lockout
# ══════════════════════════════════════════════════════════════════════

class LockPayload(BaseModel):
    seconds: int = 60


@router.post("/api/lock/{target_user_id}")
def lock_user(target_user_id: str, payload: LockPayload = None, uid: str = Depends(get_uid)):
    """Lock a friend out of all tracked apps for N seconds."""
    if payload is None:
        payload = LockPayload()
    if target_user_id not in _get_friend_ids(uid):
        raise HTTPException(status_code=403, detail="Not friends")
    if payload.seconds > 300:
        raise HTTPException(status_code=400, detail="Max lock is 5 minutes")

    from_name = _get_display_name(uid)
    _lock_user(target_user_id, uid, from_name, payload.seconds)

    _send_notification_to_user(
        target_user_id,
        f"{from_name} locked you out",
        f"All apps blocked for {payload.seconds}s",
    )
    return {"status": "locked", "seconds": payload.seconds}


# ══════════════════════════════════════════════════════════════════════
# 4. SOS — rescue request
# ══════════════════════════════════════════════════════════════════════

@router.post("/api/sos")
def send_sos(uid: str = Depends(get_uid)):
    """User asks friends for help. Notifies group + self-locks for 15 min."""
    name = _get_display_name(uid)
    now = _now_iso()

    # Self-lock for 15 minutes
    _lock_user(uid, uid, name, 900)

    # Notify all friends
    for friend_id in _get_friend_ids(uid):
        _send_notification_to_user(
            friend_id,
            f"{name} needs rescuing",
            "Send them some support",
        )

    # Log SOS
    db.collection("users").document(uid).collection("sosEvents").add({
        "createdAt": now,
    })

    return {"status": "ok", "lockedSeconds": 900}


# ══════════════════════════════════════════════════════════════════════
# 5. GHOST MODE
# ══════════════════════════════════════════════════════════════════════

@router.post("/api/ghost-mode")
def activate_ghost_mode(uid: str = Depends(get_uid)):
    """Go invisible for 2 hours. Costs 1 streak day. Once per week."""
    now = datetime.now(timezone.utc)
    now_iso = now.isoformat()

    # Check weekly cooldown
    week_ago = (now - timedelta(days=7)).isoformat()
    ghost_doc = (
        db.collection("users").document(uid)
        .collection("gatewayState").document("ghost").get()
    )
    if ghost_doc.exists:
        gd = ghost_doc.to_dict()
        last_used = gd.get("lastUsed", "")
        if last_used > week_ago:
            return {"status": "cooldown", "message": "Ghost mode: once per week"}
        # Check if still active
        ghost_until = _parse_time(gd.get("until", ""))
        if ghost_until > now:
            return {"status": "already_active", "until": gd.get("until")}

    until = (now + timedelta(hours=2)).isoformat()
    db.collection("users").document(uid).collection(
        "gatewayState"
    ).document("ghost").set({
        "active": True,
        "until": until,
        "lastUsed": now_iso,
    })

    return {"status": "ok", "until": until}


# ══════════════════════════════════════════════════════════════════════
# 6. MORNING PACT
# ══════════════════════════════════════════════════════════════════════

class PactPayload(BaseModel):
    app: str
    maxOpens: int


@router.post("/api/pact")
def create_pact(payload: PactPayload, uid: str = Depends(get_uid)):
    """Set a daily pact: max opens for an app today."""
    today = _today_str()
    db.collection("users").document(uid).collection("pacts").document(today).set({
        "date": today,
        "app": payload.app,
        "maxOpens": payload.maxOpens,
        "createdAt": _now_iso(),
    }, merge=True)
    return {"status": "ok"}


@router.get("/api/pact")
def get_pact(uid: str = Depends(get_uid)):
    """Get today's pact."""
    today = _today_str()
    doc = (
        db.collection("users").document(uid)
        .collection("pacts").document(today).get()
    )
    if not doc.exists:
        return {"pact": None}
    return {"pact": doc.to_dict()}


# ══════════════════════════════════════════════════════════════════════
# 7. WALL OF SHAME
# ══════════════════════════════════════════════════════════════════════

@router.get("/api/wall-of-shame")
def get_wall_of_shame(uid: str = Depends(get_uid)):
    """Get wall of shame entries for all groups the user belongs to."""
    friend_ids = set(_get_friend_ids(uid))
    friend_ids.add(uid)

    entries = []
    for member_id in friend_ids:
        docs = list(
            db.collection("users").document(member_id)
            .collection("wallOfShame")
            .order_by("createdAt", direction="DESCENDING")
            .limit(10)
            .stream()
        )
        for d in docs:
            data = d.to_dict()
            data["id"] = d.id
            data["userId"] = member_id
            if "displayName" not in data:
                data["displayName"] = _get_display_name(member_id)
            entries.append(data)

    entries.sort(key=lambda x: x.get("createdAt", ""), reverse=True)
    return entries[:50]


# ══════════════════════════════════════════════════════════════════════
# 8. ENHANCED LIVE FRIENDS — replaces old endpoint
# ══════════════════════════════════════════════════════════════════════

@router.get("/api/friends/live")
def get_live_friends(uid: str = Depends(get_uid)):
    """
    Returns all friends with their live status, today's stats, streak info,
    and shame cooldown status. The primary data source for the home screen.
    """
    now = datetime.now(timezone.utc)
    today = _today_str()

    # Get all friend IDs
    groups_docs = list(
        db.collection("groups")
        .where("memberIds", "array_contains", uid)
        .stream()
    )
    friend_ids: set[str] = set()
    for group in groups_docs:
        for mid in group.to_dict().get("memberIds", []):
            if mid != uid:
                friend_ids.add(mid)

    friends = []
    for fid in friend_ids:
        # Profile
        profile_doc = (
            db.collection("users").document(fid)
            .collection("profile").document("info").get()
        )
        display_name = (
            profile_doc.to_dict().get("displayName", "Friend")
            if profile_doc.exists else "Friend"
        )

        # Ghost mode check
        ghost_doc = (
            db.collection("users").document(fid)
            .collection("gatewayState").document("ghost").get()
        )
        is_ghost = False
        if ghost_doc.exists:
            gd = ghost_doc.to_dict()
            ghost_until = _parse_time(gd.get("until", ""))
            if ghost_until > now:
                is_ghost = True

        # Privacy check
        friend_settings_doc = (
            db.collection("users").document(fid)
            .collection("notificationSettings").document("config").get()
        )
        friend_settings = friend_settings_doc.to_dict() if friend_settings_doc.exists else {}
        if not friend_settings.get("allowFriendsToSeeLiveSessions", True) or is_ghost:
            friends.append({
                "userId": fid,
                "displayName": display_name,
                "status": "offline" if is_ghost else "hidden",
                "isGhost": is_ghost,
            })
            continue

        # Active sessions
        active_docs = list(
            db.collection("activeSessions")
            .where("userId", "==", fid)
            .stream()
        )

        # Today's stats
        summary_doc = (
            db.collection("users").document(fid)
            .collection("dailySummaries").document(today).get()
        )
        today_stats = summary_doc.to_dict() if summary_doc.exists else {}

        # Streak
        streak_doc = (
            db.collection("users").document(fid)
            .collection("streaks").document("current").get()
        )
        streak = streak_doc.to_dict() if streak_doc.exists else {}

        # Shame cooldown check
        cooldown_cutoff = (now - timedelta(minutes=15)).isoformat()
        shame_recent = list(
            db.collection("shameQueue")
            .where("fromUserId", "==", uid)
            .where("toUserId", "==", fid)
            .where("createdAt", ">=", cooldown_cutoff)
            .limit(1)
            .stream()
        )
        can_shame = len(shame_recent) == 0
        shame_cooldown_until = None
        if not can_shame and shame_recent:
            shame_time = _parse_time(shame_recent[0].to_dict().get("createdAt", ""))
            shame_cooldown_until = (shame_time + timedelta(minutes=15)).isoformat()

        # Determine status
        status = "offline"
        current_app = None
        session_start = None
        session_minutes = 0
        last_seen_mins_ago = None

        if active_docs:
            latest = max(active_docs, key=lambda d: d.to_dict().get("openTime", ""))
            session_data = latest.to_dict()
            current_app = session_data.get("appName")
            session_start = session_data.get("openTime")
            open_dt = _parse_time(session_start)
            session_minutes = int((now - open_dt).total_seconds() / 60)
            status = "live"
        else:
            total_today = today_stats.get("totalSeconds", 0)
            if total_today > 0:
                status = "recent"
                last_seen_raw = today_stats.get("lastSeenAt")
                if last_seen_raw:
                    try:
                        last_seen_dt = _parse_time(last_seen_raw)
                        last_seen_mins_ago = max(0, int((now - last_seen_dt).total_seconds() / 60))
                    except Exception:
                        pass

        # Daily limit info
        daily_cap = friend_settings.get("dailyCapSeconds", 3600)
        total_today_secs = today_stats.get("totalSeconds", 0)
        daily_pct = min(100, int((total_today_secs / daily_cap * 100) if daily_cap > 0 else 0))
        open_counts = today_stats.get("openCounts", {})
        total_opens = sum(open_counts.values())

        friends.append({
            "userId": fid,
            "displayName": display_name,
            "status": status,
            "currentApp": current_app,
            "sessionStart": session_start,
            "sessionMinutes": session_minutes,
            "lastSeenMinsAgo": last_seen_mins_ago,
            "totalTodaySeconds": total_today_secs,
            "dailyLimitPct": daily_pct,
            "totalOpens": total_opens,
            "streakDays": streak.get("current", 0),
            "canShame": can_shame,
            "shameCooldownUntil": shame_cooldown_until,
            "isGhost": is_ghost,
        })

    # Sort: live first, then recent, then offline
    status_order = {"live": 0, "recent": 1, "offline": 2, "hidden": 3}
    friends.sort(key=lambda f: (status_order.get(f["status"], 9), f.get("displayName", "")))

    # Also include current user's own stats
    my_summary_doc = (
        db.collection("users").document(uid)
        .collection("dailySummaries").document(today).get()
    )
    my_stats = my_summary_doc.to_dict() if my_summary_doc.exists else {}
    my_settings_doc = (
        db.collection("users").document(uid)
        .collection("notificationSettings").document("config").get()
    )
    my_settings = my_settings_doc.to_dict() if my_settings_doc.exists else {}
    my_cap = my_settings.get("dailyCapSeconds", 3600)
    my_total = my_stats.get("totalSeconds", 0)

    my_active = list(
        db.collection("activeSessions")
        .where("userId", "==", uid)
        .stream()
    )
    my_current_app = None
    my_session_minutes = 0
    if my_active:
        latest = max(my_active, key=lambda d: d.to_dict().get("openTime", ""))
        sd = latest.to_dict()
        my_current_app = sd.get("appName")
        my_session_minutes = int((now - _parse_time(sd.get("openTime", ""))).total_seconds() / 60)

    yesterday_str = (now.date() - timedelta(days=1)).isoformat()
    my_yesterday_doc = (
        db.collection("users").document(uid)
        .collection("dailySummaries").document(yesterday_str).get()
    )
    my_yesterday = my_yesterday_doc.to_dict() if my_yesterday_doc.exists else {}

    me = {
        "userId": uid,
        "totalTodaySeconds": my_total,
        "dailyLimitPct": min(100, int((my_total / my_cap * 100) if my_cap > 0 else 0)),
        "totalOpens": sum(my_stats.get("openCounts", {}).values()),
        "currentApp": my_current_app,
        "sessionMinutes": my_session_minutes,
        "yesterdaySeconds": my_yesterday.get("totalSeconds", 0),
        "yesterdayOpens": sum(my_yesterday.get("openCounts", {}).values()),
    }

    return {"friends": friends, "me": me}


# ══════════════════════════════════════════════════════════════════════
# 9. GROUP STATS — comparative leaderboard + per-app breakdown
# ══════════════════════════════════════════════════════════════════════

@router.get("/api/stats/group")
def get_group_stats(
    days: int = Query(7, description="Number of days to aggregate"),
    uid: str = Depends(get_uid),
):
    """
    Comparative group stats: leaderboard, per-app breakdown, streaks.
    Aggregates across all groups the user belongs to.
    """
    today = dt_date.today()
    dates = [(today - timedelta(days=i)).isoformat() for i in range(days)]

    # Get all members across groups
    groups_docs = list(
        db.collection("groups")
        .where("memberIds", "array_contains", uid)
        .stream()
    )
    all_member_ids: set[str] = set()
    for group in groups_docs:
        for mid in group.to_dict().get("memberIds", []):
            all_member_ids.add(mid)

    # Collect stats for each member
    members = []
    for mid in all_member_ids:
        display_name = _get_display_name(mid)
        total_seconds = 0
        by_app: dict[str, int] = {}
        session_count = 0

        for date_str in dates:
            doc = (
                db.collection("users").document(mid)
                .collection("dailySummaries").document(date_str).get()
            )
            if doc.exists:
                data = doc.to_dict()
                total_seconds += data.get("totalSeconds", 0)
                session_count += data.get("sessionCount", 0)
                for app, secs in data.get("byApp", {}).items():
                    by_app[app] = by_app.get(app, 0) + secs

        avg_per_day = total_seconds / days if days > 0 else 0

        # Streak
        streak_doc = (
            db.collection("users").document(mid)
            .collection("streaks").document("current").get()
        )
        streak = streak_doc.to_dict() if streak_doc.exists else {}

        # Shame counts
        shames_sent = len(list(
            db.collection("shameEvents")
            .where("fromUserId", "==", mid)
            .limit(100)
            .stream()
        ))
        shames_received = len(list(
            db.collection("shameEvents")
            .where("toUserId", "==", mid)
            .limit(100)
            .stream()
        ))

        members.append({
            "userId": mid,
            "displayName": display_name,
            "isYou": mid == uid,
            "totalSeconds": total_seconds,
            "avgPerDay": int(avg_per_day),
            "sessionCount": session_count,
            "byApp": by_app,
            "streakDays": streak.get("current", 0),
            "longestStreak": streak.get("longest", 0),
            "shamesSent": shames_sent,
            "shamesReceived": shames_received,
        })

    # Sort by least total time (ascending = best)
    members.sort(key=lambda m: m["totalSeconds"])
    for i, m in enumerate(members):
        m["rank"] = i + 1

    # Group averages
    group_avg = (
        sum(m["avgPerDay"] for m in members) / len(members) if members else 0
    )

    # Per-app averages
    all_apps: set[str] = set()
    for m in members:
        all_apps.update(m["byApp"].keys())

    app_stats = {}
    for app in all_apps:
        app_totals = [m["byApp"].get(app, 0) for m in members]
        app_stats[app] = {
            "groupAvg": int(sum(app_totals) / len(app_totals)) if app_totals else 0,
            "best": min(app_totals) if app_totals else 0,
            "worst": max(app_totals) if app_totals else 0,
            "members": [
                {
                    "userId": m["userId"],
                    "displayName": m["displayName"],
                    "isYou": m["isYou"],
                    "seconds": m["byApp"].get(app, 0),
                }
                for m in sorted(members, key=lambda x: x["byApp"].get(app, 0))
            ],
        }

    return {
        "days": days,
        "groupAvgPerDay": int(group_avg),
        "leaderboard": members,
        "appStats": app_stats,
    }


# ══════════════════════════════════════════════════════════════════════
# 10. STREAKS — update on session close
# ══════════════════════════════════════════════════════════════════════

@router.get("/api/streaks")
def get_streaks(uid: str = Depends(get_uid)):
    """Get current user's streak info."""
    doc = (
        db.collection("users").document(uid)
        .collection("streaks").document("current").get()
    )
    if not doc.exists:
        return {"current": 0, "longest": 0, "lastDate": None}
    return doc.to_dict()


# ══════════════════════════════════════════════════════════════════════
# 11. MONTHLY AWARDS
# ══════════════════════════════════════════════════════════════════════

@router.get("/api/awards/monthly")
def get_monthly_awards(
    month: Optional[str] = Query(None, description="YYYY-MM, defaults to current"),
    uid: str = Depends(get_uid),
):
    """Compute and return monthly awards for the group."""
    if not month:
        month = datetime.now(timezone.utc).strftime("%Y-%m")

    year, mo = map(int, month.split("-"))
    # Get all days in the month
    import calendar
    num_days = calendar.monthrange(year, mo)[1]
    dates = [f"{month}-{str(d).zfill(2)}" for d in range(1, num_days + 1)]

    # Get group members
    all_member_ids: set[str] = set()
    groups_docs = list(
        db.collection("groups")
        .where("memberIds", "array_contains", uid)
        .stream()
    )
    for group in groups_docs:
        for mid in group.to_dict().get("memberIds", []):
            all_member_ids.add(mid)

    # Compute per-member stats
    member_stats = {}
    for mid in all_member_ids:
        name = _get_display_name(mid)
        total_opens = 0
        total_seconds = 0
        shames_sent = 0
        shames_received = 0

        for date_str in dates:
            doc = (
                db.collection("users").document(mid)
                .collection("dailySummaries").document(date_str).get()
            )
            if doc.exists:
                data = doc.to_dict()
                total_seconds += data.get("totalSeconds", 0)
                total_opens += sum(data.get("openCounts", {}).values())

        # Shame counts for the month
        month_start = f"{month}-01T00:00:00"
        month_end = f"{month}-{str(num_days).zfill(2)}T23:59:59"
        sent = list(
            db.collection("shameEvents")
            .where("fromUserId", "==", mid)
            .where("sentAt", ">=", month_start)
            .where("sentAt", "<=", month_end)
            .stream()
        )
        recv = list(
            db.collection("shameEvents")
            .where("toUserId", "==", mid)
            .where("sentAt", ">=", month_start)
            .where("sentAt", "<=", month_end)
            .stream()
        )

        streak_doc = (
            db.collection("users").document(mid)
            .collection("streaks").document("current").get()
        )
        streak = streak_doc.to_dict() if streak_doc.exists else {}

        member_stats[mid] = {
            "displayName": name,
            "isYou": mid == uid,
            "totalOpens": total_opens,
            "totalSeconds": total_seconds,
            "shamesSent": len(sent),
            "shamesReceived": len(recv),
            "longestStreak": streak.get("longest", 0),
        }

    if not member_stats:
        return {"month": month, "awards": []}

    awards = []

    # Iron Will — fewest total opens
    iron_will = min(member_stats.items(), key=lambda x: x[1]["totalOpens"])
    awards.append({
        "award": "Iron Will",
        "emoji": "trophy",
        "description": "Fewest total opens",
        "userId": iron_will[0],
        "displayName": iron_will[1]["displayName"],
        "value": iron_will[1]["totalOpens"],
    })

    # Town Sheriff — most shames sent
    sheriff = max(member_stats.items(), key=lambda x: x[1]["shamesSent"])
    awards.append({
        "award": "Town Sheriff",
        "emoji": "angry",
        "description": "Most shames sent",
        "userId": sheriff[0],
        "displayName": sheriff[1]["displayName"],
        "value": sheriff[1]["shamesSent"],
    })

    # Untouchable — longest streak
    untouchable = max(member_stats.items(), key=lambda x: x[1]["longestStreak"])
    awards.append({
        "award": "Untouchable",
        "emoji": "fire",
        "description": "Longest streak",
        "userId": untouchable[0],
        "displayName": untouchable[1]["displayName"],
        "value": untouchable[1]["longestStreak"],
    })

    # Wall of Famer — most shames received
    wof = max(member_stats.items(), key=lambda x: x[1]["shamesReceived"])
    awards.append({
        "award": "Wall of Famer",
        "emoji": "skull",
        "description": "Most shames received",
        "userId": wof[0],
        "displayName": wof[1]["displayName"],
        "value": wof[1]["shamesReceived"],
    })

    return {"month": month, "awards": awards}


# ══════════════════════════════════════════════════════════════════════
# 12. INTENT LOGGING
# ══════════════════════════════════════════════════════════════════════

class IntentPayload(BaseModel):
    app: str
    text: str


@router.post("/api/intent")
def log_intent(payload: IntentPayload, uid: str = Depends(get_uid)):
    """Log what the user says they're opening the app for."""
    db.collection("users").document(uid).collection("intents").add({
        "app": payload.app,
        "text": payload.text[:100],  # cap at 100 chars
        "createdAt": _now_iso(),
    })
    return {"status": "ok"}


@router.get("/api/intent/analysis")
def get_intent_analysis(uid: str = Depends(get_uid)):
    """Analyze logged intents — group by common phrases."""
    docs = list(
        db.collection("users").document(uid)
        .collection("intents")
        .order_by("createdAt", direction="DESCENDING")
        .limit(200)
        .stream()
    )
    intents = [d.to_dict() for d in docs]
    if not intents:
        return {"total": 0, "breakdown": []}

    # Simple grouping by text
    counts: dict[str, int] = {}
    for intent in intents:
        text = intent.get("text", "").lower().strip()
        counts[text] = counts.get(text, 0) + 1

    total = len(intents)
    breakdown = [
        {"text": text, "count": count, "pct": int(count / total * 100)}
        for text, count in sorted(counts.items(), key=lambda x: -x[1])
    ][:10]

    return {"total": total, "breakdown": breakdown}


# ══════════════════════════════════════════════════════════════════════
# INTERNAL HELPERS
# ══════════════════════════════════════════════════════════════════════

def _lock_user(target_id: str, locker_id: str, locker_name: str, seconds: int):
    until = (datetime.now(timezone.utc) + timedelta(seconds=seconds)).isoformat()
    db.collection("users").document(target_id).collection(
        "gatewayState"
    ).document("current").set({
        "locked": True,
        "lockedUntil": until,
        "lockedBy": locker_id,
        "lockedByName": locker_name,
        "lockedAt": _now_iso(),
    })


def _add_wall_of_shame(user_id: str, shame_type: str, detail: dict):
    name = _get_display_name(user_id)
    db.collection("users").document(user_id).collection("wallOfShame").add({
        "type": shame_type,
        "displayName": name,
        "detail": detail,
        "createdAt": _now_iso(),
    })


def _send_notification_to_user(user_id: str, title: str, body: str):
    """Best-effort push notification to a user."""
    try:
        from services.notification import push_token_repository, sender
        tokens = push_token_repository.get_tokens_for_user(user_id)
        if tokens:
            sender.send(tokens[0], title, body)
    except Exception as e:
        logger.warning("Failed to send notification to %s: %s", user_id, e)


def _send_shame_notification(user_id: str, from_name: str, is_emergency: bool):
    """Send shame notification — uses Bark for emergency (louder)."""
    title = f"{from_name} shamed you" if not is_emergency else f"EMERGENCY: {from_name} shamed you"
    body = "Watch before you scroll" if not is_emergency else "GET OFF YOUR PHONE"
    _send_notification_to_user(user_id, title, body)


def update_streak(user_id: str):
    """Called after session close. Updates streak based on daily limit compliance."""
    today = _today_str()
    yesterday = (dt_date.today() - timedelta(days=1)).isoformat()

    # Load settings for daily cap
    settings_doc = (
        db.collection("users").document(user_id)
        .collection("notificationSettings").document("config").get()
    )
    settings = settings_doc.to_dict() if settings_doc.exists else {}
    daily_cap = settings.get("dailyCapSeconds", 3600)

    # Load today's summary
    summary_doc = (
        db.collection("users").document(user_id)
        .collection("dailySummaries").document(today).get()
    )
    today_total = 0
    if summary_doc.exists:
        today_total = summary_doc.to_dict().get("totalSeconds", 0)

    # Load current streak
    streak_ref = db.collection("users").document(user_id).collection("streaks").document("current")
    streak_doc = streak_ref.get()
    streak = streak_doc.to_dict() if streak_doc.exists else {"current": 0, "longest": 0, "lastDate": None}

    if today_total <= daily_cap:
        # Under limit — maintain/extend streak
        if streak.get("lastDate") == yesterday:
            new_current = streak.get("current", 0) + 1
        elif streak.get("lastDate") == today:
            new_current = streak.get("current", 0)
        else:
            new_current = 1

        new_longest = max(streak.get("longest", 0), new_current)
        streak_ref.set({
            "current": new_current,
            "longest": new_longest,
            "lastDate": today,
        })
    else:
        # Over limit — break streak if it was active
        if streak.get("current", 0) > 0 and streak.get("lastDate") != today:
            old_streak = streak.get("current", 0)
            streak_ref.set({
                "current": 0,
                "longest": streak.get("longest", 0),
                "lastDate": today,
                "brokenAt": _now_iso(),
            })
            # Wall of shame if streak was 7+
            if old_streak >= 7:
                _add_wall_of_shame(user_id, "streak_broken", {
                    "streakDays": old_streak,
                })
