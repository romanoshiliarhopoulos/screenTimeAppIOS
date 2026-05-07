import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from auth import get_uid
from services.notification import notification_service

router = APIRouter(tags=["notifications"])
logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Cron endpoint — called by cron-job.org every 5 minutes
# Secured by CRON_SECRET header (set in Vercel env vars)
# ---------------------------------------------------------------------------

@router.post("/api/cron/check-active-sessions")
def check_active_sessions():
    """
    Scans all open activeSessions and fires personal/friend alerts
    for any session that has crossed its configured threshold.
    Called by an external cron service (e.g. cron-job.org) every 5 minutes.
    """
    summaries = notification_service.check_active_sessions()
    logger.info("cron: evaluated %d active sessions", len(summaries))
    return {"checked": len(summaries), "results": summaries}


# ---------------------------------------------------------------------------
# Shame endpoint — authenticated user shames a friend who is live
# ---------------------------------------------------------------------------

@router.post("/api/users/{friend_id}/shame", status_code=200)
def shame_friend(friend_id: str, uid: str = Depends(get_uid)):
    """
    Send a shame push notification to a friend who is currently in an active session.
    Rate-limited per sender per target (default: once per 30 minutes).
    """
    decision = notification_service.send_shame(from_user_id=uid, to_user_id=friend_id)
    return {"status": decision.status, "reason": getattr(decision, "reason", None)}


# ---------------------------------------------------------------------------
# Push token registration
# ---------------------------------------------------------------------------

class PushTokenPayload(BaseModel):
    deviceId: str
    expoPushToken: str
    platform: str = "ios"


@router.post("/api/users/me/push-token", status_code=201)
def register_push_token(payload: PushTokenPayload, uid: str = Depends(get_uid)):
    """Register or update the Expo push token for a device."""
    notification_service.register_push_token(
        user_id=uid,
        device_id=payload.deviceId,
        expo_push_token=payload.expoPushToken,
        platform=payload.platform,
    )
    return {"status": "ok"}


# ---------------------------------------------------------------------------
# Notification settings
# ---------------------------------------------------------------------------

class NotificationSettingsPayload(BaseModel):
    enabled: Optional[bool] = None
    userAlertThresholdSeconds: Optional[int] = None
    friendAlertThresholdSeconds: Optional[int] = None
    dailyCapSeconds: Optional[int] = None
    cooldownSeconds: Optional[int] = None
    shameCooldownSeconds: Optional[int] = None
    trackedApps: Optional[list[str]] = None
    quietHoursStart: Optional[str] = None
    quietHoursEnd: Optional[str] = None
    allowFriendsToSeeLiveSessions: Optional[bool] = None
    sendCloseSessionSummaryToFriends: Optional[bool] = None


@router.put("/api/users/me/notification-settings", status_code=200)
def update_notification_settings(
    payload: NotificationSettingsPayload, uid: str = Depends(get_uid)
):
    """Save notification preferences for the authenticated user."""
    data = {k: v for k, v in payload.model_dump().items() if v is not None}
    notification_service.update_settings(user_id=uid, data=data)
    return {"status": "ok"}


# ---------------------------------------------------------------------------
# Live presence — which friends are currently in an active session
# ---------------------------------------------------------------------------

@router.get("/api/users/me/live-friends")
def get_live_friends(uid: str = Depends(get_uid)):
    """
    Return friends who currently have an open activeSession document.
    Used by the friend feed / shame screen on the frontend.
    """
    from firestore_client import db
    from services.notification.active_session_repository import get_active_for_user

    # Get user's groups to find friend IDs
    groups = (
        db.collection("groups")
        .where("memberIds", "array_contains", uid)
        .stream()
    )
    friend_ids: set[str] = set()
    for group in groups:
        for member_id in group.to_dict().get("memberIds", []):
            if member_id != uid:
                friend_ids.add(member_id)

    live = []
    for friend_id in friend_ids:
        active_sessions = get_active_for_user(friend_id)
        for session in active_sessions:
            # Only include if user allows it
            from services.notification.settings_repository import load as load_settings
            friend_settings = load_settings(friend_id)
            if not friend_settings.allowFriendsToSeeLiveSessions:
                continue

            # Get display name
            profile_doc = (
                db.collection("users")
                .document(friend_id)
                .collection("profile")
                .document("info")
                .get()
            )
            display_name = (
                profile_doc.to_dict().get("displayName", "A friend")
                if profile_doc.exists
                else "A friend"
            )

            live.append({
                "userId": friend_id,
                "displayName": display_name,
                "appName": session.get("appName"),
                "openTime": session.get("openTime"),
            })

    return {"live": live}
