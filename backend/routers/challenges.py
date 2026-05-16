"""
Challenges router — app challenges and friend bet (custom) challenges.

App challenges: developer-created goals open to all users.
Custom challenges: friend bets with escrowed credits.
"""

import logging
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from google.cloud.firestore_v1.base_query import FieldFilter
from pydantic import BaseModel

from auth import get_uid
from firestore_client import db
from services.challenge_service import (
    award_credits,
    deduct_credits,
    get_user_metric,
    settle_challenge,
)

router = APIRouter(tags=["challenges"])
logger = logging.getLogger(__name__)


# ── helpers ───────────────────────────────────────────────────────────

def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _parse_date(s: str) -> datetime:
    """Parse ISO date/datetime string to aware datetime."""
    try:
        return datetime.fromisoformat(str(s).replace("Z", "+00:00"))
    except (ValueError, TypeError):
        return datetime.now(timezone.utc)


def _is_claimable(doc_data: dict) -> bool:
    """True if challenge is active and its endDate has passed."""
    status = doc_data.get("status")
    if status not in ("active", "pending"):
        return False
    end_date = doc_data.get("endDate", "")
    if not end_date:
        return False
    return _parse_date(end_date) < datetime.now(timezone.utc)


def _user_exists(uid: str) -> bool:
    """Check whether a user document exists."""
    doc = db.collection("users").document(uid).get()
    return doc.exists


# ── request models ────────────────────────────────────────────────────

class AppChallengeCreate(BaseModel):
    title: str
    description: str
    metric: str                    # "screen_time" | "opens" | "streak_days"
    target_app: Optional[str] = None
    goal: float
    start_date: str                # ISO date or datetime
    end_date: str
    reward_credits: int


class CustomChallengeCreate(BaseModel):
    title: str
    description: str = ""
    metric: str
    target_app: Optional[str] = None
    end_date: str
    max_participants: int = 2
    stake: int


# ══════════════════════════════════════════════════════════════════════
# APP CHALLENGES
# ══════════════════════════════════════════════════════════════════════

@router.post("/api/challenges/app", status_code=201)
async def create_app_challenge(
    body: AppChallengeCreate,
    uid: str = Depends(get_uid),
):
    """Create an app challenge (developer use, still auth-gated)."""
    doc_ref = db.collection("challenges").document()
    doc_ref.set({
        "type": "app",
        "title": body.title,
        "description": body.description,
        "metric": body.metric,
        "targetApp": body.target_app,
        "goal": body.goal,
        "startDate": body.start_date,
        "endDate": body.end_date,
        "rewardCredits": body.reward_credits,
        "status": "active",
        "createdBy": uid,
        "participants": None,
        "totalPot": None,
        "winner": None,
        "createdAt": _now_iso(),
    })
    return {"challengeId": doc_ref.id}


@router.get("/api/challenges/app")
async def list_app_challenges(uid: str = Depends(get_uid)):
    """List all app challenges with a computed claimable flag."""
    docs = list(
        db.collection("challenges")
        .where(filter=FieldFilter("type", "==", "app"))
        .stream()
    )
    result = []
    for d in docs:
        data = d.to_dict()
        result.append({
            "id": d.id,
            **data,
            "claimable": _is_claimable(data),
        })
    return result


# ══════════════════════════════════════════════════════════════════════
# CUSTOM (FRIEND BET) CHALLENGES
# ══════════════════════════════════════════════════════════════════════

@router.post("/api/challenges/custom", status_code=201)
async def create_custom_challenge(
    body: CustomChallengeCreate,
    uid: str = Depends(get_uid),
):
    """
    Create an open friend challenge.
    Creator is auto-joined and their stake is escrowed. Other friends
    join via POST /api/challenges/{id}/join. Challenge goes active once
    max_participants spots are filled.
    """
    if body.max_participants < 2:
        raise HTTPException(status_code=400, detail="max_participants must be at least 2")
    if body.stake <= 0:
        raise HTTPException(status_code=400, detail="stake must be a positive number")

    doc_ref = db.collection("challenges").document()
    challenge_id = doc_ref.id

    # Escrow creator's stake
    deduct_credits(
        uid=uid,
        amount=body.stake,
        type="challenge_loss",
        challenge_id=challenge_id,
        target_uid=None,
        note=f"Escrowed for challenge: {body.title}",
    )

    creator_participant = {
        "userId": uid,
        "stake": body.stake,
        "result": "pending",
        "metricValue": None,
        "accepted": True,
    }

    doc_ref.set({
        "type": "custom",
        "title": body.title,
        "description": body.description,
        "metric": body.metric,
        "targetApp": body.target_app,
        "startDate": _now_iso(),
        "endDate": body.end_date,
        "status": "pending",
        "createdBy": uid,
        "maxParticipants": body.max_participants,
        "stake": body.stake,
        "goal": None,
        "rewardCredits": None,
        "participants": [creator_participant],
        "totalPot": body.stake,
        "winner": None,
        "createdAt": _now_iso(),
    })

    return {"challengeId": challenge_id, "spotsRemaining": body.max_participants - 1}


