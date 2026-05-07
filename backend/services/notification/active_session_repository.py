from datetime import datetime, timezone, timedelta
from typing import Optional

from firestore_client import db


def _doc_id(user_id: str, device_id: str, app_name: str) -> str:
    safe_device = (device_id or "default").replace(" ", "_")
    safe_app = app_name.replace(" ", "_")
    return f"{user_id}_{safe_device}_{safe_app}"


def upsert(user_id: str, device_id: str, app_name: str, open_time: str) -> None:
    doc_id = _doc_id(user_id, device_id, app_name)
    db.collection("activeSessions").document(doc_id).set({
        "userId": user_id,
        "deviceId": device_id or "",
        "appName": app_name,
        "openTime": open_time,
        "notifiedUser": False,
        "notifiedFriends": False,
        "createdAt": datetime.now(timezone.utc).isoformat(),
    })


def get(user_id: str, device_id: str, app_name: str) -> Optional[dict]:
    doc_id = _doc_id(user_id, device_id, app_name)
    doc = db.collection("activeSessions").document(doc_id).get()
    if not doc.exists:
        return None
    return {"id": doc.id, **doc.to_dict()}


def mark_user_notified(user_id: str, device_id: str, app_name: str) -> None:
    doc_id = _doc_id(user_id, device_id, app_name)
    db.collection("activeSessions").document(doc_id).update({"notifiedUser": True})


def mark_friends_notified(user_id: str, device_id: str, app_name: str) -> None:
    doc_id = _doc_id(user_id, device_id, app_name)
    db.collection("activeSessions").document(doc_id).update({"notifiedFriends": True})


def delete_and_return(user_id: str, device_id: str, app_name: str) -> Optional[dict]:
    """Delete the active session doc and return its data (needed to check flags before deletion)."""
    doc_id = _doc_id(user_id, device_id, app_name)
    doc = db.collection("activeSessions").document(doc_id).get()
    if not doc.exists:
        return None
    data = {"id": doc.id, **doc.to_dict()}
    db.collection("activeSessions").document(doc_id).delete()
    return data


def get_all_stale(min_elapsed_seconds: int) -> list[dict]:
    """Return all activeSessions whose openTime is older than min_elapsed_seconds."""
    cutoff = (
        datetime.now(timezone.utc) - timedelta(seconds=min_elapsed_seconds)
    ).isoformat()
    docs = (
        db.collection("activeSessions")
        .where("openTime", "<=", cutoff)
        .stream()
    )
    return [{"id": d.id, **d.to_dict()} for d in docs]


def get_active_for_user(user_id: str) -> list[dict]:
    """Return all active sessions for a given user."""
    docs = (
        db.collection("activeSessions")
        .where("userId", "==", user_id)
        .stream()
    )
    return [{"id": d.id, **d.to_dict()} for d in docs]
