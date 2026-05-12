"""
Seed Firestore with dummy FRIEND data only.
Never touches the real user's own documents.

Usage:
    python seed_dummy_data.py <your_firebase_uid>
    python seed_dummy_data.py --list-users
    python seed_dummy_data.py --clean <your_firebase_uid>   # remove all dummy data
"""

import json, os, sys, uuid
from datetime import datetime, timezone, timedelta
from pathlib import Path

for line in (Path(__file__).parent / '.env').read_text().splitlines():
    line = line.strip()
    if line and not line.startswith('#') and '=' in line:
        k, _, v = line.partition('=')
        os.environ.setdefault(k, v.strip().strip("'\""))

import firebase_admin
from firebase_admin import credentials, firestore, auth as fb_auth

if not firebase_admin._apps:
    cred = credentials.Certificate(json.loads(os.environ['FIREBASE_SERVICE_ACCOUNT']))
    firebase_admin.initialize_app(cred)

db = firestore.client()

GROUP_ID = 'seed-group-alpha'
TODAY = datetime.now(timezone.utc).strftime('%Y-%m-%d')


def ts(days=0, hours=0, minutes=0) -> str:
    return (datetime.now(timezone.utc) - timedelta(days=days, hours=hours, minutes=minutes)).isoformat()

def date_ago(days: int) -> str:
    return (datetime.now(timezone.utc) - timedelta(days=days)).strftime('%Y-%m-%d')


# ── Dummy friends definition ─────────────────────────────────────────────────
# UIDs are stable so re-running is idempotent (use fixed suffix, not random)
FRIENDS = [
    {
        'uid': 'dummy_alex_chen_001',
        'displayName': 'Alex Chen',
        'streakCurrent': 5,
        'streakLongest': 12,
        'totalTodaySeconds': 4320,   # 72 min — over limit
        'dailyCapSeconds': 3600,
        'openCounts': {'Instagram': 7, 'TikTok': 3, 'Twitter': 2},
        'activeApp': 'Instagram',    # currently live
        'activeOpenMinsAgo': 8,
        'wallOfShame': [
            {'type': 'excessive_opens', 'detail': {'appName': 'TikTok', 'openCount': 18, 'date': date_ago(1)}, 'daysAgo': 1},
        ],
    },
    {
        'uid': 'dummy_jordan_kim_002',
        'displayName': 'Jordan Kim',
        'streakCurrent': 0,
        'streakLongest': 3,
        'totalTodaySeconds': 7200,   # 2 hours — well over limit
        'dailyCapSeconds': 3600,
        'openCounts': {'TikTok': 14, 'Instagram': 5, 'YouTube': 4},
        'activeApp': None,
        'activeOpenMinsAgo': None,
        'wallOfShame': [
            {'type': 'late_night', 'detail': {'appName': 'Instagram', 'time': '02:14'}, 'daysAgo': 2},
            {'type': 'shame_bypass', 'detail': {'fromName': 'Alex Chen', 'shameType': 'quick'}, 'daysAgo': 3},
        ],
    },
    {
        'uid': 'dummy_sam_rivera_003',
        'displayName': 'Sam Rivera',
        'streakCurrent': 14,
        'streakLongest': 14,
        'totalTodaySeconds': 900,    # 15 min — well under limit
        'dailyCapSeconds': 3600,
        'openCounts': {'Twitter': 2},
        'activeApp': None,
        'activeOpenMinsAgo': None,
        'wallOfShame': [],
    },
]