def _get_friend_ids(user_id: str) -> set[str]:
    """Return UIDs of all users who share a group with user_id."""
    groups = (
        db.collection("groups")
        .where(filter=FieldFilter("memberIds", "array_contains", user_id))
        .stream()
    )
    friend_ids: set[str] = set()
    for group in groups:
        for mid in group.to_dict().get("memberIds", []):
            if mid != user_id:
                friend_ids.add(mid)
    return friend_ids


@router.get("/api/challenges/custom")
async def list_custom_challenges(uid: str = Depends(get_uid)):
    """
    Returns:
    - All custom challenges the user has joined (any status)
    - Open pending challenges created by friends that the user hasn't joined yet
    """
    friend_ids = _get_friend_ids(uid)

    docs = list(
        db.collection("challenges")
        .where(filter=FieldFilter("type", "==", "custom"))
        .stream()
    )
    result = []
    for d in docs:
        data = d.to_dict()
        participants: list = data.get("participants") or []
        user_ids = {p.get("userId") for p in participants}

        if uid in user_ids:
            # User has joined — always include
            result.append({
                "id": d.id,
                **data,
                "claimable": _is_claimable(data),
            })
        elif (
            data.get("status") == "pending"
            and data.get("createdBy") in friend_ids
            and len(participants) < data.get("maxParticipants", 2)
        ):
            # Open challenge from a friend the user can join
            result.append({
                "id": d.id,
                **data,
                "claimable": False,
            })
    return {"challenges": result}


# ══════════════════════════════════════════════════════════════════════
# ACCEPT / DECLINE
# ══════════════════════════════════════════════════════════════════════

@router.post("/api/challenges/{challenge_id}/accept")
async def accept_challenge(
    challenge_id: str,
    uid: str = Depends(get_uid),
):
    """Accept a friend bet invite. Activates the challenge once all accept."""
    ref = db.collection("challenges").document(challenge_id)
    doc = ref.get()
    if not doc.exists:
        raise HTTPException(status_code=404, detail="Challenge not found")

    data = doc.to_dict()
    if data.get("type") != "custom":
        raise HTTPException(status_code=400, detail="Only custom challenges require acceptance")
    if data.get("status") not in ("pending",):
        raise HTTPException(
            status_code=400,
            detail=f"Challenge is not pending (status: {data.get('status')})",
        )

    participants: list[dict] = data.get("participants") or []
    user_ids = [p.get("userId") for p in participants]
    if uid not in user_ids:
        raise HTTPException(status_code=403, detail="You are not a participant")

    updated = [
        {**p, "accepted": True} if p.get("userId") == uid else p
        for p in participants
    ]

    all_accepted = all(p.get("accepted") for p in updated)
    new_status = "active" if all_accepted else "pending"

    ref.update({"participants": updated, "status": new_status})
    return {"status": new_status}


@router.post("/api/challenges/{challenge_id}/decline")
async def decline_challenge(
    challenge_id: str,
    uid: str = Depends(get_uid),
):
    """
    Decline a friend bet. Cancels the challenge and refunds all escrowed credits.
    """
    ref = db.collection("challenges").document(challenge_id)
    doc = ref.get()
    if not doc.exists:
        raise HTTPException(status_code=404, detail="Challenge not found")

    data = doc.to_dict()
    if data.get("type") != "custom":
        raise HTTPException(status_code=400, detail="Only custom challenges can be declined")

    status = data.get("status")
    if status in ("settled", "cancelled"):
        raise HTTPException(
            status_code=400,
            detail=f"Challenge already {status}",
        )

    participants: list[dict] = data.get("participants") or []
    user_ids = [p.get("userId") for p in participants]
    if uid not in user_ids:
        raise HTTPException(status_code=403, detail="You are not a participant")

    # Refund all participants
    for p in participants:
        stake = p.get("stake", 0)
        if stake > 0:
            award_credits(
                uid=p["userId"],
                amount=stake,
                type="refund",
                challenge_id=challenge_id,
                note=f"Refund: bet declined — {data.get('title', challenge_id)}",
            )

    ref.update({"status": "cancelled"})
    return {"status": "cancelled"}


# ══════════════════════════════════════════════════════════════════════
# JOIN
# ══════════════════════════════════════════════════════════════════════

