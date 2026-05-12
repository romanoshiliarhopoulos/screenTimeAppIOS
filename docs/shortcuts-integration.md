# iOS Shortcuts Integration

This guide explains how iOS Shortcuts act as the **gatekeeper** for tracked apps — every app open goes through the backend first, and the app only launches if allowed.

## Architecture: Shortcut-as-Gatekeeper

Instead of tracking app usage passively, each tracked app's home screen icon is **replaced by a Shortcut** that controls access. The real app is hidden; the Shortcut decides whether to open it.

```
User taps "Instagram" (actually a Shortcut)
  → Shortcut calls GET /api/gateway?userId=X&app=Instagram
  → Backend checks: shame → lock → quiet hours → daily limits

  ✅ Allowed:
    → Backend records the open event
    → Shortcut opens the real Instagram app

  🔒 Blocked:
    → Shortcut shows alert: "Locked out by Alex for 2 more minutes"
    → Shortcut ends — app NEVER opens

User eventually closes Instagram
  → iOS Automation fires "When Instagram is closed"
  → Close Shortcut records the close event
```

### Two Shortcuts Per App

| Shortcut | Type | Trigger | What It Does |
|----------|------|---------|-------------|
| **Instagram** (launcher) | Home screen icon | User taps it | Calls gateway → opens app if allowed |
| **Track Instagram Close** | Background automation | iOS "When App Is Closed" | Records close event |

### Why This Works

- The Shortcut runs **before** the app opens — if blocked, the app never launches
- Same technique used by commercial apps like "one sec"
- No native code, no MDM, no special entitlements required
- Users control which apps are gated

---

## What the Gateway Controls

The gateway endpoint (`GET /api/gateway`) is the single decision point. It checks, in priority order:

| Check | Result if triggered |
|-------|-------------------|
| **Pending shame** | Block — shows shame message |
| **Friend-triggered lock** | Block — shows who locked you and remaining time |
| **Quiet hours** | Block — shows "Quiet hours until HH:MM" |
| **Daily open limit** | Delay/block — escalating friction based on opens today |
| **Daily time limit** | Block — shows "Time limit exceeded for [app]" |
| None triggered | **Allow** — records open event, opens the app |

### Lock Triggers

| Trigger | Duration | How |
|---------|----------|-----|
| Quick shame from friend | 120 seconds | Automatic on any shame |
| Emergency shame | 300 seconds (5 min) | `reaction: "emergency"` |
| Friend lock (`POST /api/lock/{id}`) | 60s default, max 300s | Manual from app |
| SOS self-lock | 900 seconds (15 min) | User calls `POST /api/sos` |

---

## Distribution: How Users Get Their Shortcuts

### Generating Shortcuts

The backend generates `.shortcut` files pre-configured with the user's ID, API URL, and target app.

```
GET /api/shortcuts/download?appName=Instagram&event=open
GET /api/shortcuts/download?appName=Instagram&event=close
```

Each file is a signed binary plist that iOS automatically imports into the Shortcuts app.

### What's Baked Into Each Shortcut

| Field | How It's Set |
|-------|-------------|
| `userId` | Import Question — user pastes their ID on first run |
| `appName` | Hardcoded per file |
| API URL | Hardcoded at generation time |
| App bundle ID | Hardcoded (for the "Open App" action in launchers) |

---

## User Setup (Per Tracked App)

### Step 1: Download Both Shortcuts

Download the launcher (open) and close shortcuts from the app's setup screen.

### Step 2: Add Launcher to Home Screen

1. Open **Shortcuts** app
2. Long-press the launcher shortcut (e.g., "Instagram")
3. Tap **Share** → **Add to Home Screen**
4. Set the name to the app name (e.g., "Instagram")
5. Tap the icon → choose the app's icon from your photos or the web
6. Tap **Add**

### Step 3: Hide the Real App