def seed_friend(f: dict):
    uid = f['uid']
    ref = db.collection('users').document(uid)

    # Profile
    ref.collection('profile').document('info').set({'displayName': f['displayName']})

    # Notification settings
    ref.collection('notificationSettings').document('config').set({
        'dailyCapSeconds': f['dailyCapSeconds'],
        'allowFriendsToSeeLiveSessions': True,
    })

    # Daily summaries — today + last 7 days
    for i in range(8):
        d = date_ago(i)
        factor = 1.0 if i == 0 else max(0.2, 1.0 - i * 0.12)
        secs = int(f['totalTodaySeconds'] * factor)
        oc = {app: max(1, int(c * factor)) for app, c in f['openCounts'].items()}
        n_apps = max(len(oc), 1)
        ba = {app: max(60, secs // n_apps) for app in oc}
        ref.collection('dailySummaries').document(d).set({
            'date': d,
            'totalSeconds': secs,
            'sessionCount': max(1, sum(oc.values()) // 3),
            'byApp': ba,
            'maxSessionSeconds': max(ba.values()) if ba else 0,
            'openCounts': oc,
        })

    # Streak
    ref.collection('streaks').document('current').set({
        'current': f['streakCurrent'],
        'longest': f['streakLongest'],
        'lastDate': TODAY if f['streakCurrent'] > 0 else date_ago(1),
    })

    # Wall of shame
    for entry in f['wallOfShame']:
        ref.collection('wallOfShame').add({
            'type': entry['type'],
            'displayName': f['displayName'],
            'detail': entry['detail'],
            'createdAt': ts(days=entry['daysAgo']),
        })

    print(f"  ✓ {f['displayName']} ({uid})")


def seed_active_session(f: dict):
    if not f['activeApp']:
        return
    db.collection('activeSessions').document(f'seed_{f["uid"]}').set({
        'userId': f['uid'],
        'appName': f['activeApp'],
        'openTime': ts(minutes=f['activeOpenMinsAgo']),
        'deviceId': 'seed-device',
    })
    print(f"  ✓ active session: {f['activeApp']} for {f['displayName']}")


def seed_shame_queue(from_uid: str, from_name: str, to_uid: str):
    db.collection('shameQueue').document('seed_pending_shame_001').set({
        'fromUserId': from_uid,
        'toUserId': to_uid,
        'fromName': from_name,
        'type': 'quick',
        'reaction': '😤',
        'videoUrl': None,
        'message': 'Get off your phone!',
        'watched': False,
        'skipped': False,
        'createdAt': ts(minutes=3),
    })
    print(f"  ✓ pending shame from {from_name} to you")


def seed_shame_events(real_uid: str, friend_uids: list):
    all_uids = [real_uid] + friend_uids
    pairs = [
        (all_uids[0], all_uids[1], 5),
        (all_uids[1], all_uids[0], 10),
        (all_uids[2], all_uids[0], 18),
        (all_uids[1], all_uids[2], 25),
        (all_uids[0], all_uids[2], 36),
    ]
    # Delete old seed events first
    for doc in db.collection('shameEvents').where('fromUserId', 'in', friend_uids).stream():
        doc.reference.delete()

    for sender, receiver, hours_ago in pairs:
        db.collection('shameEvents').add({
            'fromUserId': sender,
            'toUserId': receiver,
            'type': 'quick',
            'sentAt': ts(hours=hours_ago),
        })
    print(f"  ✓ {len(pairs)} historical shame events")


def upsert_group(real_uid: str, friend_uids: list):
    all_members = [real_uid] + friend_uids
    doc = db.collection('groups').document(GROUP_ID).get()
    if doc.exists:
        # Just ensure real_uid is in the group
        existing = doc.to_dict().get('memberIds', [])
        merged = list(set(existing + all_members))
        db.collection('groups').document(GROUP_ID).update({'memberIds': merged})
        print(f"  ✓ updated group '{GROUP_ID}' — {len(merged)} members")
    else:
        db.collection('groups').document(GROUP_ID).set({
            'name': 'The Accountability Squad',
            'memberIds': all_members,
            'createdAt': ts(days=14),
        })
        print(f"  ✓ created group '{GROUP_ID}' — {len(all_members)} members")


def clean(real_uid: str):
    """Remove all dummy data, leave real user untouched."""
    friend_uids = [f['uid'] for f in FRIENDS]

    for f in FRIENDS:
        uid = f['uid']
        ref = db.collection('users').document(uid)
        # Delete all sub-collections we created
        for sub in ['profile', 'notificationSettings', 'dailySummaries', 'streaks', 'wallOfShame']:
            for doc in ref.collection(sub).stream():
                doc.reference.delete()
        print(f"  ✓ cleaned {f['displayName']}")

    # Remove from group
    doc = db.collection('groups').document(GROUP_ID).get()
    if doc.exists:
        members = [m for m in doc.to_dict().get('memberIds', []) if m not in friend_uids]
        if members:
            db.collection('groups').document(GROUP_ID).update({'memberIds': members})
        else:
            db.collection('groups').document(GROUP_ID).delete()
        print(f"  ✓ removed dummy friends from group")

    # Delete active sessions
    for f in FRIENDS:
        db.collection('activeSessions').document(f'seed_{f["uid"]}').delete()

    # Delete pending shame
    db.collection('shameQueue').document('seed_pending_shame_001').delete()

    print('Done. All dummy data removed.')


def run(real_uid: str):
    print(f'\nSeeding dummy friends for: {real_uid}\n')

    friend_uids = [f['uid'] for f in FRIENDS]

    print('Creating dummy friends...')
    for f in FRIENDS:
        seed_friend(f)

    print('\nActive sessions...')
    for f in FRIENDS:
        seed_active_session(f)

    print('\nShame queue (pending from Alex)...')
    seed_shame_queue(FRIENDS[0]['uid'], FRIENDS[0]['displayName'], real_uid)

    print('\nHistorical shame events...')
    seed_shame_events(real_uid, friend_uids)

    print('\nGroup membership...')
    upsert_group(real_uid, friend_uids)

    print(f"""
Done! Dummy friends added without touching your real data.
────────────────────────────────────────────────────────
Friends in your group:
  • Alex Chen  — LIVE on Instagram (72 min today, streak 5)
  • Jordan Kim — recent (2h today — over limit, shame bypass on wall)
  • Sam Rivera — offline (15 min, streak 14)

1 pending shame from Alex Chen queued for you.

Open the app → Home tab → pull to refresh.
────────────────────────────────────────────────────────
""")


if __name__ == '__main__':
    if '--list-users' in sys.argv:
        for u in fb_auth.list_users().users:
            print(f'  {u.uid}  {u.email or "(no email)"}')
        sys.exit(0)

    if '--clean' in sys.argv:
        idx = sys.argv.index('--clean')
        uid = sys.argv[idx + 1] if idx + 1 < len(sys.argv) else None
        if not uid:
            print('Usage: python seed_dummy_data.py --clean <uid>')
            sys.exit(1)
        clean(uid)
        sys.exit(0)

    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)

    run(sys.argv[1])
