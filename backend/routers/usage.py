import os
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from pydantic import BaseModel
from typing import Optional
from auth import get_uid
from firestore_client import db
from models import UsagePayload
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
    payload: ShortcutPayload,
    _: None = Depends(_check_shortcut_key),
):
    """
    Called by iOS Shortcuts when a tracked app opens or closes.
    No Firebase ID token required — secured by a static API key instead.

    On every 'close' event, looks up the most recent 'open' event for the
    same (userId, deviceId, appName) tuple and writes a session document.
    """
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
        return {"status": "ok", "recorded": "open"}

    # --- Session reconstruction on close ---
    sessions_ref = db.collection("users").document(uid).collection("sessions")

    # Single-field filter only (no composite index required).
    # Extra conditions (deviceId, eventType) are applied in Python.
    device_filter = payload.deviceId or ""
    candidate_events = list(
        events_ref
        .where("appName", "==", payload.appName)
        .limit(200)
        .stream()
    )
    open_events = sorted(
        [
            d for d in candidate_events
            if d.to_dict().get("eventType") == "open"
            and d.to_dict().get("deviceId", "") == device_filter
        ],
        key=lambda d: d.to_dict().get("eventTime", ""),
        reverse=True,
    )

    if not open_events:
        return {"status": "ok", "recorded": "close", "session": None}

    open_time = open_events[0].to_dict()["eventTime"]

    # Check for unlock pattern — single-field filter, device filter in Python.
    previous_close_time: Optional[str] = None
    candidate_sessions = list(
        sessions_ref
        .where("appName", "==", payload.appName)
        .limit(50)
        .stream()
    )
    prev_sessions = sorted(
        [
            d for d in candidate_sessions
            if d.to_dict().get("deviceId", "") == device_filter
        ],
        key=lambda d: d.to_dict().get("closeTime", ""),
        reverse=True,
    )
    if prev_sessions:
        previous_close_time = prev_sessions[0].to_dict().get("closeTime")

    session = compute_session(
        payload.appName,
        open_time,
        event_time,
        uid,
        payload.deviceId,
        previous_close_time,
    )
    sessions_ref.add(session)
    update_daily_summary(uid, payload.appName, session["openTime"], session["durationSeconds"])

    return {"status": "ok", "recorded": "close", "durationSeconds": session["durationSeconds"]}


@router.post("", status_code=201)
async def log_usage(payload: UsagePayload, uid: str = Depends(get_uid)):
    """
    Called by iOS Shortcuts when a tracked app is closed.
    Stores the session and updates the daily summary.
    """
    sessions_ref = db.collection("users").document(uid).collection("sessions")

    # Check for the unlock pattern — single-field filter to avoid composite index.
    previous_close_time: Optional[str] = None
    if payload.device_id:
        candidate_sessions = list(
            sessions_ref
            .where("appName", "==", payload.app_name)
            .limit(50)
            .stream()
        )
        prev_sessions = sorted(
            [
                d for d in candidate_sessions
                if d.to_dict().get("deviceId", "") == payload.device_id
            ],
            key=lambda d: d.to_dict().get("closeTime", ""),
            reverse=True,
        )
        if prev_sessions:
            previous_close_time = prev_sessions[0].to_dict().get("closeTime")

    session = compute_session(
        payload.app_name,
        payload.open_time,
        payload.close_time,
        uid,
        payload.device_id,
        previous_close_time,
    )
    sessions_ref.add(session)
    update_daily_summary(uid, payload.app_name, session["openTime"], session["durationSeconds"])

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
