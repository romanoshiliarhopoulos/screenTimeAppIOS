"""
Social features router — gateway, shame (video + quick), lock, SOS,
wall of shame, streaks, morning pact, group stats, ghost mode, awards.
"""

import logging
import os
from datetime import datetime, timezone, timedelta, date as dt_date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Header, Query
from google.cloud.firestore_v1.base_query import FieldFilter
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


def _parse_time(t) -> datetime:
    """Parse ISO timestamp string or Firestore Timestamp to aware datetime."""
    if isinstance(t, datetime):
        return t if t.tzinfo else t.replace(tzinfo=timezone.utc)
    try:
        return datetime.fromisoformat(str(t).replace("Z", "+00:00"))
    except (ValueError, TypeError):
        return datetime.now(timezone.utc)


# ══════════════════════════════════════════════════════════════════════
# 1. GATEWAY — called by Shortcuts on every app open
# ══════════════════════════════════════════════════════════════════════

@router.get("/api/gateway")
def gateway(
    userId: str = Query(...),
    _: None = Depends(_check_shortcut_key),
):
    """
    Called by Shortcuts before opening any tracked app.
    Checks global lock and pending shames. No app param needed.
    Returns { action: "allow" | "block" | "shame_pending", message? }
    """
    now = datetime.now(timezone.utc)

    # ── 1. Check global lock ──
    gw_doc = (
        db.collection("users").document(userId)
        .collection("gatewayState").document("current").get()
    )
    if gw_doc.exists:
        gw = gw_doc.to_dict()
        if gw.get("locked"):
            locked_until = _parse_time(gw.get("lockedUntil", ""))
            if locked_until > now:
                until_str = locked_until.strftime("%-I:%M %p")
                return {"action": "block", "allowed": False, "message": f"Locked until {until_str}"}
            else:
                # Lock expired — clear it
                gw_doc.reference.update({"locked": False})
                db.collection("users").document(userId).set(
                    {"locked": False, "lockedUntil": None}, merge=True
                )

    # ── 2. Check shame queue ──
    shame_docs = list(
        db.collection("shameQueue")
        .where(filter=FieldFilter("toUserId", "==", userId))
        .where(filter=FieldFilter("watched", "==", False))
        .limit(1)
        .stream()
    )
    if shame_docs:
        shame = shame_docs[0].to_dict()
        return {
            "action": "shame_pending",
            "allowed": False,
            "shameId": shame_docs[0].id,
            "from": shame.get("fromName", "A friend"),
            "type": shame.get("type", "quick"),
            "reaction": shame.get("reaction"),
            "videoUrl": shame.get("videoUrl"),
            "message": f"{shame.get('fromName', 'A friend')} shamed you",
        }

    return {"action": "allow", "allowed": True}


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

    # Check shame eligibility: friend must be live 5+ min OR in break window (≤5 min gap, 5+ min scrolled today)
    _now = datetime.now(timezone.utc)
    _BREAK_TOLERANCE = 5
    _MIN_SCROLLING = 5
    _target_active = list(
        db.collection("activeSessions")
        .where(filter=FieldFilter("userId", "==", toUserId))
        .stream()
    )
    _today = _now.date().isoformat()
    _summary = db.collection("users").document(toUserId).collection("dailySummaries").document(_today).get()
    _target_stats = _summary.to_dict() if _summary.exists else {}
    _eligible = False
    if _target_active:
        _eligible = True
    else:
        _last_seen_raw = _target_stats.get("lastSeenAt")
        _total_secs = _target_stats.get("totalSeconds", 0)
        if _last_seen_raw and _total_secs >= _MIN_SCROLLING * 60:
            try:
                _last_dt = _parse_time(_last_seen_raw)
                if (_now - _last_dt).total_seconds() / 60 <= _BREAK_TOLERANCE:
                    _eligible = True
            except Exception:
                pass
    if not _eligible:
        raise HTTPException(status_code=422, detail="Friend hasn't been scrolling enough to shame")

    # # Check cooldown (15 min per friend) — disabled for testing
    # cooldown_cutoff = (
    #     datetime.now(timezone.utc) - timedelta(minutes=15)
    # ).isoformat()
    # recent = list(
    #     db.collection("shameQueue")
    #     .where(filter=FieldFilter("fromUserId", "==", uid))
    #     .where(filter=FieldFilter("toUserId", "==", toUserId))
    #     .where(filter=FieldFilter("createdAt", ">=", cooldown_cutoff))
    #     .limit(1)
    #     .stream()
    # )
    # if recent:
    #     return {"status": "cooldown", "message": "Wait before shaming again"}

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
            .where(filter=FieldFilter("fromUserId", "==", uid))
            .where(filter=FieldFilter("toUserId", "==", toUserId))
            .where(filter=FieldFilter("reaction", "==", "emergency"))
            .where(filter=FieldFilter("createdAt", ">=", day_cutoff))
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
    _send_shame_notification(toUserId, from_name, is_emergency, payload)

    # All shames trigger a lock — emergency is longer
    lock_seconds = 300 if is_emergency else 120
    _lock_user(toUserId, uid, from_name, lock_seconds)

    return {"status": "sent", "shameId": shame_ref.id}


