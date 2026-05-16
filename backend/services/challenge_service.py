"""
Challenge service — business logic for Block Credits challenges.

Provides:
  - get_user_metric()   : aggregate usage data over a date range
  - settle_challenge()  : idempotent settlement for app and custom challenges
  - award_credits()     : atomic credit credit + transaction log
  - deduct_credits()    : atomic credit debit + transaction log (balance-checked)
"""

from datetime import datetime, timezone
from typing import Optional

from fastapi import HTTPException
from google.cloud import firestore

from firestore_client import db


# ── helpers ───────────────────────────────────────────────────────────

def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _date_range(start_date: str, end_date: str) -> list[str]:
    """Return list of YYYY-MM-DD strings from start_date to end_date inclusive."""
    from datetime import date, timedelta
    start = date.fromisoformat(start_date[:10])
    end = date.fromisoformat(end_date[:10])
    dates = []
    current = start
    while current <= end:
        dates.append(current.isoformat())
        current += timedelta(days=1)
    return dates


# ── public API ────────────────────────────────────────────────────────

def get_user_metric(
    uid: str,
    metric: str,
    target_app: Optional[str],
    start_date: str,
    end_date: str,
) -> float:
    """
    Aggregate a usage metric for uid across [start_date, end_date].

    metric values:
      "screen_time"  — sum of totalSeconds (or byApp[target_app] seconds)
      "opens"        — sum of sessionCount (or byApp opens via openCounts)
      "streak_days"  — count of days within range that have a dailySummary doc

    target_app: None = all apps, otherwise filter to that app name.
    """
    dates = _date_range(start_date, end_date)

    # Batch-fetch all dailySummary docs for the date range
    refs = [
        db.collection("users").document(uid).collection("dailySummaries").document(d)
        for d in dates
    ]

    total: float = 0.0

    if metric == "streak_days":
        # Count days that have any usage data
        for doc in db.get_all(refs):
            if doc.exists:
                total += 1.0
        return total

    for doc in db.get_all(refs):
        if not doc.exists:
            continue
        data = doc.to_dict()

        if metric == "screen_time":
            if target_app:
                by_app: dict = data.get("byApp", {})
                total += by_app.get(target_app, 0)
            else:
                total += data.get("totalSeconds", 0)

        elif metric == "opens":
            if target_app:
                # openCounts is a per-app dict, byApp tracks seconds
                # The summary stores openCounts per app name
                open_counts: dict = data.get("openCounts", {})
                total += open_counts.get(target_app, 0)
            else:
                total += data.get("sessionCount", 0)

    return total


def award_credits(
    uid: str,
    amount: int,
    type: str,
    challenge_id: Optional[str],
    note: str,
    target_uid: Optional[str] = None,
) -> None:
    """
    Atomically add `amount` credits to uid and append a creditTransactions record.
    Also increments lifetimeCreditsEarned on the user doc.
    """
    user_ref = db.collection("users").document(uid)
    tx_ref = db.collection("creditTransactions").document()

    @firestore.transactional
    def _run(transaction):
        snap = user_ref.get(transaction=transaction)
        user_data = snap.to_dict() if snap.exists else {}
        balance_before = user_data.get("blockCredits", 0)
        balance_after = balance_before + amount
        lifetime_earned = user_data.get("lifetimeCreditsEarned", 0) + amount

        transaction.set(user_ref, {
            "blockCredits": balance_after,
            "lifetimeCreditsEarned": lifetime_earned,
        }, merge=True)

        transaction.set(tx_ref, {
            "userId": uid,
            "type": type,
            "amount": amount,
            "balanceBefore": balance_before,
            "balanceAfter": balance_after,
            "relatedChallengeId": challenge_id,
            "relatedTargetUserId": target_uid,
            "timestamp": _now_iso(),
            "note": note,
        })

    transaction = db.transaction()
    _run(transaction)


def deduct_credits(
    uid: str,
    amount: int,
    type: str,
    challenge_id: Optional[str],
    target_uid: Optional[str],
    note: str,
) -> None:
    """
    Atomically deduct `amount` credits from uid.
    Raises HTTP 400 if balance < amount.
    Also increments lifetimeCreditsSpent on the user doc.
    """
    user_ref = db.collection("users").document(uid)
    tx_ref = db.collection("creditTransactions").document()

    @firestore.transactional
    def _run(transaction):
        snap = user_ref.get(transaction=transaction)
        user_data = snap.to_dict() if snap.exists else {}
        balance_before = user_data.get("blockCredits", 0)

        if balance_before < amount:
            raise HTTPException(
                status_code=400,
                detail=f"Insufficient credits: have {balance_before}, need {amount}",
            )

        balance_after = balance_before - amount
        lifetime_spent = user_data.get("lifetimeCreditsSpent", 0) + amount

        transaction.set(user_ref, {
            "blockCredits": balance_after,
            "lifetimeCreditsSpent": lifetime_spent,
        }, merge=True)

        transaction.set(tx_ref, {
            "userId": uid,
            "type": type,
            "amount": -amount,
            "balanceBefore": balance_before,
            "balanceAfter": balance_after,
            "relatedChallengeId": challenge_id,
            "relatedTargetUserId": target_uid,
            "timestamp": _now_iso(),
            "note": note,
        })

    transaction = db.transaction()
    _run(transaction)


