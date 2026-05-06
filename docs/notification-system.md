# Notification System (v1)

## Purpose

Deliver simple, timely nudges that interrupt doomscrolling behavior:

- **Primary v1 alert:** "You've been scrolling for X minutes."
- Start minimal, measure impact, then add richer interventions.

---

## v1 Scope

### What ships now

1. Detect continuous usage duration for tracked apps.
2. Send one push notification when duration crosses a threshold (example: 20 minutes).
3. Enforce cooldown so users are not spammed (example: one alert per 2 hours per app).

### What is out of scope for v1

- Personalized AI messaging
- Multi-step habit plans
- Social accountability notifications
- Complex per-user optimization

---

## High-Level Flow

1. **iOS Shortcuts** sends app-open / app-close events to backend.
2. **Backend** writes sessions to Firestore.
3. API calls a single **NotificationService wrapper**.
4. Wrapper handles rule evaluation, dedupe/cooldown, and push delivery internally.
5. App receives notification and deep-links to relevant screen (Home/Stats).

---

## Wrapper-First Design (Abstraction Layer)

All backend APIs should call one Python wrapper instead of implementing notification logic inline.

### Public contract (what APIs call)

```python
from dataclasses import dataclass
from typing import Optional, Literal

@dataclass
class UsageSessionInput:
    userId: str
    deviceId: str
    appName: str
    openTime: str      # ISO format
    closeTime: str     # ISO format

@dataclass
class PushTokenInput:
    userId: str
    deviceId: str
    expoPushToken: str
    platform: Literal['ios']

@dataclass
class SettingsInput:
    userId: str
    enabled: Optional[bool] = None
    scrollAlertThresholdSeconds: Optional[int] = None
    cooldownSeconds: Optional[int] = None
    trackedApps: Optional[list[str]] = None
    quietHoursStart: Optional[str] = None  # "HH:MM" format
    quietHoursEnd: Optional[str] = None    # "HH:MM" format

class NotificationService:
    async def send_notification(self, input: dict) -> 'NotificationDecision':
        ...

    async def handle_usage_session(self, input: UsageSessionInput) -> 'NotificationDecision':
        ...

    async def register_push_token(self, input: PushTokenInput) -> None:
        ...

    async def update_settings(self, input: SettingsInput) -> None:
        ...
```

### Return shape (for logs/observability)

```python
from dataclasses import dataclass
from typing import Literal, Union

@dataclass
class NotificationDecisionSent:
    status: Literal['sent'] = 'sent'
    reason: Literal['threshold_met'] = 'threshold_met'
    notificationId: str

@dataclass
class NotificationDecisionSkipped:
    status: Literal['skipped'] = 'skipped'
    reason: Literal['disabled', 'untracked_app', 'quiet_hours', 'below_threshold', 'cooldown', 'no_token']

@dataclass
class NotificationDecisionFailed:
    status: Literal['failed'] = 'failed'
    reason: Literal['delivery_error']
    errorCode: str

NotificationDecision = Union[NotificationDecisionSent, NotificationDecisionSkipped, NotificationDecisionFailed]
```

### Internal composition (hidden from APIs)

`NotificationService` owns these internal modules:

- `NotificationRulesEngine` (threshold/quiet-hours/cooldown decisions)
- `NotificationTemplateBuilder` (title/body + payload)
- `NotificationSender` (actual Expo call)
- `NotificationAuditRepository` (persist sent/skipped/failed to Firestore)
- `NotificationSettingsRepository` (load/save user settings)
- `PushTokenRepository` (load/save device tokens)

### Wrapper behavior

`send_notification()` should be the only place that knows how to talk to Expo.
It should:

1. Build the Expo message payload.
2. Look up device push tokens.
3. Call Expo's push API.
4. Record success or failure.
5. Return a small decision object for logging.

### API usage example

