"""
Daily challenges router — static daily challenge templates with per-user enrollment.
"""

from fastapi import APIRouter, Depends

from auth import get_uid
from services.daily_challenge_service import (
    claim_daily_challenge,
    enter_daily_challenge,
    get_daily_challenges,
)

router = APIRouter(tags=["daily_challenges"])


@router.get("/api/challenges/daily")
async def list_daily_challenges(uid: str = Depends(get_uid)):
    """Return today's daily challenges with per-user enrollment state."""
    return get_daily_challenges(uid)


@router.post("/api/challenges/daily/{template_id}/enter", status_code=201)
async def enter_challenge(template_id: str, uid: str = Depends(get_uid)):
    """Stake credits and enroll in a daily challenge."""
    return enter_daily_challenge(uid, template_id)


@router.post("/api/challenges/daily/{template_id}/claim")
async def claim_challenge(template_id: str, uid: str = Depends(get_uid)):
    """Claim the result of today's daily challenge (available after midnight)."""
    return claim_daily_challenge(uid, template_id)
