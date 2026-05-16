"""
Credits router — balance, transaction history, and spending credits to block friends.
"""

import logging
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from google.cloud.firestore_v1.base_query import FieldFilter
from pydantic import BaseModel

from auth import get_uid
from firestore_client import db
from services.challenge_service import deduct_credits

router = APIRouter(tags=["credits"])
logger = logging.getLogger(__name__)


# ── helpers ───────────────────────────────────────────────────────────

def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# ── request models ────────────────────────────────────────────────────

class SpendCreditsBody(BaseModel):
    target_user_id: str
    minutes: int


# ══════════════════════════════════════════════════════════════════════
# BALANCE
# ══════════════════════════════════════════════════════════════════════

@router.get("/api/credits/balance")
async def get_balance(uid: str = Depends(get_uid)):
    """Return the current blockCredits balance for the authenticated user."""
    doc = db.collection("users").document(uid).get()
    balance = 0
    if doc.exists:
        balance = doc.to_dict().get("blockCredits", 0)
    return {"balance": balance}


# ══════════════════════════════════════════════════════════════════════
# TRANSACTION HISTORY
# ══════════════════════════════════════════════════════════════════════

@router.get("/api/credits/transactions")
async def get_transactions(uid: str = Depends(get_uid)):
    """Return paginated credit transaction history (most recent first, limit 50)."""
    docs = list(
        db.collection("creditTransactions")
        .where(filter=FieldFilter("userId", "==", uid))
        .order_by("timestamp", direction="DESCENDING")
        .limit(50)
        .stream()
    )
    return [{"transactionId": d.id, **d.to_dict()} for d in docs]


# ══════════════════════════════════════════════════════════════════════
# SPEND
# ══════════════════════════════════════════════════════════════════════

@router.post("/api/credits/spend")
async def spend_credits(
    body: SpendCreditsBody,
    uid: str = Depends(get_uid),
):
    """
    Spend credits to block a friend.
    1 credit = 1 minute of blocked access.
    Validates minutes >= 1 and that the caller has sufficient balance.
    Returns the new balance after deduction.
    """
    if body.minutes < 1:
        raise HTTPException(status_code=400, detail="minutes must be at least 1")

    # Validate target user exists
    target_doc = db.collection("users").document(body.target_user_id).get()
    if not target_doc.exists:
        raise HTTPException(status_code=404, detail="Target user not found")

    deduct_credits(
        uid=uid,
        amount=body.minutes,
        type="spend_block",
        challenge_id=None,
        target_uid=body.target_user_id,
        note=f"Blocked {body.minutes} min",
    )

    # Read the new balance to return it
    user_doc = db.collection("users").document(uid).get()
    new_balance = 0
    if user_doc.exists:
        new_balance = user_doc.to_dict().get("blockCredits", 0)

    return {"success": True, "new_balance": new_balance}
