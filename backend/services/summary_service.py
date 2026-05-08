from datetime import datetime, timezone, timedelta
from firestore_client import db


def update_daily_summary(uid: str, app_name: str, open_time: str, duration_seconds: int) -> int:
    """Upsert the dailySummary document for the date of open_time.
    Returns the new totalSeconds for the day (used for daily cap checks)."""
    date_str = open_time[:10]  # YYYY-MM-DD
    ref = (
        db.collection("users")
        .document(uid)
        .collection("dailySummaries")
        .document(date_str)
    )

    # Approximate close time = open + duration
    try:
        close_dt = datetime.fromisoformat(open_time.replace("Z", "+00:00")) + timedelta(seconds=duration_seconds)
        last_seen_at = close_dt.isoformat()
    except Exception:
        last_seen_at = datetime.now(timezone.utc).isoformat()

    doc = ref.get()
    if doc.exists:
        data = doc.to_dict()
        by_app: dict = data.get("byApp", {})
        by_app[app_name] = by_app.get(app_name, 0) + duration_seconds
        new_total = data.get("totalSeconds", 0) + duration_seconds
        ref.update(
            {
                "totalSeconds": new_total,
                "sessionCount": data.get("sessionCount", 0) + 1,
                "byApp": by_app,
                "maxSessionSeconds": max(data.get("maxSessionSeconds", 0), duration_seconds),
                "lastSeenAt": last_seen_at,
            }
        )
    else:
        new_total = duration_seconds
        ref.set(
            {
                "date": date_str,
                "totalSeconds": new_total,
                "sessionCount": 1,
                "byApp": {app_name: duration_seconds},
                "maxSessionSeconds": duration_seconds,
                "lastSeenAt": last_seen_at,
            }
        )
    return new_total
