"""
One-time script: seeds 5 fake users into group ib5Ywnaz with realistic usage data.
Run from the backend directory: python seed_fake_users.py
"""
import sys, os

# Load .env file so FIREBASE_SERVICE_ACCOUNT is available
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

import firestore_client  # initialises Firebase
from firestore_client import db
from datetime import datetime, timezone, date, timedelta
from google.cloud.firestore_v1 import ArrayUnion

GROUP_ID = "ib5Ywnaz"
TODAY = date.today().isoformat()
YESTERDAY = (date.today() - timedelta(days=1)).isoformat()

FAKE_USERS = [
    {
        "uid": "fake_user_alex_001",
        "displayName": "Alex",
        "todaySeconds": 4320,   # 1h 12m
        "todayApps": {"Instagram": 2100, "TikTok": 1500, "YouTube": 720},
        "yesterdaySeconds": 5400,
        "yesterdayApps": {"Instagram": 3000, "TikTok": 2400},
    },
    {
        "uid": "fake_user_maria_002",
        "displayName": "Maria",
        "todaySeconds": 1260,   # 21m — doing well
        "todayApps": {"YouTube": 900, "Reddit": 360},
        "yesterdaySeconds": 3600,
        "yesterdayApps": {"Instagram": 1800, "TikTok": 1800},
    },
    {
        "uid": "fake_user_jordan_003",
        "displayName": "Jordan",
        "todaySeconds": 7200,   # 2h — worst today
        "todayApps": {"TikTok": 3600, "Instagram": 2100, "Reddit": 900, "YouTube": 600},
        "yesterdaySeconds": 6300,
        "yesterdayApps": {"TikTok": 4200, "Instagram": 2100},
    },
    {
        "uid": "fake_user_priya_004",
        "displayName": "Priya",
        "todaySeconds": 2700,   # 45m
        "todayApps": {"Instagram": 1800, "YouTube": 900},
        "yesterdaySeconds": 2400,
        "yesterdayApps": {"Instagram": 1500, "TikTok": 900},
    },
    {
        "uid": "fake_user_sam_005",
        "displayName": "Sam",
        "todaySeconds": 540,    # 9m — best today
        "todayApps": {"Reddit": 540},
        "yesterdaySeconds": 1800,
        "yesterdayApps": {"Reddit": 1200, "YouTube": 600},
    },
]

def write_user(user: dict):
    uid = user["uid"]
    now = datetime.now(timezone.utc).isoformat()

    # Profile document (used by _get_display_name in groups router)
    db.collection("users").document(uid)\
      .collection("profile").document("info")\
      .set({"displayName": user["displayName"], "createdAt": now})

    # Today's daily summary
    def make_summary(seconds: int, apps: dict, session_count: int) -> dict:
        return {
            "totalSeconds": seconds,
            "byApp": apps,
            "sessionCount": session_count,
        }

    today_sessions = max(3, len(user["todayApps"]) * 2)
    yest_sessions  = max(2, len(user["yesterdayApps"]) * 2)

    db.collection("users").document(uid)\
      .collection("dailySummaries").document(TODAY)\
      .set({"date": TODAY, **make_summary(user["todaySeconds"], user["todayApps"], today_sessions)})

    db.collection("users").document(uid)\
      .collection("dailySummaries").document(YESTERDAY)\
      .set({"date": YESTERDAY, **make_summary(user["yesterdaySeconds"], user["yesterdayApps"], yest_sessions)})

    print(f"  ✓ Wrote profile + summaries for {user['displayName']} ({uid})")


def add_to_group(user: dict):
    uid = user["uid"]
    now = datetime.now(timezone.utc).isoformat()
    group_ref = db.collection("groups").document(GROUP_ID)

    # Add uid to memberIds array
    group_ref.update({"memberIds": ArrayUnion([uid])})

    # Write member sub-document
    group_ref.collection("members").document(uid).set({
        "displayName": user["displayName"],
        "joinedAt": now,
        "role": "member",
    })
    print(f"  ✓ Added {user['displayName']} to group {GROUP_ID}")


if __name__ == "__main__":
    print(f"Seeding {len(FAKE_USERS)} fake users into group {GROUP_ID}...\n")
    for u in FAKE_USERS:
        write_user(u)
        add_to_group(u)
    print(f"\nDone. Today = {TODAY}, Yesterday = {YESTERDAY}")
    print("Open the Friends tab → leaderboard to verify.")
