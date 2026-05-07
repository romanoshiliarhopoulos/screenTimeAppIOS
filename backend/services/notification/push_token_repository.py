from datetime import datetime, timezone

from firestore_client import db


def save(user_id: str, device_id: str, expo_push_token: str, platform: str = "ios") -> None:
    (
        db.collection("users")
        .document(user_id)
        .collection("devices")
        .document(device_id)
        .set(
            {
                "expoPushToken": expo_push_token,
                "platform": platform,
                "lastSeenAt": datetime.now(timezone.utc).isoformat(),
            },
            merge=True,
        )
    )


def get_tokens_for_user(user_id: str) -> list[str]:
    """
    Returns push tokens for the user. Bark API key (from notificationSettings)
    takes priority. Falls back to Expo tokens stored in the devices subcollection.
    """
    # Check for Bark API key first
    settings_doc = (
        db.collection("users")
        .document(user_id)
        .collection("notificationSettings")
        .document("config")
        .get()
    )
    if settings_doc.exists:
        bark_key = settings_doc.to_dict().get("barkApiKey")
        if bark_key:
            return [f"bark:{bark_key}"]

    # Fall back to Expo tokens
    docs = (
        db.collection("users")
        .document(user_id)
        .collection("devices")
        .stream()
    )
    return [
        d.to_dict()["expoPushToken"]
        for d in docs
        if d.to_dict().get("expoPushToken")
    ]
