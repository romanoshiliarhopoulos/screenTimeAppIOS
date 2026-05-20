"""
Daily challenge service — pre-defined static daily challenges.

Templates are hard-coded and recur every day. Each user independently
enters (stakes credits) and claims (gets paid back double if they win).

Staking model:
  Enter  →  deduct stake_credits
  Win    →  award (stake_credits + reward_credits)  [net: +reward]
  Lose   →  nothing                                 [net: -stake]

Enrollment document ID: {uid}_{YYYY-MM-DD}_{template_id}
"""

from datetime import datetime, date, timedelta, timezone
from typing import Optional

from fastapi import HTTPException
from google.cloud.firestore_v1.base_query import FieldFilter

from firestore_client import db
from services.challenge_service import award_credits, deduct_credits, get_user_metric


# ── static templates ──────────────────────────────────────────────────

DAILY_TEMPLATES: list[dict] = [
    {
        "id": "beat_yesterday_time",
        "title": "Beat Yesterday",
        "description": "Keep your total screen time below what you used yesterday.",
        "metric": "screen_time",
        "goal_type": "beat_yesterday",     # dynamic — set at enrollment
        "target_app": None,
        "stake_credits": 30,
        "reward_credits": 30,
        "difficulty": "easy",
    },
    {
        "id": "weekly_avg_time",
        "title": "Below Your Average",
        "description": "Stay under your 7-day average screen time.",
        "metric": "screen_time",
        "goal_type": "weekly_average",     # dynamic — set at enrollment
        "target_app": None,
        "stake_credits": 40,
        "reward_credits": 40,
        "difficulty": "medium",
    },
    {
        "id": "two_hour_day",
        "title": "2-Hour Day",
        "description": "Keep your total screen time under 2 hours today.",
        "metric": "screen_time",
        "goal_type": "fixed",
        "fixed_goal": 7200.0,
        "target_app": None,
        "stake_credits": 50,
        "reward_credits": 50,
        "difficulty": "hard",
    },
    {
        "id": "fewer_pickups",
        "title": "Fewer Pickups",
        "description": "Open your phone less than you did yesterday.",
        "metric": "opens",
        "goal_type": "beat_yesterday",
        "target_app": None,
        "stake_credits": 20,
        "reward_credits": 20,
        "difficulty": "easy",
    },
    {
        "id": "under_50_opens",
        "title": "Under 50 Opens",
        "description": "Open apps fewer than 50 times today.",
        "metric": "opens",
        "goal_type": "fixed",
        "fixed_goal": 50.0,
        "target_app": None,
        "stake_credits": 25,
        "reward_credits": 25,
        "difficulty": "medium",
    },
    {
        "id": "social_30min",
        "title": "Social Media Cap",
        "description": "Spend less than 30 minutes on Instagram today.",
        "metric": "screen_time",
        "goal_type": "fixed",
        "fixed_goal": 1800.0,
        "target_app": "Instagram",
        "stake_credits": 35,
        "reward_credits": 35,
        "difficulty": "medium",
    },
]

_TEMPLATE_MAP: dict[str, dict] = {t["id"]: t for t in DAILY_TEMPLATES}


# ── helpers ───────────────────────────────────────────────────────────

def _today_str() -> str:
    return date.today().isoformat()


def _end_of_today_utc() -> datetime:
    """Midnight at the start of tomorrow (UTC)."""
    tomorrow = date.today() + timedelta(days=1)
    return datetime(tomorrow.year, tomorrow.month, tomorrow.day, tzinfo=timezone.utc)


def _enrollment_id(uid: str, template_id: str, date_str: str) -> str:
    return f"{uid}_{date_str}_{template_id}"


def _compute_goal(uid: str, template: dict, today: str) -> float:
    """
    Compute the personal goal for a user.
    Fixed goals return immediately; dynamic goals read usage history.
    Falls back to a sensible default if no history exists.
    """
    goal_type = template["goal_type"]
    metric = template["metric"]
    target_app: Optional[str] = template.get("target_app")

    if goal_type == "fixed":
        return float(template["fixed_goal"])

    yesterday = (date.fromisoformat(today) - timedelta(days=1)).isoformat()

    if goal_type == "beat_yesterday":
        val = get_user_metric(uid, metric, target_app, yesterday, yesterday)
        if val <= 0:
            return 14400.0 if metric == "screen_time" else 80.0
        return val

    if goal_type == "weekly_average":
        week_start = (date.fromisoformat(today) - timedelta(days=7)).isoformat()
        total = get_user_metric(uid, metric, target_app, week_start, yesterday)
        avg = total / 7.0
        if avg <= 0:
            return 14400.0 if metric == "screen_time" else 80.0
        return avg

    raise HTTPException(status_code=500, detail=f"Unknown goal_type: {goal_type}")


def _maybe_grant_starter_credits(uid: str) -> None:
    """
    One-time 100-credit starter grant for users who have never received credits.
    Silently skips if the user already has a balance or transaction history.
    """
    user_doc = db.collection("users").document(uid).get()
    if user_doc.exists:
        balance = user_doc.to_dict().get("blockCredits", 0)
        if balance > 0:
            return

    # Check transaction history
    tx = list(
        db.collection("creditTransactions")
        .where(filter=FieldFilter("userId", "==", uid))
        .limit(1)
        .stream()
    )
    if tx:
        return  # They've had transactions before

    award_credits(
        uid=uid,
        amount=100,
        type="starter_grant",
        challenge_id=None,
        note="Welcome bonus — play your first daily challenges!",
    )


# ── public API ────────────────────────────────────────────────────────