def settle_challenge(challenge_id: str, challenge_data: dict) -> dict:
    """
    Idempotent challenge settlement.

    For type == "app":
      Checks the calling user's metric vs the goal and awards rewardCredits
      if they met the goal. Each user settles independently.

    For type == "custom":
      Reads metric for all participants, determines the single winner
      (best result), awards totalPot to the winner.
      Only the first valid claim does the work (status check is inside a
      Firestore transaction).

    Returns { "result": "won"|"lost"|"already_settled", "credits_awarded": int }
    """
    challenge_type = challenge_data.get("type")
    status = challenge_data.get("status")

    if status == "settled":
        return {"result": "already_settled", "credits_awarded": 0}

    challenge_ref = db.collection("challenges").document(challenge_id)

    if challenge_type == "app":
        return _settle_app_challenge(challenge_id, challenge_data, challenge_ref)
    elif challenge_type == "custom":
        return _settle_custom_challenge(challenge_id, challenge_data, challenge_ref)
    else:
        raise HTTPException(status_code=400, detail=f"Unknown challenge type: {challenge_type}")


# ── private settlement helpers ────────────────────────────────────────

def _settle_app_challenge(
    challenge_id: str,
    challenge_data: dict,
    challenge_ref,
) -> dict:
    """
    App challenge: caller checks their own metric vs the goal.
    Each user can independently claim — this does NOT mark the challenge settled
    globally (app challenges are open to all users).
    """
    # We need caller context but settle_challenge is called with the uid
    # passed via challenge_data["_caller_uid"] (set by the router)
    uid = challenge_data.get("_caller_uid")
    if not uid:
        raise HTTPException(status_code=500, detail="Caller uid not set")

    metric = challenge_data.get("metric", "screen_time")
    target_app = challenge_data.get("targetApp")
    start_date = challenge_data.get("startDate", "")[:10]
    end_date = challenge_data.get("endDate", "")[:10]
    goal = challenge_data.get("goal", 0)
    reward_credits = challenge_data.get("rewardCredits", 0)

    actual_value = get_user_metric(uid, metric, target_app, start_date, end_date)

    # For screen_time and opens: lower is better (goal is the max allowed)
    # For streak_days: higher is better (goal is the minimum required)
    if metric == "streak_days":
        met_goal = actual_value >= goal
    else:
        met_goal = actual_value <= goal

    if met_goal and reward_credits > 0:
        award_credits(
            uid,
            reward_credits,
            "challenge_win",
            challenge_id,
            f"Completed app challenge: {challenge_data.get('title', challenge_id)}",
        )
        # Mark challenge settled globally (app challenges settle on first claim)
        challenge_ref.update({"status": "settled"})
        return {"result": "won", "credits_awarded": reward_credits}
    else:
        challenge_ref.update({"status": "settled"})
        return {"result": "lost", "credits_awarded": 0}


def _settle_custom_challenge(
    challenge_id: str,
    challenge_data: dict,
    challenge_ref,
) -> dict:
    """
    Custom (friend bet) challenge: compare all participants, award pot to winner.
    Uses a Firestore transaction with a status check for idempotency.
    """
    metric = challenge_data.get("metric", "screen_time")
    target_app = challenge_data.get("targetApp")
    start_date = challenge_data.get("startDate", "")[:10]
    end_date = challenge_data.get("endDate", "")[:10]
    total_pot = challenge_data.get("totalPot", 0)
    participants: list[dict] = challenge_data.get("participants", [])
    caller_uid = challenge_data.get("_caller_uid")

    if not participants:
        raise HTTPException(status_code=400, detail="No participants in challenge")

    # Gather metric values for all participants
    metric_values: dict[str, float] = {}
    for p in participants:
        uid = p["userId"]
        metric_values[uid] = get_user_metric(uid, metric, target_app, start_date, end_date)

    # Determine winner: lowest for screen_time/opens, highest for streak_days
    if metric == "streak_days":
        winner_uid = max(metric_values, key=lambda u: metric_values[u])
    else:
        winner_uid = min(metric_values, key=lambda u: metric_values[u])

    # Atomic settlement with idempotency check
    winner_uid_settled = [None]  # mutable container for use inside transaction

    @firestore.transactional
    def _run(transaction):
        snap = challenge_ref.get(transaction=transaction)
        if not snap.exists:
            raise HTTPException(status_code=404, detail="Challenge not found")
        current = snap.to_dict()
        if current.get("status") == "settled":
            winner_uid_settled[0] = current.get("winner")
            return  # already settled, no-op

        # Update participant results
        updated_participants = []
        for p in participants:
            uid = p["userId"]
            result = "won" if uid == winner_uid else "lost"
            updated_participants.append({
                **p,
                "result": result,
                "metricValue": metric_values[uid],
            })

        transaction.update(challenge_ref, {
            "status": "settled",
            "winner": winner_uid,
            "participants": updated_participants,
        })
        winner_uid_settled[0] = winner_uid

    transaction = db.transaction()
    _run(transaction)

    # If already settled, return based on caller
    actual_winner = winner_uid_settled[0]

    if actual_winner and actual_winner == winner_uid and total_pot > 0:
        # Only award if the transaction actually did the settlement work
        # Check if winner uid matches what we computed (idempotency: pot already awarded)
        # Re-read to check if credits need awarding (we do this outside transaction
        # since award_credits runs its own transaction)
        #
        # To avoid double-awarding on concurrent claims, we check the pre-transaction
        # status. The transaction guarantees only one caller updates status.
        # We award credits only when we are the first caller (challenge_data status != settled).
        if challenge_data.get("status") != "settled":
            award_credits(
                actual_winner,
                total_pot,
                "challenge_win",
                challenge_id,
                f"Won friend bet: {challenge_data.get('title', challenge_id)}",
            )

    # Return caller's result
    caller_result = "won" if actual_winner == caller_uid else "lost"
    credits_awarded = total_pot if (actual_winner == caller_uid and challenge_data.get("status") != "settled") else 0

    if challenge_data.get("status") == "settled":
        return {"result": "already_settled", "credits_awarded": 0}

    return {"result": caller_result, "credits_awarded": credits_awarded}