1. Long-press the **real** app icon on your home screen
2. Tap **Remove from Home Screen** (NOT "Delete App")
3. The app is still installed — just not on the home screen
4. You can always find it via App Library or Spotlight search

### Step 4: Set Up Close Automation

1. Open **Shortcuts** → **Automations** tab
2. Tap **+** → **App**
3. Select the app (e.g., Instagram)
4. Check **Is Closed** only
5. Tap **Next** → search for and select the close shortcut
6. Disable **Ask Before Running**
7. Tap **Done**

---

## Shortcut Internals

### Launcher Shortcut (Open)

Actions:

```
0. Get Current Date
1. Format Date → ISO 8601
2. Text: userId (filled by Import Question at install)
3. GET /api/gateway?userId={userId}&app={appName}&eventTime={timestamp}
4. Get Dictionary Value: "action"
5. If "action" Is Not "allow":
     Get Dictionary Value: "message" (from step 3 response)
     Show Alert: {message}
   Otherwise:
     Open App: {bundleId}
   End If
```

The gateway records the open event server-side when it allows, so no second API call is needed.

### Close Shortcut

Actions (unchanged from original):

```
0. Get Current Date
1. Format Date → ISO 8601
2. Text: userId
3. POST /api/usage/record?userId={userId}&appName={appName}&eventType=close&eventTime={timestamp}
```

### Supported Apps + Bundle IDs

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

## Backend Endpoints

### Gateway (called by launcher shortcut)

```
GET /api/gateway?userId={userId}&app={appName}&eventTime={iso8601}
Headers: x-api-key: {SHORTCUT_API_KEY}

Response (allowed):
{ "action": "allow", "allowed": true, "opensToday": 3 }

Response (blocked):
{ "action": "block", "allowed": false, "message": "Alex locked you out", "seconds": 120 }

Response (delay):
{ "action": "delay", "allowed": false, "message": "Opening #12 today", "seconds": 30 }
```

When the gateway allows, it also:
- Records the open event in `users/{userId}/events`
- Creates an active session for live presence tracking
- Increments the daily open count

### Record Usage (called by close shortcut)

```
POST /api/usage/record?userId={userId}&appName={appName}&eventType=close&eventTime={iso8601}
Headers: x-api-key: {SHORTCUT_API_KEY}

Response:
{ "status": "ok", "durationSeconds": 342 }
```

---

## Generating Shortcut Files

Shortcut files are pre-generated locally (requires macOS for signing) and served as static files.

### Generate All Shortcuts

```bash
cd backend
python scripts/generate_shortcuts.py
```

This produces 24 files in `backend/shortcuts/signed/`:
- 12 launcher shortcuts (one per app)
- 12 close shortcuts (one per app)

### Regenerating

Run `generate_shortcuts.py` whenever:
- The API URL changes
- The shortcut logic changes (gateway check, new actions)
- A new app is added to the supported list

---

## Known Limitations

| Limitation | Impact |
|-----------|--------|
| User can find the real app via App Library / Spotlight | Bypasses the gatekeeper — but requires deliberate effort |
| Close automation requires "When App Is Closed" trigger | User must set this up manually (iOS restriction) |
| Shortcut icon must be set manually | User picks the app icon when adding to home screen |
| Unlock-to-same-app doesn't fire close | Backend uses 20-min cap heuristic for orphaned sessions |
| No background enforcement if phone is locked/rebooted | Shortcut-based — runs on user action only |

---

## Troubleshooting

| Issue | Solution |
|-------|---------|
| Shortcut shows alert every time | Check if user is locked — verify in Firestore `gatewayState/current` |
| App opens even when locked | User is tapping the real app, not the shortcut — hide the real app |
| Close events not recording | Verify the close automation is set up and "Ask Before Running" is off |
| "Network error" in shortcut | Check API URL is correct and backend is deployed |
| Shortcut file won't import | Verify it's signed — run `shortcuts sign` locally |
| Lock not expiring | Check `lockedUntil` timestamp in Firestore — may be a timezone issue |
