"""
Backfills Instagram screen-time data from ../screentime.csv into Firestore.

Writes ONLY sessions + dailySummaries (no raw events — the app never reads them
for stats, so this is sufficient). Total writes ≈ 1,850 docs.

Quota-friendly approach:
  • Pre-compute every dailySummary in Python  → 0 reads from Firestore
  • Batch writes (BATCH_SIZE docs per commit) → fewer round-trips
  • Sleep + exponential-backoff retry on 429  → stays inside Spark free-tier

Run from the backend directory:
    python backfill_instagram.py
"""
import sys, os, csv, time
from datetime import datetime, timezone, timedelta

# ── .env loader ───────────────────────────────────────────────────────────────
_env_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env")
if os.path.exists(_env_path):
    with open(_env_path) as _f:
        for _line in _f:
            _line = _line.strip()
            if _line and not _line.startswith("#") and "=" in _line:
                _k, _, _v = _line.partition("=")
                _v = _v.strip()
                if len(_v) >= 2 and _v[0] in ('"', "'") and _v[-1] == _v[0]:
                    _v = _v[1:-1]
                os.environ.setdefault(_k.strip(), _v)

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import firestore_client
from firestore_client import db

# ── Config ────────────────────────────────────────────────────────────────────
USER_ID     = "zJHMK6iYW7M3THkCFZ2bsBv5sbG2"
DEVICE_ID   = "iPhone (7)"
APP_NAME    = "instagram"
TZ_OFFSET   = timezone(timedelta(hours=-5))   # user local time
BATCH_SIZE  = 75                              # docs per batch commit
BATCH_SLEEP = 2.0                             # seconds between batches
MAX_RETRIES = 6                               # per batch, with backoff

CSV_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "screentime.csv")

# ── Helpers ───────────────────────────────────────────────────────────────────

def to_event_time(naive_iso: str) -> str:
    dt = datetime.fromisoformat(naive_iso).replace(tzinfo=TZ_OFFSET)
    return dt.strftime("%Y-%m-%dT%H:%M:%S") + "-05:00"

def commit_with_retry(batch_fn):
    """Call batch_fn() which calls b.commit(). Retry on 429 with backoff."""
    from google.api_core.exceptions import ResourceExhausted, RetryError
    delay = 5.0
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            batch_fn()
            return
        except (ResourceExhausted, RetryError) as exc:
            if attempt == MAX_RETRIES:
                raise
            print(f"    429 quota hit — waiting {delay:.0f}s before retry {attempt}/{MAX_RETRIES} …")
            time.sleep(delay)
            delay = min(delay * 2, 120)

def write_docs(col_ref, docs: list, label: str):
    """Write a list of dicts into col_ref (auto-IDs) using small batched commits."""
    total = len(docs)
    for start in range(0, total, BATCH_SIZE):
        chunk = docs[start : start + BATCH_SIZE]
        def do_commit(chunk=chunk):
            b = db.batch()
            for doc in chunk:
                b.set(col_ref.document(), doc)
            b.commit()
        commit_with_retry(do_commit)
        end = min(start + BATCH_SIZE, total)
        print(f"  [{label}] {end}/{total}")
        if end < total:
            time.sleep(BATCH_SLEEP)

def write_summaries(summaries: dict, label: str):
    """Write dailySummary docs (keyed by date string) using small batched commits."""
    ref = db.collection("users").document(USER_ID).collection("dailySummaries")
    items = sorted(summaries.items())
    total = len(items)
    for start in range(0, total, BATCH_SIZE):
        chunk = items[start : start + BATCH_SIZE]
        def do_commit(chunk=chunk):
            b = db.batch()
            for date_str, data in chunk:
                b.set(ref.document(date_str), data)
            b.commit()
        commit_with_retry(do_commit)
        end = min(start + BATCH_SIZE, total)
        print(f"  [{label}] {end}/{total}")
        if end < total:
            time.sleep(BATCH_SLEEP)

def delete_summaries(date_set: set):
    ref = db.collection("users").document(USER_ID).collection("dailySummaries")
    dates = sorted(date_set)
    total = len(dates)
    print(f"Clearing {total} dailySummary docs …")
    for start in range(0, total, BATCH_SIZE):
        chunk = dates[start : start + BATCH_SIZE]
        def do_commit(chunk=chunk):
            b = db.batch()
            for d in chunk:
                b.delete(ref.document(d))
            b.commit()
        commit_with_retry(do_commit)
        end = min(start + BATCH_SIZE, total)
        print(f"  [delete] {end}/{total}")
        if end < total:
            time.sleep(BATCH_SLEEP)
    print("  Done.\n")

# ── Parse CSV ─────────────────────────────────────────────────────────────────

def parse_csv():
    sessions  = []
    summaries = {}
    skipped   = 0
    ts        = datetime.now(timezone.utc).isoformat()

    with open(CSV_PATH, newline="") as fh:
        for row in csv.DictReader(fh):
            if row["app"] != "com.burbn.instagram":
                continue
            dur = int(float(row["duration_seconds"]))
            if dur < 1:
                skipped += 1
                continue

            open_time  = to_event_time(row["start_time"])
            close_time = to_event_time(row["end_time"])
            date_str   = open_time[:10]

            sessions.append({
                "userId": USER_ID, "appName": APP_NAME, "deviceId": DEVICE_ID,
                "openTime": open_time, "closeTime": close_time,
                "durationSeconds": dur, "status": "clean", "createdAt": ts,
            })

            if date_str not in summaries:
                summaries[date_str] = {
                    "date": date_str, "totalSeconds": 0,
                    "sessionCount": 0, "byApp": {APP_NAME: 0}, "maxSessionSeconds": 0,
                }
            s = summaries[date_str]
            s["totalSeconds"]    += dur
            s["sessionCount"]    += 1
            s["byApp"][APP_NAME] += dur
            s["maxSessionSeconds"] = max(s["maxSessionSeconds"], dur)

    print(f"CSV: {len(sessions)} sessions, {skipped} sub-second skipped.")
    print(f"Date range: {min(summaries)} → {max(summaries)}  ({len(summaries)} days)\n")
    return sessions, summaries

# ── Main ──────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    sessions, summaries = parse_csv()

    delete_summaries(set(summaries.keys()))

    sessions_ref = db.collection("users").document(USER_ID).collection("sessions")
    print(f"Writing {len(sessions)} session documents …")
    write_docs(sessions_ref, sessions, "sessions")
    print()

    print(f"Writing {len(summaries)} dailySummary documents …")
    write_summaries(summaries, "summaries")
    print()

    print("All done ✓")
