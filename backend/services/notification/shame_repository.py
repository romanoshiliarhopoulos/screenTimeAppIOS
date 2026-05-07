from datetime import datetime, timezone, timedelta

from firestore_client import db


def record(from_user_id: str, to_user_id: str, app_name: str) -> str:
    now = datetime.now(timezone.utc).isoformat()
    ref = db.collection("shameEvents").document()
    ref.set({
        "fromUserId": from_user_id,
        "toUserId": to_user_id,
        "appName": app_name,
        "sentAt": now,
    })
    return ref.id


def is_on_cooldown(from_user_id: str, to_user_id: str, cooldown_seconds: int) -> bool:
    cutoff = (
        datetime.now(timezone.utc) - timedelta(seconds=cooldown_seconds)
    ).isoformat()
    docs = list(
        db.collection("shameEvents")
        .where("fromUserId", "==", from_user_id)
        .where("toUserId", "==", to_user_id)
        .where("sentAt", ">=", cutoff)
        .limit(1)
        .stream()
    )
    return len(docs) > 0
