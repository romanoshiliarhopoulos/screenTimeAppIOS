import os
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from pydantic import BaseModel
from typing import Optional
from auth import get_uid
from firestore_client import db
from models import UsagePayload
from services.notification import notification_service
from services.session_service import compute_session
from services.summary_service import update_daily_summary

router = APIRouter(prefix="/api/usage", tags=["usage"])

# ---------------------------------------------------------------------------
# Shortcuts-compatible endpoint — no expiring Firebase token required.
# Secured by a static API key set in the SHORTCUT_API_KEY environment variable.
# If the env var is not set, the endpoint is open (fine for local dev).
# ---------------------------------------------------------------------------

class ShortcutPayload(BaseModel):
    userId: str
    deviceId: Optional[str] = None
    appName: str
    eventType: str                   # "open" or "close"
    eventTime: Optional[str] = None  # ISO 8601; falls back to server time if omitted/empty


def _check_shortcut_key(x_api_key: Optional[str] = Header(None)):
    required = os.environ.get("SHORTCUT_API_KEY", "")
    if required and x_api_key != required:
        raise HTTPException(status_code=401, detail="Invalid API key")


@router.post("/record", status_code=201)
async def record_usage(
    payload: Optional[ShortcutPayload] = None,
    userId: Optional[str] = Query(None),
    appName: Optional[str] = Query(None),
    eventType: Optional[str] = Query(None),
    eventTime: Optional[str] = Query(None),
    deviceId: Optional[str] = Query(None),
    _: None = Depends(_check_shortcut_key),
):
    """
    Called by iOS Shortcuts when a tracked app opens or closes.
    No Firebase ID token required — secured by a static API key instead.

    On every 'close' event, looks up the most recent 'open' event for the
    same (userId, deviceId, appName) tuple and writes a session document.
    """
    if payload is None:
        if not userId or not appName or not eventType:
            raise HTTPException(status_code=422, detail="Missing required fields: userId, appName, eventType")
        payload = ShortcutPayload(
            userId=userId, appName=appName, eventType=eventType,
            eventTime=eventTime, deviceId=deviceId,
        )

    uid = payload.userId
    now = datetime.now(timezone.utc).isoformat()
    event_time = payload.eventTime if payload.eventTime else now
    events_ref = db.collection("users").document(uid).collection("events")

    # Persist the raw event
    event_doc = {
        "userId": uid,
        "deviceId": payload.deviceId or "",
        "appName": payload.appName,
        "eventType": payload.eventType,
        "eventTime": event_time,
        "createdAt": now,
    }
    events_ref.add(event_doc)

    if payload.eventType != "close":
        # Track the open session for live presence + timer-based notifications
        notification_service.on_session_open(
            user_id=uid,
            device_id=payload.deviceId or "",
            app_name=payload.appName,
            open_time=event_time,
        )
        return {"status": "ok", "recorded": "open"}

    # --- Session reconstruction on close ---
    sessions_ref = db.collection("users").document(uid).collection("sessions")
    device_filter = payload.deviceId or ""

    # Fetch recent open events by appName only (single-field — no composite index needed).
    # Sort and filter in Python to avoid requiring a Firestore composite index.
    open_event_docs = list(
        events_ref
        .where("appName", "==", payload.appName)
        .where("eventType", "==", "open")
        .limit(50)
        .stream()
    )
    open_event_docs.sort(key=lambda d: d.to_dict().get("eventTime", ""), reverse=True)

    matching_open = None
    for d in open_event_docs:
        if d.to_dict().get("deviceId", "") == device_filter:
            matching_open = d
            break

    if not matching_open:
        return {"status": "ok", "recorded": "close", "session": None}

    open_time = matching_open.to_dict()["eventTime"]

    # Delete the matched open event so it can never be reused by a future close.
    matching_open.reference.delete()

    # Fetch recent sessions by appName only (single-field — no composite index needed).
    previous_close_time: Optional[str] = None
    session_docs = list(
        sessions_ref
        .where("appName", "==", payload.appName)
        .limit(50)
        .stream()
    )
    session_docs.sort(key=lambda d: d.to_dict().get("closeTime", ""), reverse=True)
    for d in session_docs:
        if d.to_dict().get("deviceId", "") == device_filter:
            previous_close_time = d.to_dict().get("closeTime")
            break

    session = compute_session(
        payload.appName,
        open_time,
        event_time,
        uid,
        payload.deviceId,
        previous_close_time,
    )
    sessions_ref.add(session)
    daily_total = update_daily_summary(uid, payload.appName, session["openTime"], session["durationSeconds"])

    # Notifications: delete activeSession, check daily cap, send close summary to friends
    notification_service.on_session_close(
        user_id=uid,
        device_id=payload.deviceId or "",
        app_name=payload.appName,
        duration_seconds=session["durationSeconds"],
        daily_total_seconds=daily_total,
    )

    # Update streak
    from routers.social import update_streak
    try:
        update_streak(uid)
    except Exception:
        pass  # non-critical

    return {"status": "ok", "recorded": "close", "durationSeconds": session["durationSeconds"]}