@router.post("/api/challenges/{challenge_id}/join")
async def join_challenge(
    challenge_id: str,
    uid: str = Depends(get_uid),
):
    """
    Join an open friend challenge. Escrows the stake and adds the user
    to participants. If this fills the last spot, activates the challenge.
    """
    ref = db.collection("challenges").document(challenge_id)
    doc = ref.get()
    if not doc.exists:
        raise HTTPException(status_code=404, detail="Challenge not found")

    data = doc.to_dict()

    if data.get("type") != "custom":
        raise HTTPException(status_code=400, detail="Only custom challenges can be joined")
    if data.get("status") != "pending":
        raise HTTPException(status_code=400, detail="Challenge is not open for joining")

    participants: list[dict] = data.get("participants") or []
    max_p = data.get("maxParticipants", 2)

    if any(p.get("userId") == uid for p in participants):
        raise HTTPException(status_code=400, detail="Already a participant")
    if len(participants) >= max_p:
        raise HTTPException(status_code=400, detail="Challenge is full")

    stake = data.get("stake", 0)
    title = data.get("title", challenge_id)

    # Escrow credits
    deduct_credits(
        uid=uid,
        amount=stake,
        type="challenge_loss",
        challenge_id=challenge_id,
        target_uid=None,
        note=f"Joined challenge: {title}",
    )

    new_participant = {
        "userId": uid,
        "stake": stake,
        "result": "pending",
        "metricValue": None,
        "accepted": True,
    }
    participants.append(new_participant)
    new_total_pot = data.get("totalPot", 0) + stake

    update: dict = {
        "participants": participants,
        "totalPot": new_total_pot,
    }
    if len(participants) >= max_p:
        update["status"] = "active"

    ref.update(update)
    return {"status": update.get("status", "pending"), "totalPot": new_total_pot}


# ══════════════════════════════════════════════════════════════════════
# CLAIM / SETTLE
# ══════════════════════════════════════════════════════════════════════

@router.post("/api/challenges/{challenge_id}/claim")
async def claim_challenge(
    challenge_id: str,
    uid: str = Depends(get_uid),
):
    """
    User triggers settlement. Enforces endDate server-side.
    Idempotent — only the first valid call does the work.
    """
    ref = db.collection("challenges").document(challenge_id)
    doc = ref.get()
    if not doc.exists:
        raise HTTPException(status_code=404, detail="Challenge not found")

    data = doc.to_dict()
    status = data.get("status")

    # Already finalized
    if status in ("settled", "cancelled"):
        return {"result": "already_settled", "credits_awarded": 0}

    # Enforce endDate
    end_date_str = data.get("endDate", "")
    if not end_date_str:
        raise HTTPException(status_code=400, detail="Challenge has no endDate")

    end_dt = _parse_date(end_date_str)
    if end_dt > datetime.now(timezone.utc):
        raise HTTPException(
            status_code=400,
            detail="Challenge period has not ended yet",
        )

    # Validate caller is a participant for custom challenges
    if data.get("type") == "custom":
        participants: list[dict] = data.get("participants") or []
        user_ids = [p.get("userId") for p in participants]
        if uid not in user_ids:
            raise HTTPException(status_code=403, detail="You are not a participant")

    # Pass caller uid into the challenge data dict for settle_challenge logic
    data["_caller_uid"] = uid

    result = settle_challenge(challenge_id, data)
    return result


# ══════════════════════════════════════════════════════════════════════
# ACTIVE CHALLENGES — live progress view
# ══════════════════════════════════════════════════════════════════════

@router.get("/api/challenges/active")
async def get_active_challenges(uid: str = Depends(get_uid)):
    """
    Returns all in-progress challenges for the user with current metric progress.
    Includes app challenges (active, endDate in the future) and custom challenges
    where the user is a participant (active, endDate in the future).
    """
    now = datetime.now(timezone.utc)
    now_iso = now.isoformat()

    active_items = []

    # ── App challenges ─────────────────────────────────────────────
    app_docs = list(
        db.collection("challenges")
        .where(filter=FieldFilter("type", "==", "app"))
        .where(filter=FieldFilter("status", "==", "active"))
        .stream()
    )
    for d in app_docs:
        data = d.to_dict()
        end_date = data.get("endDate", "")
        if end_date and _parse_date(end_date) <= now:
            continue  # already past end, not "in progress"

        start_date = data.get("startDate", "")[:10]
        end_date_str = end_date[:10] if end_date else now_iso[:10]
        metric = data.get("metric", "screen_time")
        target_app = data.get("targetApp")

        try:
            progress = get_user_metric(uid, metric, target_app, start_date, end_date_str)
        except Exception as e:
            logger.warning("Failed to get metric for app challenge %s: %s", d.id, e)
            progress = 0.0

        active_items.append({
            "id": d.id,
            **data,
            "myProgress": progress,
        })

    # ── Custom challenges ──────────────────────────────────────────
    custom_docs = list(
        db.collection("challenges")
        .where(filter=FieldFilter("type", "==", "custom"))
        .where(filter=FieldFilter("status", "==", "active"))
        .stream()
    )
    for d in custom_docs:
        data = d.to_dict()
        participants: list[dict] = data.get("participants") or []
        user_ids = [p.get("userId") for p in participants]
        if uid not in user_ids:
            continue

        end_date = data.get("endDate", "")
        if end_date and _parse_date(end_date) <= now:
            continue

        start_date = data.get("startDate", "")[:10]
        end_date_str = end_date[:10] if end_date else now_iso[:10]
        metric = data.get("metric", "screen_time")
        target_app = data.get("targetApp")

        try:
            progress = get_user_metric(uid, metric, target_app, start_date, end_date_str)
        except Exception as e:
            logger.warning("Failed to get metric for custom challenge %s: %s", d.id, e)
            progress = 0.0

        active_items.append({
            "id": d.id,
            **data,
            "myProgress": progress,
        })

    return active_items
