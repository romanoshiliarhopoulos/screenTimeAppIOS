# Notification System (v1)

## Purpose

Deliver timely nudges that interrupt doomscrolling and create social accountability:

- **Personal alert:** "You've been on Instagram for 20 minutes."
- **Social alert to friends:** "Friend X has been on TikTok for 30 minutes — go shame them."
- **Shame button:** Friends can manually fire a notification at someone currently live-scrolling.

Start minimal, measure impact, then add richer interventions.

---

## Notification Types

### 1. Personal Threshold Alert
- **When:** User has been on a tracked app for N minutes without closing it.
- **Message:** "You've been on {appName} for {X} minutes. Want to take a break?"
- **Trigger:** Cron job detects an open session older than `userAlertThresholdSeconds` with no close event.
- **Configurable per user:** threshold (default 20 min), cooldown (default 2 hours), quiet hours.

### 2. Friend Alert (Social Accountability)
- **When:** User has been on a tracked app for M minutes (longer than personal threshold) and friends have not been notified yet.
- **Message:** "{firstName} has been on {appName} for {X} minutes. Go shame them!"
- **Trigger:** Same cron job, second threshold check (`friendAlertThresholdSeconds`, default 30 min).
- **Configurable per user:** whether to allow friends to see their live sessions.

### 3. Shame Button (Manual)
- **When:** A friend taps the Shame button on the live session card in the app.
- **Message:** "Your friend is calling you out! Time to put the phone down."
- **Trigger:** On-demand via `POST /api/users/{friendId}/shame`.
- **Rate limited:** One shame per sender per target per cooldown window (default 30 min).

### 4. Session Close Summary (Retroactive Friend Notification)
- **When:** A live session that already notified friends finally closes.
- **Message to friends:** "{firstName} finally put down {appName} after {X} minutes."
- **Trigger:** Close event handler, if the `activeSessions` document has `notifiedFriends = true`.
- **Configurable:** Can be disabled by user.

### 5. Daily Cap Warning
- **When:** A session close pushes the user's `dailySummary.totalSeconds` over a soft daily limit.
- **Message:** "You've used {appName} for {X} min today. Your daily limit is {Y} min."
- **Trigger:** Session close event handler, reads from existing `dailySummaries` collection.
- **Configurable per user:** daily cap per app or overall.

### 6. Streak Reinforcement (Positive)
- **When:** User has stayed under their daily limit N days in a row.
- **Message:** "{N}-day streak under your limit. Keep it up."
- **Trigger:** Nightly cron job after midnight.

---

## Architecture: Why Cron, Not In-Request Timers

The backend runs on Vercel — stateless, short-lived serverless functions. A request handler cannot start a timer and wait. Instead:

1. On every **open** event → write/upsert a document to the top-level `activeSessions` collection.
2. On every **close** event → delete that document from `activeSessions`.
3. A **Vercel Cron Function** runs on a short interval (e.g., every 5 minutes) and scans `activeSessions` for documents that have aged past configured thresholds.

The cron job is the timer. Resolution lag = cron interval. A 5-minute interval means a user could be 24 minutes in before receiving the "20-minute" notification — acceptable for v1.

---

## Active Session Tracking

### Why Top-Level Collection

`activeSessions` must be a **top-level Firestore collection**, not nested under `users/{userId}/`. This allows the cron job to scan across all users in a single query without needing collection group indexes.

### Document: `activeSessions/{userId}_{deviceId}_{appName}`

```json
{
  "userId": "abc123",
  "deviceId": "iphone-x",
  "appName": "Instagram",
  "openTime": "<ISO timestamp>",
  "notifiedUser": false,
  "notifiedFriends": false,
  "createdAt": "<ISO timestamp>"
}
```

### State Machine

