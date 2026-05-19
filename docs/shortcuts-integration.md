# iOS Shortcuts Integration

This guide explains how iOS Shortcuts act as the **gatekeeper** for tracked apps — every app open goes through the backend first, and the app only launches if it isn't blocked.

## Architecture: Three Shortcuts Per App

Each tracked app uses **three** shortcuts:

| Shortcut | Type | Trigger | What It Does |
|----------|------|---------|-------------|
| **{App}** (launcher) | Home screen icon | User taps it | Checks gateway → shows block alert or opens app |
| **Track {App} Open** | Background automation | iOS "When App Opens" | Records open event to backend |
| **Track {App} Close** | Background automation | iOS "When App Is Closed" | Records close event to backend |

```
User taps "Instagram" (actually the Launcher shortcut)
  → GET /api/gateway?userId=X
  → If response ≠ {} → show alert "Locked for N min · by You" → end
  → If response = {} → open the real Instagram app

iOS fires "When Instagram Opens" automation
  → Track Instagram Open shortcut POSTs open event to backend

iOS fires "When Instagram Closes" automation
  → Track Instagram Close shortcut POSTs close event to backend
```

---

## Gateway Protocol

The launcher shortcut checks the gateway and uses a single condition to decide:

| Gateway Response | Meaning | Shortcut Action |
|-----------------|---------|----------------|
| Plain text (e.g. `"Locked for 5 min · by You"`) | Locked | Show alert with the text, stop |
| `{}` (empty JSON) | Allowed | Open the real app |

The condition is **"Gateway Response is not {}"**:
- Plain text ≠ `{}` → **True** → show alert
- `{}` = `{}` → **False** → open app

---

## Shortcut Internals

### Launcher Shortcut — 10 actions

```
0. Get Current Date                   → "Event Time"
1. Format Date (ISO 8601)             → "Formatted Time"
2. Format Date (yyyy-MM-dd)           → "Local Date"
3. Text: userId  [Import Question]    → "User ID"
4. GET /api/gateway?userId={User ID}  → "Gateway Response"
5. If Gateway Response is not {}      (WFCondition 5 = does not equal)
6.   Show Alert "{App} is Blocked" — message: {Gateway Response}
7. Otherwise
8.   Open App: {bundle ID}
9. End If
```

The Import Question at action 3 prompts the user to paste their User ID the first time the shortcut runs.

### Open / Close Tracker — 4 actions each

```
0. Get Current Date                                           → "Event Time"
1. Format Date (ISO 8601)                                     → "Formatted Time"
2. Text: userId  [Import Question]                            → "User ID"
3. POST /api/usage/record?userId={User ID}&appName={App}
         &eventType=open|close&eventTime={Formatted Time}
```

---

## Backend Endpoints

### Gateway (called by launcher shortcut)

```
GET /api/gateway?userId={userId}
Headers: Cache-Control: no-store (set by server)

Response when locked:
  Status: 200, Content-Type: text/plain
  Body: "Locked for 5 min · by Alex"

Response when allowed:
  Status: 200, Content-Type: application/json
  Body: {}
```

### Record Usage (called by open/close tracker shortcuts)

```
POST /api/usage/record?userId={userId}&appName={app}&eventType=open|close&eventTime={ISO8601}

Response: 200 OK
```

### Lock Endpoints (called from the app)

```
POST /api/self-lock           — lock yourself out (default 15 min)
POST /api/sos                 — SOS: self-lock + notify friends
POST /api/lock/{targetUserId} — lock a friend (requires friendship)
POST /api/lock-friend/{targetUserId} — spend credits to lock a friend 5–25 min
```

---

## Firestore Lock State

The lock state is stored directly on the user document:

```
users/{userId}
  locked: boolean
  lockedUntil: ISO8601 timestamp
  lockedBy: userId of the person who locked
  lockedByName: display name of the locker
```

When `lockedUntil` has passed, the gateway clears the lock automatically on the next call.

---

## Generating Shortcuts

Run locally on a Mac (requires the `shortcuts` CLI):

```bash
cd backend
python scripts/generate_block_shortcuts.py
# Output: backend/shortcuts/new_shortcuts/
# 36 files total: {App}-launcher, {App}-open, {App}-close for all 12 apps
```

---

## User Setup (Per Tracked App)

### Step 1: Install all three shortcuts

Download `{App}-launcher.shortcut`, `{App}-open.shortcut`, and `{App}-close.shortcut`. Tap each to import into the Shortcuts app. On first run, each will ask for your User ID.

### Step 2: Add launcher to home screen

1. Open **Shortcuts** app
2. Long-press the launcher shortcut (e.g. "Instagram")
3. Tap **Share** → **Add to Home Screen**
4. Set the name to the app name (e.g. "Instagram")
5. Tap the icon to choose the app's real icon
6. Tap **Add**

### Step 3: Hide the real app

Long-press the real app icon → **Remove from Home Screen** (not "Delete App"). The app remains installed but only accessible via the launcher shortcut.

### Step 4: Set up Open and Close automations

For both the open and close tracker:

1. Open **Shortcuts** → **Automations** tab → **+**
2. Tap **App**
3. Select the app (e.g. Instagram)
4. Check **Is Opened** (for open tracker) or **Is Closed** (for close tracker)
5. Tap **Next** → select the corresponding tracker shortcut
6. Disable **Ask Before Running**
7. Tap **Done**

---

## Supported Apps + Bundle IDs

| App | Bundle ID |
|-----|-----------|
| Instagram | `com.burbn.instagram` |
| YouTube | `com.google.ios.youtube` |
| TikTok | `com.zhiliaoapp.musically` |
| Facebook | `com.facebook.Facebook` |
| X (Twitter) | `com.atebits.Tweetie2` |
| Snapchat | `com.toyopagroup.picaboo` |
| Reddit | `com.reddit.Reddit` |
| Threads | `com.burbn.barcelona` |
| WhatsApp | `net.whatsapp.WhatsApp` |
| Discord | `com.hammerandchisel.discord` |
| Twitch | `tv.twitch` |
| LinkedIn | `com.linkedin.LinkedIn` |

---

## Known Limitations

| Limitation | Impact |
|-----------|--------|
| User can find the real app via App Library / Spotlight | Bypasses the gatekeeper — requires deliberate effort |
| Open/Close automations must be set up manually | iOS restriction — cannot be automated |
| Shortcut icon must be set manually | User picks the icon when adding to home screen |
| No enforcement if shortcut is bypassed | Shortcut-based gating only; determined users can circumvent |

---

## Troubleshooting

| Issue | Solution |
|-------|---------|
| App opens when locked | User tapped real app, not launcher shortcut — hide real app |
| "Instagram is Blocked" shows when not locked | Stale cache — gateway always returns `Cache-Control: no-store` now; re-run shortcut |
| Open/close events not recording | Verify automations are set up and "Ask Before Running" is off |
| "Network error" in shortcut | Check API URL in shortcut matches deployed backend |
| Shortcut file won't import | Must be signed — run `shortcuts sign --mode anyone` locally on Mac |
