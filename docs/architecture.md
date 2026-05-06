# Architecture Overview

Stop Doomscrolling uses a three-layer serverless architecture optimized for zero-cost development and easy distribution.

## Layer 1: Data Collection (iOS Shortcuts)

**What:** User-configured iOS automations  
**How:** Users create Shortcuts that trigger on app open/close  
**Data Sent:** HTTP POST to backend with:
```json
{
  "userId": "user123",
  "deviceId": "device-id",
  "appName": "Instagram",
  "openTime": 1715000000,
  "closeTime": 1715001800
}
```

**Why this approach:**
- No native code needed
- Zero API approval process (users control what data is collected)
- Works without entitlements or special permissions
- Users can add/remove tracked apps easily

**Example:** When user opens Instagram, Shortcut logs `{ appName: "Instagram", openTime: now }`. When they close it, Shortcut logs `{ appName: "Instagram", closeTime: now }`. Shortcut POSTs both to backend.

## Layer 2: Frontend App (React Native via Expo)

**Location:** `src/` directory

**Responsibility:**
- Display app usage statistics (daily/weekly trends)
- Show breakdown by app (Instagram: 2.5h, TikTok: 1h, etc.)
- User settings (which apps to track, notification preferences)
- Receive push notifications from backend
- Create groups and share invite via QR code or deep link
- Join groups by scanning a QR code, tapping a link, or entering a group ID manually
- View group leaderboard (ranked by least scrolling)

**Stack:** React Native + TypeScript + Expo

**Key packages:**
- `expo-linking` — deep link handling for group invite URLs
- `react-native-qrcode-svg` — on-device QR code generation (no backend needed)

**Why Expo:**
- No Xcode builds needed
- Instant testing via Expo Go (scan QR code)
- Free tier (unlimited apps, 1GB bandwidth)
- Built-in APNs integration

**Project Structure:**

## Layer 3: Backend (Python FastAPI)

**Hosting:** Vercel (Python runtime) + Firestore

The backend is a Python FastAPI application deployed on Vercel's Python runtime. A single `main.py` defines the FastAPI app; Vercel treats it as a serverless function via `api/index.py`.

**Responsibilities:**
1. **Receive Shortcuts data** — POST endpoint that accepts open/close events from Shortcuts
2. **Reconstruct sessions** — Match open/close events into sessions; detect and recover unlock sessions (see below)
3. **Update daily summaries** — On session finalize, aggregate into `dailySummaries/{date}` per user
4. **Store in Firestore** — Organize sessions by user, device, app, date
5. **Serve analytics** — GET endpoints for frontend to fetch stats
6. **Group management** — Create groups, join by invite code, serve leaderboard
7. **Send notifications** — Analyze usage and trigger APNs push notifications

**Session Reconstruction Logic:**

iOS Shortcuts reliably fire on lock and explicit app close, but do not fire an open event when the user unlocks directly back into an already-open app. The backend detects this via the two-consecutive-closes pattern and reconstructs the missing open:

```
inferred_open = max(previousCloseTime, currentCloseTime - 20min)
```

Sessions are flagged with a status field:
- `clean` — open and close both received from Shortcuts
- `inferred_unlock` — open was reconstructed from unlock pattern, capped at 20 min before close
- `timed_out` — no close received within 4 hours; session closed at openTime + 4h

**Project Structure:**
```
backend/
├── api/
│   └── index.py                  # Vercel entrypoint — exports the FastAPI `app`
├── main.py                       # FastAPI app definition and route registration
├── routers/
│   ├── usage.py                  # POST /api/recordUsage, GET /api/usage/{userId}/{date}
│   ├── notifications.py          # GET /api/notifications/{userId}
│   └── groups.py                 # POST/GET /api/groups, join, leaderboard
├── services/
│   ├── session_service.py        # Session reconstruction logic (clean/inferred/timed_out)
│   ├── summary_service.py        # Aggregates sessions into dailySummaries
│   └── notification_service.py   # APNs push notification dispatch
├── models.py                     # Pydantic request/response models
├── firestore_client.py           # Shared Firestore client initialization
├── firestore-rules/
│   └── firestore.rules           # Security rules
├── shortcuts/
│   ├── instagram-shortcut.json   # Template automations
│   └── tiktok-shortcut.json
├── requirements.txt              # fastapi, firebase-admin, httpx, pydantic, etc.
└── vercel.json                   # Routes all /api/* to api/index.py
```