@router.post("/api/shame/video-upload-url")
def get_video_upload_url(uid: str = Depends(get_uid)):
    """
    Returns a V4 signed PUT URL so the client can upload a shame video
    directly to Firebase Storage without storing service-account credentials
    in the app. Also returns the final public download URL.
    """
    import uuid
    from datetime import timedelta
    import firebase_admin.storage

    file_id = str(uuid.uuid4())
    blob_path = f"shameVideos/{uid}/{file_id}.mp4"

    try:
        bucket = firebase_admin.storage.bucket()
        if not bucket.name:
            raise ValueError("no bucket")
    except Exception:
        raise HTTPException(
            status_code=503,
            detail="Storage not configured. Set FIREBASE_STORAGE_BUCKET on the server.",
        )

    blob = bucket.blob(blob_path)
    upload_url = blob.generate_signed_url(
        expiration=timedelta(minutes=15),
        method="PUT",
        content_type="video/mp4",
        version="v4",
    )

    encoded_path = blob_path.replace("/", "%2F")
    video_url = (
        f"https://firebasestorage.googleapis.com/v0/b/{bucket.name}"
        f"/o/{encoded_path}?alt=media"
    )
    return {"uploadUrl": upload_url, "videoUrl": video_url}


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
        .where(filter=FieldFilter("toUserId", "==", uid))
        .where(filter=FieldFilter("watched", "==", False))
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
# 4b. SELF-LOCK — user locks themselves out for 15 minutes
# ══════════════════════════════════════════════════════════════════════

@router.post("/api/self-lock")
def self_lock(uid: str = Depends(get_uid)):
    """Lock yourself out of all social apps for 15 minutes."""
    name = _get_display_name(uid)
    _lock_user(uid, uid, name, 900)
    until = (datetime.now(timezone.utc) + timedelta(seconds=900)).isoformat()
    return {"status": "ok", "lockedUntil": until}


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
# 7. WALL OF SHAME + SOCIAL FEED
# ══════════════════════════════════════════════════════════════════════


_REACTION_EMOJI_MAP = {
    "angry": "😤",
    "facepalm": "🤦",
    "eyes": "👀",
    "emergency": "🚨",
}


