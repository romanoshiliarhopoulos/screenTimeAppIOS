from datetime import datetime, timezone

from firestore_client import db
from .models import NotificationSettings


def load(user_id: str) -> NotificationSettings:
    doc = (
        db.collection("users")
        .document(user_id)
        .collection("notificationSettings")
        .document("config")
        .get()
    )
    if not doc.exists:
        return NotificationSettings()
    d = doc.to_dict()
    return NotificationSettings(
        enabled=d.get("enabled", True),
        userAlertThresholdSeconds=d.get("userAlertThresholdSeconds", 420),
        friendAlertThresholdSeconds=d.get("friendAlertThresholdSeconds", 900),
        dailyCapSeconds=d.get("dailyCapSeconds", 3600),
        cooldownSeconds=d.get("cooldownSeconds", 7200),
        shameCooldownSeconds=d.get("shameCooldownSeconds", 1800),
        trackedApps=d.get("trackedApps", []),
        quietHoursStart=d.get("quietHoursStart"),
        quietHoursEnd=d.get("quietHoursEnd"),
        allowFriendsToSeeLiveSessions=d.get("allowFriendsToSeeLiveSessions", True),
        sendCloseSessionSummaryToFriends=d.get("sendCloseSessionSummaryToFriends", True),
    )


def save(user_id: str, data: dict) -> None:
    data["updatedAt"] = datetime.now(timezone.utc).isoformat()
    (
        db.collection("users")
        .document(user_id)
        .collection("notificationSettings")
        .document("config")
        .set(data, merge=True)
    )