```
open event
    │
    ▼
activeSessions doc created
    │
    ├─ cron fires, openTime > userThreshold, notifiedUser=false
    │       → send personal notification, set notifiedUser=true
    │
    ├─ cron fires, openTime > friendThreshold, notifiedFriends=false
    │       → fan out to friend group, set notifiedFriends=true
    │
    └─ close event arrives
            → if notifiedFriends=true: send close summary to friends
            → delete activeSessions doc
            → write completed session to sessions collection
```

---

## Live Presence (Friend Feed)

The `activeSessions` collection doubles as a **real-time presence feed**.

The frontend subscribes to `activeSessions` filtered to the user's friend group via a Firestore real-time listener. No polling needed. When a friend's document appears or disappears, the UI updates immediately showing who is live.

The Shame button is shown on each live friend's card. Tapping it calls `POST /api/users/{friendId}/shame`.

---

## Notification Service: Three Invocation Contexts

All three contexts call the same `NotificationService`. The service does not need to know which context invoked it — it receives a typed input and applies the appropriate rules.

| Context | Trigger | Notification Types |
|---|---|---|
| Session close handler | HTTP request (Shortcut fires) | Daily cap warning, retroactive friend summary |
| Cron job | Scheduled, every 5 min | Personal threshold, friend alert |
| Shame endpoint | HTTP request (user taps button) | Manual shame notification |

---

## Vercel Cron (Free Tier)

Vercel's Hobby plan supports cron jobs with a **minimum interval of 1 day** — not 5 minutes.

**Solution: use a free external cron service to call your backend.**

