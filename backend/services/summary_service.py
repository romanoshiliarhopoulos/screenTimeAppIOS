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
            }
        )
    return new_total