@router.post("", status_code=201)
async def log_usage(payload: UsagePayload, uid: str = Depends(get_uid)):
    """
    Called by iOS Shortcuts when a tracked app is closed.
    Stores the session and updates the daily summary.
    """
    sessions_ref = db.collection("users").document(uid).collection("sessions")

    # Check for the unlock pattern — single-field query, sort in Python.
    previous_close_time: Optional[str] = None
    if payload.device_id:
        session_docs = list(
            sessions_ref
            .where("appName", "==", payload.app_name)
            .limit(50)
            .stream()
        )
        session_docs.sort(key=lambda d: d.to_dict().get("closeTime", ""), reverse=True)
        for d in session_docs:
            if d.to_dict().get("deviceId", "") == payload.device_id:
                previous_close_time = d.to_dict().get("closeTime")
                break

    session = compute_session(
        payload.app_name,
        payload.open_time,
        payload.close_time,
        uid,
        payload.device_id,
        previous_close_time,
    )
    sessions_ref.add(session)
    daily_total = update_daily_summary(uid, payload.app_name, session["openTime"], session["durationSeconds"])

    notification_service.on_session_close(
        user_id=uid,
        device_id=payload.device_id or "",
        app_name=payload.app_name,
        duration_seconds=session["durationSeconds"],
        daily_total_seconds=daily_total,
    )

    return {"status": "ok", "durationSeconds": session["durationSeconds"], "status_flag": session["status"]}


@router.get("/sessions")
async def get_sessions(
    date: Optional[str] = Query(None, description="Filter by date, YYYY-MM-DD"),
    uid: str = Depends(get_uid),
):
    """Return raw sessions for the authenticated user, optionally filtered by date."""
    ref = db.collection("users").document(uid).collection("sessions")
    if date:
        ref = (
            ref.where("openTime", ">=", f"{date}T00:00:00")
               .where("openTime", "<=", f"{date}T23:59:59Z")
        )
    docs = ref.order_by("openTime", direction="DESCENDING").limit(200).stream()
    return [{"id": d.id, **d.to_dict()} for d in docs]


@router.get("/stats")
async def get_stats(
    start: Optional[str] = Query(None, description="Start date YYYY-MM-DD (inclusive)"),
    end: Optional[str] = Query(None, description="End date YYYY-MM-DD (inclusive)"),
    uid: str = Depends(get_uid),
):
    """
    Return daily stats from dailySummaries — the same source as the leaderboard,
    so numbers are always consistent. Includes maxSessionSeconds for the HomeScreen.
    Single-field range query on 'date'; no composite index required.
    """
    ref = db.collection("users").document(uid).collection("dailySummaries")
    if start:
        ref = ref.where("date", ">=", start)
    if end:
        ref = ref.where("date", "<=", end)
    docs = ref.order_by("date", direction="DESCENDING").limit(200).stream()

    results = []
    for d in docs:
        data = d.to_dict()
        results.append({
            "date": data.get("date", d.id),
            "totalSeconds": data.get("totalSeconds", 0),
            "sessionCount": data.get("sessionCount", 0),
            "maxSessionSeconds": data.get("maxSessionSeconds", 0),
            "byApp": data.get("byApp", {}),
        })
    return results


@router.get("/summary")
async def get_summary(
    start: Optional[str] = Query(None, description="Start date YYYY-MM-DD (inclusive)"),
    end: Optional[str] = Query(None, description="End date YYYY-MM-DD (inclusive)"),
    uid: str = Depends(get_uid),
):
    """Return daily summaries for the authenticated user."""
    ref = db.collection("users").document(uid).collection("dailySummaries")
    if start:
        ref = ref.where("date", ">=", start)
    if end:
        ref = ref.where("date", "<=", end)
    docs = ref.order_by("date", direction="DESCENDING").limit(30).stream()
    return [{"date": d.id, **d.to_dict()} for d in docs]