def get_daily_challenges(uid: str) -> list[dict]:
    """
    Returns today's daily challenge templates enriched with per-user enrollment state.
    Auto-grants 100 starter credits on first call if the user has no balance.
    """
    _maybe_grant_starter_credits(uid)

    today = _today_str()
    now = datetime.now(timezone.utc)
    end_today = _end_of_today_utc()

    # Batch-fetch all enrollments for today
    enrollment_ids = [_enrollment_id(uid, t["id"], today) for t in DAILY_TEMPLATES]
    refs = [db.collection("dailyChallengeEnrollments").document(eid) for eid in enrollment_ids]
    docs = list(db.get_all(refs))
    enrollment_map = {doc.id: doc for doc in docs}

    result = []
    for template in DAILY_TEMPLATES:
        eid = _enrollment_id(uid, template["id"], today)
        doc = enrollment_map.get(eid)

        if doc and doc.exists:
            enrollment = doc.to_dict()
            try:
                progress = get_user_metric(
                    uid,
                    template["metric"],
                    template.get("target_app"),
                    today,
                    today,
                )
            except Exception:
                progress = 0.0

            status = enrollment.get("status", "active")
            # Upgrade active → claimable once the day is over
            if status == "active" and now >= end_today:
                status = "claimable"

            result.append({
                **template,
                "enrolled": True,
                "goal": enrollment.get("goal"),
                "currentProgress": progress,
                "status": status,
                "result": enrollment.get("result", "pending"),
                "enrollmentId": eid,
            })
        else:
            # Not enrolled — show static goal for fixed types, None for dynamic
            static_goal = template.get("fixed_goal") if template["goal_type"] == "fixed" else None
            result.append({
                **template,
                "enrolled": False,
                "goal": static_goal,
                "currentProgress": 0.0,
                "status": "available",
                "result": None,
                "enrollmentId": None,
            })

    return result


def enter_daily_challenge(uid: str, template_id: str) -> dict:
    """
    Stake credits and enroll in today's daily challenge.
    Computes and persists the personal goal.
    """
    template = _TEMPLATE_MAP.get(template_id)
    if not template:
        raise HTTPException(status_code=404, detail="Challenge template not found")

    today = _today_str()
    eid = _enrollment_id(uid, template_id, today)

    existing = db.collection("dailyChallengeEnrollments").document(eid).get()
    if existing.exists:
        raise HTTPException(status_code=400, detail="Already enrolled in this challenge today")

    goal = _compute_goal(uid, template, today)
    stake = template["stake_credits"]

    deduct_credits(
        uid=uid,
        amount=stake,
        type="challenge_stake",
        challenge_id=eid,
        target_uid=None,
        note=f"Staked for daily: {template['title']}",
    )

    db.collection("dailyChallengeEnrollments").document(eid).set({
        "userId": uid,
        "templateId": template_id,
        "date": today,
        "title": template["title"],
        "description": template["description"],
        "metric": template["metric"],
        "targetApp": template.get("target_app"),
        "goal": goal,
        "stakeCredits": stake,
        "rewardCredits": template["reward_credits"],
        "status": "active",
        "result": "pending",
        "enteredAt": datetime.now(timezone.utc).isoformat(),
        "claimedAt": None,
    })

    return {
        "enrolled": True,
        "goal": goal,
        "stakeCredits": stake,
        "rewardCredits": template["reward_credits"],
    }


def claim_daily_challenge(uid: str, template_id: str) -> dict:
    """
    Settle today's daily challenge.
    Win  → award stake_credits + reward_credits.
    Lose → stake is forfeited (already deducted on enter).
    Only callable after midnight (end of challenge day).
    """
    template = _TEMPLATE_MAP.get(template_id)
    if not template:
        raise HTTPException(status_code=404, detail="Challenge template not found")

    today = _today_str()
    eid = _enrollment_id(uid, template_id, today)
    ref = db.collection("dailyChallengeEnrollments").document(eid)

    doc = ref.get()
    if not doc.exists:
        raise HTTPException(status_code=404, detail="You are not enrolled in this challenge today")

    enrollment = doc.to_dict()
    status = enrollment.get("status")

    if status == "claimed":
        won = enrollment.get("result") == "won"
        payout = enrollment.get("stakeCredits", 0) + enrollment.get("rewardCredits", 0) if won else 0
        return {"result": enrollment.get("result", "lost"), "creditsAwarded": payout}

    if status != "active":
        raise HTTPException(status_code=400, detail=f"Challenge is not active (status: {status})")

    now = datetime.now(timezone.utc)
    if now < _end_of_today_utc():
        raise HTTPException(
            status_code=400,
            detail="The challenge day isn't over yet — come back after midnight to claim",
        )

    actual = get_user_metric(
        uid,
        template["metric"],
        template.get("target_app"),
        today,
        today,
    )
    goal = enrollment.get("goal", 0.0)
    met_goal = actual <= goal  # all templates: lower is better

    stake = enrollment.get("stakeCredits", 0)
    reward = enrollment.get("rewardCredits", 0)
    credits_awarded = 0

    if met_goal:
        credits_awarded = stake + reward
        award_credits(
            uid=uid,
            amount=credits_awarded,
            type="challenge_win",
            challenge_id=eid,
            note=f"Won daily challenge: {template['title']}",
        )

    ref.update({
        "status": "claimed",
        "result": "won" if met_goal else "lost",
        "actualValue": actual,
        "claimedAt": now.isoformat(),
    })

    return {"result": "won" if met_goal else "lost", "creditsAwarded": credits_awarded}
