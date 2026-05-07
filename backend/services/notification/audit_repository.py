from datetime import datetime, timezone

from firestore_client import db


def record(
    user_id: str,
    notification_type: str,
    app_name: str,
    delivery_status: str,
    triggered_by: str,
    skip_reason: str = "",
    session_seconds: int = 0,
) -> str:
    ref = db.collection("users").document(user_id).collection("notifications").document()
    ref.set({
        "type": notification_type,
        "appName": app_name,
        "sessionSeconds": session_seconds,
        "sentAt": datetime.now(timezone.utc).isoformat(),
        "deliveryStatus": delivery_status,
        "skipReason": skip_reason,
        "triggeredBy": triggered_by,
    })
    return ref.id


def was_notified_today(user_id: str, notification_type: str, app_name: str) -> bool:
    today = datetime.now(timezone.utc).date().isoformat()
    docs = list(
        db.collection("users")
        .document(user_id)
        .collection("notifications")
        .where("type", "==", notification_type)
        .where("appName", "==", app_name)
        .where("deliveryStatus", "==", "sent")
        .where("sentAt", ">=", f"{today}T00:00:00+00:00")
        .limit(1)
        .stream()
    )
    return len(docs) > 0