- [cron-job.org](https://cron-job.org) — free, supports 1-minute intervals, calls an HTTP endpoint.
- Configure it to call `POST /api/cron/check-active-sessions` on your Vercel backend every 5 minutes.
- Secure the endpoint with a static `CRON_SECRET` header (same pattern as `SHORTCUT_API_KEY`).

This keeps the backend on the free tier with no architectural changes.

---

## Firestore Data Model

### `activeSessions/{userId}_{deviceId}_{appName}`
_(top-level, scanned by cron)_

```json
{
  "userId": "string",
  "deviceId": "string",
  "appName": "string",
  "openTime": "ISO timestamp",
  "notifiedUser": false,
  "notifiedFriends": false,
  "createdAt": "ISO timestamp"
}
```

### `users/{userId}/notificationSettings`

```json
{
  "enabled": true,
  "userAlertThresholdSeconds": 1200,
  "friendAlertThresholdSeconds": 1800,
  "dailyCapSeconds": 3600,
  "cooldownSeconds": 7200,
  "shameCooldownSeconds": 1800,
  "trackedApps": ["Instagram", "TikTok", "X"],
  "quietHoursStart": "22:30",
  "quietHoursEnd": "07:00",
  "allowFriendsToSeeLiveSessions": true,
  "sendCloseSessionSummaryToFriends": true,
  "updatedAt": "<timestamp>"
}
```

### `users/{userId}/devices/{deviceId}`

```json
{
  "expoPushToken": "ExponentPushToken[...]",
  "platform": "ios",
  "lastSeenAt": "<timestamp>"
}
```

### `users/{userId}/notifications/{notificationId}`
_(audit log)_

```json
{
  "type": "threshold_alert | friend_alert | shame | daily_cap | session_summary | streak",
  "appName": "Instagram",
  "sessionSeconds": 1560,
  "sentAt": "<timestamp>",
  "deliveryStatus": "sent | skipped | failed",
  "skipReason": "cooldown | quiet_hours | disabled | below_threshold | no_token | not_friends",
  "triggeredBy": "cron | session_close | shame_button"
}
```

### `shameEvents/{shameId}`
_(top-level, for rate limiting and future leaderboard)_

```json
{
  "fromUserId": "abc",
  "toUserId": "xyz",
  "appName": "TikTok",
  "sentAt": "<timestamp>"
}
```

---

## API / Service Additions

### New Endpoints

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/users/me/push-token` | Register/update Expo push token |
| `PUT` | `/api/users/me/notification-settings` | Save all notification preferences |
| `POST` | `/api/users/{friendId}/shame` | Shame a live friend (rate-limited) |
| `POST` | `/api/cron/check-active-sessions` | Called by external cron, secured by header |

### NotificationService Public Contract

```python
class NotificationService:
    # Called by session close handler
    async def handle_session_close(self, session: SessionInput) -> NotificationDecision

    # Called by cron job for each stale active session
    async def handle_active_session_check(self, active: ActiveSessionInput) -> list[NotificationDecision]

    # Called by shame endpoint
    async def handle_shame(self, from_user_id: str, to_user_id: str) -> NotificationDecision

    # Low-level: used internally
    async def send_notification(self, payload: NotificationPayload) -> NotificationDecision
    async def register_push_token(self, input: PushTokenInput) -> None
    async def update_settings(self, input: SettingsInput) -> None
```

### Internal Modules (hidden from API layer)

- `NotificationRulesEngine` — threshold, cooldown, quiet hours, friendship checks
- `NotificationTemplateBuilder` — constructs title/body per notification type
- `NotificationSender` — calls Expo push API
- `NotificationAuditRepository` — persists sent/skipped/failed to Firestore
- `NotificationSettingsRepository` — loads/saves per-user settings
- `PushTokenRepository` — loads/saves device tokens
- `ActiveSessionRepository` — read/write/delete `activeSessions` documents
- `ShameRepository` — reads/writes `shameEvents` for rate limiting

---

## Rule Logic Per Notification Type

### Personal Threshold (cron)
1. Notifications enabled?
2. App in user's tracked list?
3. Not in quiet hours?
4. `elapsedSeconds >= userAlertThresholdSeconds`?
5. `notifiedUser == false`?
6. → Send. Mark `notifiedUser = true`.

### Friend Alert (cron)
1. User has `allowFriendsToSeeLiveSessions = true`?
2. `elapsedSeconds >= friendAlertThresholdSeconds`?
3. `notifiedFriends == false`?
4. For each group member: notifications enabled? not in quiet hours? cooldown elapsed?
5. → Fan out. Mark `notifiedFriends = true`.

### Shame Button
1. Sender and target are friends (in same group)?
2. Target has a document in `activeSessions`?
3. No shame sent from this sender to this target within `shameCooldownSeconds`?
4. Target has a push token?
5. → Send.

### Daily Cap Warning (session close)
1. Notifications enabled?
2. App in tracked list?
3. `dailySummary.totalSeconds >= dailyCapSeconds`?
4. Not already sent today for this app?
5. → Send.

### Session Close Summary (session close)
1. Corresponding `activeSessions` doc had `notifiedFriends = true`?
2. User has `sendCloseSessionSummaryToFriends = true`?
3. For each group member: eligible per their own settings?
4. → Fan out to friends.

---

## Free Tier Budget

| Service | Usage | Limit | Notes |
|---|---|---|---|
| Firestore reads | ~10–20 per cron tick per active session | 50k/day | Fine for small groups |
| Firestore writes | ~2–4 per session event | 20k/day | Fine |
| Vercel Functions | Cron endpoint + session endpoints | 100GB bandwidth | Fine |
| Expo Push | Unlimited | Free | No quota |
| cron-job.org | Every 5 min = 288 calls/day | Free, unlimited | External cron |

---

## Rollout Plan

1. **Phase 1:** Personal threshold alert (cron + activeSessions model).
2. **Phase 2:** Friend alert + live presence feed + shame button.
3. **Phase 3:** Daily cap warning, session close summary.
4. **Phase 4:** Streak reinforcement, adaptive thresholds.

---

## Future Extensions

- Progressive escalation (gentle → stronger language as session grows)
- Shame leaderboard ("Most shamed this week")
- Group challenges ("Nobody scrolls more than 20 min today")
- Positive reinforcement ("You cut usage 18% this week")
- Late-night doomscrolling pattern detection