**Firestore Schema:**
```
users/
  └── {userId}/
      ├── profile/
      │   ├── displayName: "Romanos"
      │   └── pushToken: "ExponentPushToken[...]"
      ├── preferences/
      │   ├── trackedApps: ["Instagram", "TikTok"]
      │   └── notificationsEnabled: true
      ├── sessions/
      │   └── {sessionId}/
      │       ├── appName: "Instagram"
      │       ├── openTime: 1715000000
      │       ├── closeTime: 1715001800
      │       ├── durationSeconds: 1800
      │       └── status: "clean" | "inferred_unlock" | "timed_out"
      └── dailySummaries/              ← aggregated; readable by group members
          └── {date}/                  ← e.g. "2026-05-05"
              ├── totalSeconds: 7200
              ├── sessionCount: 15
              └── byApp: { Instagram: 3600, TikTok: 3600 }

groups/
  └── {groupId}/                       ← groupId IS the invite token (e.g. "xk92pl")
      ├── name: "The Boys"             ← short, human-readable, URL-safe
      ├── createdBy: "userId"
      ├── createdAt: timestamp
      ├── memberIds: ["userId1", ...]  ← array for Firestore rule checks
      └── members/
          └── {userId}/
              ├── displayName: "Romanos"
              ├── joinedAt: timestamp
              └── role: "owner" | "member"
```

**Privacy model:** Raw sessions are private (`users/{id}/sessions` readable only by the owner). The leaderboard reads only `dailySummaries`, which exposes total minutes per app per day — no session-level detail. Firestore rules enforce this:
- `users/{userId}/sessions/**` → readable by `userId` only
- `users/{userId}/dailySummaries/**` → readable by any user listed in a shared group's `memberIds`
- `groups/{groupId}/**` → readable by members in `memberIds`

## Group Invite System

Groups are joined via a `groupId` embedded in a deep link or QR code. There is no separate invite code — the `groupId` itself is the invite token and is kept short and URL-safe (e.g., `xk92pl`).

### Link Format

```
Deep link (Expo Go):  exp://u.expo.dev/[project-id]/--/join/xk92pl
Web fallback:         https://[app].vercel.app/invite/xk92pl
```

The web fallback page attempts to open the deep link and falls back to instructions for installing Expo Go. Both resolve to the same join confirmation screen inside the app.

### Join Flow

```
Owner creates group
  → backend generates groupId (short, random, URL-safe)
  → app constructs invite URL
  → app renders QR code from URL (react-native-qrcode-svg, on-device, no backend call)
  → owner shares QR image or copies link via iOS share sheet

Friend scans QR / taps link / types groupId manually
  → Expo Go intercepts exp:// URL via expo-linking
  → app navigates to JoinGroup screen with groupId as param
  → app calls GET /api/groups/{groupId}  (shows group name + member count before committing)
  → user taps "Join"
  → app calls POST /api/groups/{groupId}/members
```

### Expo Linking Config (app.json)

```json
{
  "expo": {
    "scheme": "doomscroll",
    "slug": "doomscroll"
  }
}
```

React Navigation deep link mapping:
```js
const linking = {
  prefixes: ["doomscroll://", "exp://u.expo.dev/[project-id]/--"],
  config: {
    screens: {
      JoinGroup: "join/:groupId"
    }
  }
}
```

## Data Flow

```
┌─────────────────────────────────────────────────────────┐
│ User opens Instagram → iOS Shortcut triggers           │
│ Shortcut logs: {appName, openTime, closeTime}          │
│ Shortcut POSTs to: /api/recordUsage                    │
└──────────────────┬──────────────────────────────────────┘
                   │
                   ▼
        ┌──────────────────────┐
        │ FastAPI on Vercel    │
        │ POST /recordUsage    │
        │ Validates (Pydantic) │
        │ Writes to Firestore  │
        └──────────┬───────────┘
                   │
                   ▼
        ┌──────────────────────┐
        │ Firestore Database   │
        │ Stores usage records │
        │ Triggers onHighUsage │
        └──────────┬───────────┘
                   │
        ┌──────────┴───────────┐
        │                      │
        ▼                      ▼
    Frontend Query          Notification Trigger
    (React Native)          (Cloud Function)
        │                      │
        │                      ▼
        │            ┌──────────────────┐
        │            │ APNs Service     │
        │            │ Sends push notif │
        │            └────────┬─────────┘
        │                     │
        ▼                     ▼
    ┌──────────────────────────────────┐
    │ React Native App                 │
    │ - Displays stats                 │
    │ - Receives notifications         │
    └──────────────────────────────────┘
```

## Performance Considerations

- **Firestore Costs:** 50k reads/day free tier — sufficient for ~10 users checking stats multiple times daily. Leaderboard reads `dailySummaries` (1 doc per member per day), not raw sessions — keeps read count low.
- **Vercel Python Runtime:** Serverless invocations from Shortcuts + frontend queries — well within the free tier. Cold starts are slightly higher than Node but acceptable for this use case.
- **Data Retention:** Consider archiving old usage data after 30 days to stay within Firestore limits
- **Push Notifications:** Batch them (don't send on every app close) to reduce APNs load

## Security

- **Firestore Rules:** Restrict users to reading/writing only their own data
- **API Authentication:** Simple userId + deviceId for now (class project); add auth tokens later if needed
- **Data Privacy:** All data encrypted in transit (HTTPS); advise users that Shortcuts can see all their app activity

## Scaling Considerations

**If expanding beyond class project:**
- Add OAuth/JWT authentication
- Implement rate limiting on API endpoints
- Add analytics (Google Analytics via Expo)
- Archive old data to keep Firestore costs low
