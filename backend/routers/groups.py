import secrets
from datetime import datetime, timezone, date as dt_date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from google.cloud.firestore_v1 import ArrayUnion

from auth import get_uid
from firestore_client import db
from models import CreateGroupPayload

router = APIRouter(prefix="/api/groups", tags=["groups"])


def _get_display_name(uid: str) -> str:
    doc = (
        db.collection("users").document(uid).collection("profile").document("info").get()
    )
    return doc.to_dict().get("displayName", "Unknown") if doc.exists else "Unknown"


@router.post("", status_code=201)
async def create_group(payload: CreateGroupPayload, uid: str = Depends(get_uid)):
    """Create a new group. The groupId doubles as the invite token."""
    group_id = secrets.token_urlsafe(6)[:8]  # e.g. "xk92pl"
    now = datetime.now(timezone.utc).isoformat()
    display_name = _get_display_name(uid)

    group_ref = db.collection("groups").document(group_id)
    group_ref.set(
        {
            "name": payload.name,
            "createdBy": uid,
            "createdAt": now,
            "memberIds": [uid],
        }
    )
    group_ref.collection("members").document(uid).set(
        {"displayName": display_name, "joinedAt": now, "role": "owner"}
    )

    return {"groupId": group_id, "name": payload.name}


@router.get("/{group_id}")
async def get_group(group_id: str, uid: str = Depends(get_uid)):
    """
    Preview a group before joining (returns basic info for non-members).
    Returns full data for members.
    """
    doc = db.collection("groups").document(group_id).get()
    if not doc.exists:
        raise HTTPException(status_code=404, detail="Group not found")

    data = doc.to_dict()
    member_ids: list = data.get("memberIds", [])

    if uid not in member_ids:
        # Non-member preview (for join confirmation screen)
        return {
            "groupId": group_id,
            "name": data["name"],
            "memberCount": len(member_ids),
            "isMember": False,
        }

    return {"groupId": group_id, "isMember": True, **data}


@router.post("/{group_id}/members", status_code=201)
async def join_group(group_id: str, uid: str = Depends(get_uid)):
    """Join a group using the groupId as invite token."""
    group_ref = db.collection("groups").document(group_id)
    doc = group_ref.get()
    if not doc.exists:
        raise HTTPException(status_code=404, detail="Group not found")

    data = doc.to_dict()
    if uid in data.get("memberIds", []):
        return {"status": "already_member", "groupId": group_id}

    display_name = _get_display_name(uid)
    now = datetime.now(timezone.utc).isoformat()

    batch = db.batch()
    batch.update(group_ref, {"memberIds": ArrayUnion([uid])})
    batch.set(
        group_ref.collection("members").document(uid),
        {"displayName": display_name, "joinedAt": now, "role": "member"},
    )
    batch.commit()

    return {"status": "joined", "groupId": group_id, "name": data["name"]}


@router.delete("/{group_id}/members/me", status_code=200)
async def leave_group(group_id: str, uid: str = Depends(get_uid)):
    """Leave a group."""
    from google.cloud.firestore_v1 import ArrayRemove

    group_ref = db.collection("groups").document(group_id)
    doc = group_ref.get()
    if not doc.exists:
        raise HTTPException(status_code=404, detail="Group not found")

    data = doc.to_dict()
    if uid not in data.get("memberIds", []):
        raise HTTPException(status_code=400, detail="Not a member")

    batch = db.batch()
    batch.update(group_ref, {"memberIds": ArrayRemove([uid])})
    batch.delete(group_ref.collection("members").document(uid))
    batch.commit()

    return {"status": "left", "groupId": group_id}


@router.get("/{group_id}/leaderboard")
async def get_leaderboard(
    group_id: str,
    date: Optional[str] = Query(None, description="Date YYYY-MM-DD, defaults to today"),
    uid: str = Depends(get_uid),
):
    """
    Return members ranked by least screen time for the given date.
    Reads dailySummaries only (not raw sessions) to protect privacy.
    """
    group_doc = db.collection("groups").document(group_id).get()
    if not group_doc.exists:
        raise HTTPException(status_code=404, detail="Group not found")

    group_data = group_doc.to_dict()
    if uid not in group_data.get("memberIds", []):
        raise HTTPException(status_code=403, detail="Not a member of this group")

    target_date = date or dt_date.today().isoformat()
    member_ids: list = group_data.get("memberIds", [])

    leaderboard = []
    for member_id in member_ids:
        summary_doc = (
            db.collection("users")
            .document(member_id)
            .collection("dailySummaries")
            .document(target_date)
            .get()
        )
        member_doc = (
            db.collection("groups")
            .document(group_id)
            .collection("members")
            .document(member_id)
            .get()
        )
        display_name = (
            member_doc.to_dict().get("displayName", "Unknown")
            if member_doc.exists
            else "Unknown"
        )

        if summary_doc.exists:
            summary = summary_doc.to_dict()
            total_seconds = summary.get("totalSeconds", 0)
            by_app = summary.get("byApp", {})
            session_count = summary.get("sessionCount", 0)
        else:
            total_seconds = 0
            by_app = {}
            session_count = 0

        # Streak
        streak_doc = (
            db.collection("users").document(member_id)
            .collection("streaks").document("current").get()
        )
        streak_days = streak_doc.to_dict().get("current", 0) if streak_doc.exists else 0

        # Live status
        active = list(
            db.collection("activeSessions")
            .where("userId", "==", member_id)
            .limit(1)
            .stream()
        )
        is_live = len(active) > 0

        # Daily cap
        settings_doc = (
            db.collection("users").document(member_id)
            .collection("notificationSettings").document("config").get()
        )
        daily_cap = (
            settings_doc.to_dict().get("dailyCapSeconds", 3600)
            if settings_doc.exists else 3600
        )

        leaderboard.append({
            "userId": member_id,
            "displayName": display_name,
            "totalSeconds": total_seconds,
            "sessionCount": session_count,
            "byApp": by_app,
            "streakDays": streak_days,
            "isLive": is_live,
            "dailyCapSeconds": daily_cap,
        })

    # Rank by least screen time (ascending) — lower is better
    leaderboard.sort(key=lambda x: x["totalSeconds"])
    for i, entry in enumerate(leaderboard):
        entry["rank"] = i + 1

    group_avg = int(sum(e["totalSeconds"] for e in leaderboard) / len(leaderboard)) if leaderboard else 0

    return {
        "date": target_date,
        "groupId": group_id,
        "groupAvgSeconds": group_avg,
        "leaderboard": leaderboard,
    }


@router.get("")
async def list_my_groups(uid: str = Depends(get_uid)):
    """Return all groups the authenticated user belongs to."""
    docs = (
        db.collection("groups")
        .where("memberIds", "array_contains", uid)
        .stream()
    )
    return [{"groupId": d.id, **d.to_dict()} for d in docs]