@router.get("/api/feed")
def get_feed(uid: str = Depends(get_uid)):
    """
    Unified social feed: direct shame events (with reactions/messages/video)
    merged with wall-of-shame behavioral events, sorted newest first.
    Optimised: 2 shameQueue `in` queries instead of 2N per-friend queries.
    """
    friend_ids = set(_get_friend_ids(uid))
    friend_ids.add(uid)
    friend_list = list(friend_ids)
    cutoff = (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()

    # Batch-fetch all display names in one round trip
    profile_refs = [
        db.collection("users").document(fid).collection("profile").document("info")
        for fid in friend_ids
    ]
    names: dict[str, str] = {}
    for doc in db.get_all(profile_refs):
        if doc.exists:
            uid_key = doc.reference.path.split("/")[1]
            names[uid_key] = doc.to_dict().get("displayName", "Someone")

    items: list[dict] = []
    seen_ids: set[str] = set()

    # ── 1. shameQueue: 2 `in` queries (from OR to) instead of 2N ──
    for field in ("fromUserId", "toUserId"):
        for i in range(0, len(friend_list), 30):
            chunk = friend_list[i:i + 30]
            try:
                for d in (
                    db.collection("shameQueue")
                    .where(filter=FieldFilter(field, "in", chunk))
                    .limit(50)
                    .stream()
                ):
                    if d.id in seen_ids:
                        continue
                    data = d.to_dict()
                    from_id = data.get("fromUserId", "")
                    to_id = data.get("toUserId", "")
                    if from_id not in friend_ids or to_id not in friend_ids:
                        continue
                    created = data.get("createdAt", "")
                    if created < cutoff:
                        continue
                    reaction_raw = data.get("reaction") or ""
                    seen_ids.add(d.id)
                    items.append({
                        "id": d.id,
                        "kind": "shame",
                        "fromUserId": from_id,
                        "fromName": names.get(from_id, data.get("fromName", "Someone")),
                        "toUserId": to_id,
                        "toName": names.get(to_id, "someone"),
                        "reaction": _REACTION_EMOJI_MAP.get(reaction_raw, reaction_raw),
                        "message": data.get("message"),
                        "videoUrl": data.get("videoUrl"),
                        "shameType": data.get("type", "quick"),
                        "reactions": data.get("reactions", {}),
                        "createdAt": created,
                    })
            except Exception as e:
                logger.warning("Feed shame query failed (%s): %s", field, e)

    # ── 2. wallOfShame: subcollections can't use `in`, still N queries ──
    for fid in friend_ids:
        try:
            for d in (
                db.collection("users").document(fid)
                .collection("wallOfShame")
                .order_by("createdAt", direction="DESCENDING")
                .limit(5)
                .stream()
            ):
                if d.id in seen_ids:
                    continue
                data = d.to_dict()
                created = data.get("createdAt", "")
                if created < cutoff:
                    continue
                seen_ids.add(d.id)
                items.append({
                    "id": d.id,
                    "kind": "wall",
                    "fromUserId": fid,
                    "fromName": names.get(fid, data.get("displayName", "Someone")),
                    "toUserId": fid,
                    "toName": names.get(fid, "Someone"),
                    "wallType": data.get("type", ""),
                    "detail": data.get("detail", {}),
                    "createdAt": created,
                })
        except Exception as e:
            logger.warning("Feed wall query failed for %s: %s", fid, e)

    items.sort(key=lambda x: x.get("createdAt", ""), reverse=True)
    return items[:40]


@router.post("/api/feed/{item_id}/react")
def react_to_feed_item(
    item_id: str,
    emoji: str = Query(...),
    uid: str = Depends(get_uid),
):
    """Toggle a reaction emoji on a shame feed item."""
    ref = db.collection("shameQueue").document(item_id)
    doc = ref.get()
    if not doc.exists:
        raise HTTPException(status_code=404, detail="Item not found")
    data = doc.to_dict()
    friend_ids = set(_get_friend_ids(uid))
    friend_ids.add(uid)
    if data.get("fromUserId") not in friend_ids and data.get("toUserId") not in friend_ids:
        raise HTTPException(status_code=403, detail="Not in group")

    reactions: dict = dict(data.get("reactions", {}))
    users = list(reactions.get(emoji, []))
    if uid in users:
        users.remove(uid)
    else:
        users.append(uid)
    if users:
        reactions[emoji] = users
    else:
        reactions.pop(emoji, None)
    ref.update({"reactions": reactions})
    return {"reactions": reactions}


def _fmt_secs(s: int) -> str:
    if s == 0:
        return "0m"
    h, m = s // 3600, (s % 3600) // 60
    if h > 0 and m > 0:
        return f"{h}h {m}m"
    if h > 0:
        return f"{h}h"
    return f"{m}m" if m > 0 else "<1m"


@router.get("/api/awards")
def get_awards(uid: str = Depends(get_uid)):
    """
    Compute weekly group awards.
    Optimised: single db.get_all() for profiles/streaks/summaries +
    2 shameEvents `in` queries instead of 5 separate per-friend loops.
    """
    friend_ids = set(_get_friend_ids(uid))
    friend_ids.add(uid)
    friend_list = list(friend_ids)
    now = datetime.now(timezone.utc)
    today = now.date().isoformat()
    week_cutoff = (now - timedelta(days=7)).isoformat()

    # ── Single batch fetch: profiles + streaks + today summaries ──
    profile_refs = [
        db.collection("users").document(fid).collection("profile").document("info")
        for fid in friend_list
    ]
    streak_refs = [
        db.collection("users").document(fid).collection("streaks").document("current")
        for fid in friend_list
    ]
    summary_refs = [
        db.collection("users").document(fid).collection("dailySummaries").document(today)
        for fid in friend_list
    ]
    names: dict[str, str] = {}
    streaks: dict[str, int] = {}
    summaries: dict[str, dict] = {}
    for doc in db.get_all(profile_refs + streak_refs + summary_refs):
        if not doc.exists:
            continue
        parts = doc.reference.path.split("/")
        fid = parts[1]
        sub = parts[2] if len(parts) > 2 else ""
        if sub == "profile":
            names[fid] = doc.to_dict().get("displayName", "?")
        elif sub == "streaks":
            streaks[fid] = doc.to_dict().get("current", 0)
        elif sub == "dailySummaries":
            summaries[fid] = doc.to_dict()

    # ── 2 shameEvents `in` queries instead of 2N per-friend queries ──
    shame_recv: dict[str, int] = {fid: 0 for fid in friend_list}
    shame_sent: dict[str, int] = {fid: 0 for fid in friend_list}
    for i in range(0, len(friend_list), 30):
        chunk = friend_list[i:i + 30]
        try:
            for d in (
                db.collection("shameEvents")
                .where(filter=FieldFilter("toUserId", "in", chunk))
                .where(filter=FieldFilter("sentAt", ">=", week_cutoff))
                .stream()
            ):
                to_id = d.to_dict().get("toUserId")
                if to_id:
                    shame_recv[to_id] = shame_recv.get(to_id, 0) + 1
            for d in (
                db.collection("shameEvents")
                .where(filter=FieldFilter("fromUserId", "in", chunk))
                .where(filter=FieldFilter("sentAt", ">=", week_cutoff))
                .stream()
            ):
                from_id = d.to_dict().get("fromUserId")
                if from_id:
                    shame_sent[from_id] = shame_sent.get(from_id, 0) + 1
        except Exception as e:
            logger.warning("Awards shame query failed: %s", e)

    awards = []

    # 🔥 Longest streak
    if streaks:
        best_id = max(streaks, key=lambda x: streaks[x])
        if streaks[best_id] > 0:
            awards.append({"emoji": "🔥", "title": "Longest streak", "winner": names.get(best_id, "?"), "value": f"{streaks[best_id]}d"})

    # 👑 Most shamed
    if shame_recv:
        top_id = max(shame_recv, key=lambda x: shame_recv[x])
        if shame_recv[top_id] > 0:
            awards.append({"emoji": "👑", "title": "Most shamed", "winner": names.get(top_id, "?"), "value": f"{shame_recv[top_id]}x"})

    # 😤 Top shamer
    if shame_sent:
        top_id = max(shame_sent, key=lambda x: shame_sent[x])
        if shame_sent[top_id] > 0:
            awards.append({"emoji": "😤", "title": "Top shamer", "winner": names.get(top_id, "?"), "value": f"{shame_sent[top_id]} sent"})

    # ✨ Cleanest today — reuse summaries already fetched
    today_times = {fid: summaries.get(fid, {}).get("totalSeconds", 0) for fid in friend_list}
    if today_times:
        cleanest_id = min(today_times, key=lambda x: today_times[x])
        awards.append({"emoji": "✨", "title": "Cleanest today", "winner": names.get(cleanest_id, "?"), "value": _fmt_secs(today_times[cleanest_id]) if today_times[cleanest_id] > 0 else "0m"})

    # 📱 Most opens today — reuse summaries already fetched
    today_opens = {}
    for fid in friend_list:
        s = summaries.get(fid, {})
        today_opens[fid] = s.get("sessionCount", 0) or sum(s.get("openCounts", {}).values())
    if today_opens:
        top_id = max(today_opens, key=lambda x: today_opens[x])
        if today_opens[top_id] > 0:
            awards.append({"emoji": "📱", "title": "Most opens today", "winner": names.get(top_id, "?"), "value": f"{today_opens[top_id]} opens"})

    return awards

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
def get_live_friends(
    uid: str = Depends(get_uid),
    date: Optional[str] = Query(None, description="Client's local date YYYY-MM-DD"),
):
    """
    Returns all friends with their live status, today's stats, streak info,
    and shame cooldown status.
    Optimised: db.get_all() batch for per-user docs + single `in` query
    for activeSessions instead of 6 serial reads per friend.
    """
    now = datetime.now(timezone.utc)
    # Use client-provided local date if available, otherwise fall back to UTC
    if date:
        try:
            today = dt_date.fromisoformat(date).isoformat()
            yesterday_str = (dt_date.fromisoformat(date) - timedelta(days=1)).isoformat()
        except ValueError:
            today = _today_str()
            yesterday_str = (now.date() - timedelta(days=1)).isoformat()
    else:
        today = _today_str()
        yesterday_str = (now.date() - timedelta(days=1)).isoformat()
    _BREAK_TOLERANCE = 5
    _MIN_SCROLLING = 5

    # 1 read: groups
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
    all_ids = list(friend_ids | {uid})

    # ── Batch fetch all per-user subcollection docs in one round trip ──
    profile_refs    = [db.collection("users").document(fid).collection("profile").document("info") for fid in all_ids]
    ghost_refs      = [db.collection("users").document(fid).collection("gatewayState").document("ghost") for fid in all_ids]
    settings_refs   = [db.collection("users").document(fid).collection("notificationSettings").document("config") for fid in all_ids]
    summary_refs    = [db.collection("users").document(fid).collection("dailySummaries").document(today) for fid in all_ids]
    streak_refs     = [db.collection("users").document(fid).collection("streaks").document("current") for fid in all_ids]
    yesterday_ref   = db.collection("users").document(uid).collection("dailySummaries").document(yesterday_str)

    profiles: dict[str, dict] = {}
    ghost_data: dict[str, dict] = {}
    settings_data: dict[str, dict] = {}
    summary_data: dict[str, dict] = {}
    streak_data: dict[str, dict] = {}
    my_yesterday: dict = {}

    for doc in db.get_all(profile_refs + ghost_refs + settings_refs + summary_refs + streak_refs + [yesterday_ref]):
        if not doc.exists:
            continue
        parts = doc.reference.path.split("/")
        fid = parts[1]
        sub = parts[2] if len(parts) > 2 else ""
        doc_id = parts[3] if len(parts) > 3 else ""
        if sub == "profile":
            profiles[fid] = doc.to_dict()
        elif sub == "gatewayState" and doc_id == "ghost":
            ghost_data[fid] = doc.to_dict()
        elif sub == "notificationSettings":
            settings_data[fid] = doc.to_dict()
        elif sub == "dailySummaries":
            if doc_id == today:
                summary_data[fid] = doc.to_dict()
            elif doc_id == yesterday_str and fid == uid:
                my_yesterday = doc.to_dict()
        elif sub == "streaks":
            streak_data[fid] = doc.to_dict()

    # ── 1 activeSessions `in` query instead of N per-friend queries ──
    active_by_user: dict[str, list[dict]] = {fid: [] for fid in all_ids}
    for i in range(0, len(all_ids), 30):
        chunk = all_ids[i:i + 30]
        for d in db.collection("activeSessions").where(filter=FieldFilter("userId", "in", chunk)).stream():
            data = d.to_dict()
            fid = data.get("userId", "")
            if fid:
                active_by_user.setdefault(fid, []).append(data)

    # ── Build friend objects from cached data — zero more Firestore calls ──
    friends = []
    for fid in friend_ids:
        display_name = profiles.get(fid, {}).get("displayName", "Friend")

        is_ghost = False
        gd = ghost_data.get(fid)
        if gd:
            ghost_until = _parse_time(gd.get("until", ""))
            if ghost_until > now:
                is_ghost = True

        friend_settings = settings_data.get(fid, {})
        if not friend_settings.get("allowFriendsToSeeLiveSessions", True) or is_ghost:
            friends.append({
                "userId": fid,
                "displayName": display_name,
                "status": "offline" if is_ghost else "hidden",
                "isGhost": is_ghost,
            })
            continue

        active_sessions = active_by_user.get(fid, [])
        today_stats = summary_data.get(fid, {})
        streak = streak_data.get(fid, {})

        in_break_window = False
        shame_eligible = False
        if active_sessions:
            shame_eligible = True
        else:
            _last_seen_raw = today_stats.get("lastSeenAt")
            _total_secs = today_stats.get("totalSeconds", 0)
            if _last_seen_raw and _total_secs >= _MIN_SCROLLING * 60:
                try:
                    if (now - _parse_time(_last_seen_raw)).total_seconds() / 60 <= _BREAK_TOLERANCE:
                        shame_eligible = True
                        in_break_window = True
                except Exception:
                    pass

        # Shame cooldown — disabled for testing
        can_shame = shame_eligible
        shame_cooldown_until = None
        # if shame_eligible:
        #     cooldown_cutoff = (now - timedelta(minutes=15)).isoformat()
        #     shame_recent = list(db.collection("shameQueue")
        #         .where(filter=FieldFilter("fromUserId", "==", uid))
        #         .where(filter=FieldFilter("toUserId", "==", fid))
        #         .where(filter=FieldFilter("createdAt", ">=", cooldown_cutoff))
        #         .limit(1).stream())
        #     if shame_recent:
        #         can_shame = False
        #         shame_time = _parse_time(shame_recent[0].to_dict().get("createdAt", ""))
        #         shame_cooldown_until = (shame_time + timedelta(minutes=15)).isoformat()

        status = "offline"
        current_app = None
        session_start = None
        session_minutes = 0
        last_seen_mins_ago = None

        if active_sessions:
            latest = max(active_sessions, key=lambda d: d.get("openTime", ""))
            current_app = latest.get("appName")
            session_start = latest.get("openTime")
            session_minutes = int((now - _parse_time(session_start)).total_seconds() / 60)
            status = "live"
        else:
            total_today = today_stats.get("totalSeconds", 0)
            if total_today > 0:
                status = "recent"
                last_seen_raw = today_stats.get("lastSeenAt")
                if last_seen_raw:
                    try:
                        last_seen_mins_ago = max(0, int((now - _parse_time(last_seen_raw)).total_seconds() / 60))
                    except Exception:
                        pass

        daily_cap = friend_settings.get("dailyCapSeconds", 3600)
        total_today_secs = today_stats.get("totalSeconds", 0)
        daily_pct = min(100, int((total_today_secs / daily_cap * 100) if daily_cap > 0 else 0))
        total_opens = today_stats.get("sessionCount", 0) or sum(today_stats.get("openCounts", {}).values())

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
            "inBreakWindow": in_break_window,
            "isGhost": is_ghost,
        })

    status_order = {"live": 0, "recent": 1, "offline": 2, "hidden": 3}
    friends.sort(key=lambda f: (status_order.get(f["status"], 9), f.get("displayName", "")))

    # My stats — all already fetched from the batch above
    my_stats = summary_data.get(uid, {})
    my_settings = settings_data.get(uid, {})
    my_cap = my_settings.get("dailyCapSeconds", 3600)
    my_total = my_stats.get("totalSeconds", 0)

    my_active = active_by_user.get(uid, [])
    my_current_app = None
    my_session_minutes = 0
    if my_active:
        latest = max(my_active, key=lambda d: d.get("openTime", ""))
        my_current_app = latest.get("appName")
        my_session_minutes = int((now - _parse_time(latest.get("openTime", ""))).total_seconds() / 60)

    me = {
        "userId": uid,
        "totalTodaySeconds": my_total,
        "dailyLimitPct": min(100, int((my_total / my_cap * 100) if my_cap > 0 else 0)),
        "totalOpens": my_stats.get("sessionCount", 0) or sum(my_stats.get("openCounts", {}).values()),
        "currentApp": my_current_app,
        "sessionMinutes": my_session_minutes,
        "yesterdaySeconds": my_yesterday.get("totalSeconds", 0),
        "yesterdayOpens": my_yesterday.get("sessionCount", 0) or sum(my_yesterday.get("openCounts", {}).values()),
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

    member_list = list(all_member_ids)

    # ── Batch fetch: profiles + streaks + all dailySummaries for date range ──
    profile_refs = [
        db.collection("users").document(mid).collection("profile").document("info")
        for mid in member_list
    ]
    streak_refs = [
        db.collection("users").document(mid).collection("streaks").document("current")
        for mid in member_list
    ]
    summary_refs = [
        db.collection("users").document(mid).collection("dailySummaries").document(date_str)
        for mid in member_list
        for date_str in dates
    ]

    profiles: dict[str, str] = {}
    streak_data: dict[str, dict] = {}
    summary_map: dict[str, dict[str, dict]] = {}  # {mid: {date: data}}

    for doc in db.get_all(profile_refs + streak_refs + summary_refs):
        if not doc.exists:
            continue
        parts = doc.reference.path.split("/")
        mid = parts[1]
        sub = parts[2] if len(parts) > 2 else ""
        doc_id = parts[3] if len(parts) > 3 else ""
        if sub == "profile":
            profiles[mid] = doc.to_dict().get("displayName", "Friend")
        elif sub == "streaks":
            streak_data[mid] = doc.to_dict()
        elif sub == "dailySummaries":
            summary_map.setdefault(mid, {})[doc_id] = doc.to_dict()

    # ── 2 shameEvents `in` queries instead of 2N per-member queries ──
    shames_sent_count: dict[str, int] = {mid: 0 for mid in member_list}
    shames_recv_count: dict[str, int] = {mid: 0 for mid in member_list}
    for i in range(0, len(member_list), 30):
        chunk = member_list[i:i + 30]
        try:
            for d in db.collection("shameEvents").where(filter=FieldFilter("fromUserId", "in", chunk)).limit(500).stream():
                from_id = d.to_dict().get("fromUserId")
                if from_id:
                    shames_sent_count[from_id] = shames_sent_count.get(from_id, 0) + 1
            for d in db.collection("shameEvents").where(filter=FieldFilter("toUserId", "in", chunk)).limit(500).stream():
                to_id = d.to_dict().get("toUserId")
                if to_id:
                    shames_recv_count[to_id] = shames_recv_count.get(to_id, 0) + 1
        except Exception as e:
            logger.warning("Group stats shame query failed: %s", e)

    # ── Build member objects from cached data — zero more Firestore calls ──
    members = []
    for mid in all_member_ids:
        total_seconds = 0
        by_app: dict[str, int] = {}
        session_count = 0
        for date_str in dates:
            data = summary_map.get(mid, {}).get(date_str, {})
            total_seconds += data.get("totalSeconds", 0)
            session_count += data.get("sessionCount", 0)
            for app, secs in data.get("byApp", {}).items():
                by_app[app] = by_app.get(app, 0) + secs

        streak = streak_data.get(mid, {})
        members.append({
            "userId": mid,
            "displayName": profiles.get(mid, "Friend"),
            "isYou": mid == uid,
            "totalSeconds": total_seconds,
            "avgPerDay": int(total_seconds / days) if days > 0 else 0,
            "sessionCount": session_count,
            "byApp": by_app,
            "streakDays": streak.get("current", 0),
            "longestStreak": streak.get("longest", 0),
            "shamesSent": shames_sent_count.get(mid, 0),
            "shamesReceived": shames_recv_count.get(mid, 0),
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

    member_list = list(all_member_ids)
    month_start = f"{month}-01T00:00:00"
    month_end = f"{month}-{str(num_days).zfill(2)}T23:59:59"

    # ── Batch fetch: profiles + streaks + all monthly dailySummaries ──
    profile_refs = [
        db.collection("users").document(mid).collection("profile").document("info")
        for mid in member_list
    ]
    streak_refs = [
        db.collection("users").document(mid).collection("streaks").document("current")
        for mid in member_list
    ]
    summary_refs = [
        db.collection("users").document(mid).collection("dailySummaries").document(date_str)
        for mid in member_list
        for date_str in dates
    ]

    profiles: dict[str, str] = {}
    streak_data: dict[str, dict] = {}
    summary_map: dict[str, dict[str, dict]] = {}

    for doc in db.get_all(profile_refs + streak_refs + summary_refs):
        if not doc.exists:
            continue
        parts = doc.reference.path.split("/")
        mid = parts[1]
        sub = parts[2] if len(parts) > 2 else ""
        doc_id = parts[3] if len(parts) > 3 else ""
        if sub == "profile":
            profiles[mid] = doc.to_dict().get("displayName", "Friend")
        elif sub == "streaks":
            streak_data[mid] = doc.to_dict()
        elif sub == "dailySummaries":
            summary_map.setdefault(mid, {})[doc_id] = doc.to_dict()

    # ── 2 shameEvents `in` queries instead of 2N per-member queries ──
    shames_sent_count: dict[str, int] = {mid: 0 for mid in member_list}
    shames_recv_count: dict[str, int] = {mid: 0 for mid in member_list}
    for i in range(0, len(member_list), 30):
        chunk = member_list[i:i + 30]
        try:
            for d in (
                db.collection("shameEvents")
                .where(filter=FieldFilter("fromUserId", "in", chunk))
                .where(filter=FieldFilter("sentAt", ">=", month_start))
                .where(filter=FieldFilter("sentAt", "<=", month_end))
                .stream()
            ):
                from_id = d.to_dict().get("fromUserId")
                if from_id:
                    shames_sent_count[from_id] = shames_sent_count.get(from_id, 0) + 1
            for d in (
                db.collection("shameEvents")
                .where(filter=FieldFilter("toUserId", "in", chunk))
                .where(filter=FieldFilter("sentAt", ">=", month_start))
                .where(filter=FieldFilter("sentAt", "<=", month_end))
                .stream()
            ):
                to_id = d.to_dict().get("toUserId")
                if to_id:
                    shames_recv_count[to_id] = shames_recv_count.get(to_id, 0) + 1
        except Exception as e:
            logger.warning("Monthly awards shame query failed: %s", e)

    # ── Build member_stats from cached data ──
    member_stats = {}
    for mid in all_member_ids:
        total_opens = 0
        total_seconds = 0
        for date_str in dates:
            data = summary_map.get(mid, {}).get(date_str, {})
            total_seconds += data.get("totalSeconds", 0)
            total_opens += sum(data.get("openCounts", {}).values())

        streak = streak_data.get(mid, {})
        member_stats[mid] = {
            "displayName": profiles.get(mid, "Friend"),
            "isYou": mid == uid,
            "totalOpens": total_opens,
            "totalSeconds": total_seconds,
            "shamesSent": shames_sent_count.get(mid, 0),
            "shamesReceived": shames_recv_count.get(mid, 0),
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
    # Mirror on user document for quick querying from the app
    db.collection("users").document(target_id).set(
        {"locked": True, "lockedUntil": until}, merge=True
    )


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


def _send_shame_notification(user_id: str, from_name: str, is_emergency: bool, payload: "ShamePayload"):
    """Send shame notification with dynamic content based on shame type."""
    reaction_icon = _REACTION_EMOJI_MAP.get(payload.reaction or "", payload.reaction or "")
    if is_emergency:
        title = f"🚨 {from_name} is calling you out"
        body = "GET OFF YOUR PHONE RIGHT NOW"
    elif payload.type == "video":
        title = f"{from_name} recorded a shame video for you 📹"
        body = payload.message or "Watch it before you keep scrolling"
    elif payload.message:
        title = f"{from_name} shamed you 🔥"
        body = payload.message
    elif reaction_icon:
        title = f"{from_name} shamed you {reaction_icon}"
        body = "Put the phone down."
    else:
        title = f"{from_name} shamed you 🔥"
        body = "Put the phone down."
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