```python
# In your Flask/FastAPI route handler
from flask import request, jsonify

@app.post('/api/usage')
async def ingest_usage():
    body = request.json
    
    # Save session to Firestore
    session = UsageSession(**body)
    await usage_repository.save(session)
    
    # Trigger notifications through the wrapper
    decision = await notification_service.handle_usage_session(
        UsageSessionInput(
            userId=body['userId'],
            deviceId=body['deviceId'],
            appName=body['appName'],
            openTime=body['openTime'],
            closeTime=body['closeTime'],
        )
    )
    
    logger.info(f'notification_decision: {decision}')
    return jsonify({'status': 'ok'})
```

Result: backend routes stay thin and stable; complexity is centralized in one wrapper.

---

## Backend Integration

## 1) Event Ingestion (existing)

- Endpoint: `POST /api/usage` (or current ingest endpoint)
- Input: `userId`, `deviceId`, `appName`, `openTime`, `closeTime`
- Store normalized usage session in Firestore.

## 2) Notification Evaluation (new backend step)

Run immediately after each session write:

- Compute `sessionSeconds = closeTime - openTime`
- Load user notification settings
- Check active rules:
  - app is tracked
  - `sessionSeconds >= thresholdSeconds`
  - cooldown window has passed
- If eligible, enqueue/send notification and store audit record

## 3) Push Delivery

- Use stored Expo push token(s) per user/device
- Send payload through Expo push API
- Retry failed sends with bounded retries
- Persist result status

---

## Firestore Data Model

### `users/{userId}/notificationSettings`

```json
{
  "enabled": true,
  "scrollAlertThresholdSeconds": 1200,
  "cooldownSeconds": 7200,
  "trackedApps": ["Instagram", "TikTok", "X"],
  "quietHoursStart": "22:30",
  "quietHoursEnd": "07:00",
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

```json
{
  "type": "scroll_threshold",
  "appName": "Instagram",
  "sessionSeconds": 1560,
  "thresholdSeconds": 1200,
  "sentAt": "<timestamp>",
  "deliveryStatus": "sent",
  "dedupeKey": "user-app-day-threshold"
}
```

---

## Rule Logic (v1)

For each newly completed session:

1. Ignore if notifications disabled.
2. Ignore if app not in tracked apps.
3. Ignore if within quiet hours.
4. Ignore if `sessionSeconds < threshold`.
5. Ignore if cooldown not elapsed for same user+app+rule.
6. Else send:
   - **Title:** `Take a breath`
   - **Body:** `You've been on {appName} for {X} minutes. Want to pause now?`

---

## API/Service Additions

### Frontend -> Backend

1. `PUT /api/users/me/notification-settings`
   - Save threshold, cooldown, tracked apps, quiet hours
2. `POST /api/users/me/push-token`
   - Register/update Expo push token

### Backend internal modules

- `NotificationService.ts` (public wrapper interface)
- `NotificationServiceImpl.ts` (orchestrator)
- `notificationRules.ts` (threshold + cooldown checks)
- `notificationSender.ts` (Expo push integration)
- `notificationAudit.ts` (persist sent/skipped/failed)

---

## Frontend Integration

1. Request notification permission on onboarding/settings.
2. Get Expo push token and register with backend.
3. Add Settings UI:
   - Enable/disable alerts
   - Threshold selector (10m / 20m / 30m / custom)
   - Cooldown selector
4. Handle notification taps:
   - Deep-link to Stats screen with context (app + session duration)

---

## Observability (must-have)

Track these metrics from day one:

- Notifications attempted/sent/failed
- Open rate (tap-through)
- Users receiving >N alerts/day (spam signal)
- Weekly trend: users with decreasing average session length

---

## Rollout Plan

1. Build v1 threshold + cooldown alerts.
2. Run internal testing with test users.
3. Tune defaults (threshold/cooldown) based on alert fatigue and engagement.
4. Add v2 rules (streak nudges, time-of-day patterns, adaptive goals).

---

## Future Extensions

- Progressive escalation (gentle -> stronger language)
- Goal-based nudges (daily cap reminders)
- Positive reinforcement notifications (\"You cut usage 18% this week\")
- Context-aware reminders (late-night doomscrolling intervention)
