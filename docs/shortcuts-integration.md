# iOS Shortcuts Integration

This guide explains how iOS Shortcuts act as the **gatekeeper** for tracked apps — every app open goes through the backend first, and the app only launches if it isn't blocked.

## Architecture: Shortcut-as-Gatekeeper

Each tracked app's home screen icon is **replaced by a Shortcut** that controls access. The real app is hidden; the Shortcut checks the backend before deciding whether to open it.

```
User taps "Instagram" (actually a Shortcut)
  → Shortcut calls GET /api/gateway?userId=X&app=Instagram
  → Backend reads users/{userId}/blockedApps/Instagram

  ✅ Not blocked:
    → Shortcut POSTs open event to backend
    → Shortcut opens the real Instagram app

  🔒 Blocked:
    → Shortcut shows: "Instagram is blocked"
    → Shows timer (blocked since / unblocks at)
    → Shortcut ends — app NEVER opens

User eventually closes Instagram
  → iOS Automation fires "When Instagram is closed"
  → Close Shortcut POSTs close event to backend
```

### Two Shortcuts Per App

| Shortcut | Type | Trigger | What It Does |
|----------|------|---------|-------------|
| **Instagram** (launcher) | Home screen icon | User taps it | Checks gateway → opens app if not blocked |
| **Track Instagram Close** | Background automation | iOS "When App Is Closed" | Records close event |

### Why This Works

- The Shortcut runs **before** the app opens — if blocked, the app never launches
- Same technique used by commercial apps like "one sec"
- No native code, no MDM, no special entitlements required
- The `blocked` state is toggled from within the React Native app

---

## Firestore Schema

Each app's blocked state lives under the user's document:

```
users/{userId}/blockedApps/{appName}
  blocked: boolean
  blockedUntil: timestamp | null   // null = blocked indefinitely
  blockedAt: timestamp             // when the block was set
```

The gateway endpoint reads this document and returns the current state. If `blockedUntil` is set and has passed, the gateway treats the app as unblocked (and clears the flag).

---

## Backend Endpoints

### Gateway (called by launcher shortcut)

```
GET /api/gateway?userId={userId}&app={appName}
Headers: x-api-key: {SHORTCUT_API_KEY}

Response (not blocked):
{ "action": "allow" }

Response (blocked):
{ "action": "block", "blockedAt": "2026-05-12T10:00:00Z", "blockedUntil": "2026-05-12T14:00:00Z" }
// blockedUntil is null if blocked indefinitely
```

When the gateway allows, it also records the open event — no second API call needed from the Shortcut.

### Record Close (called by close shortcut)

```
POST /api/usage/record
Body: { "userId": "...", "appName": "...", "eventType": "close", "eventTime": "ISO8601" }
Headers: x-api-key: {SHORTCUT_API_KEY}

Response:
{ "status": "ok", "durationSeconds": 342 }
```

### Toggle Block (called from the React Native app)

```
POST /api/block
Body: { "userId": "...", "appName": "...", "blocked": true, "blockedUntil": "ISO8601 or null" }
Headers: x-api-key: {APP_API_KEY}

Response:
{ "status": "ok" }
```

---

## Shortcut Internals

### Launcher Shortcut (Open)

Actions:

```
0. Text: userId (stored at install via Import Question)
1. GET /api/gateway?userId={userId}&app={appName}
2. Get Dictionary Value: "action"
3. If "action" Is "block":
     Get Dictionary Value: "blockedUntil"
     // If blockedUntil is set, compute remaining time and show countdown
     // Otherwise show "Instagram is blocked"
     Show Alert: "Instagram is blocked\nUnblocks at {time}" (or "Blocked indefinitely")
   Otherwise:
     Open App: {bundleId}
   End If
```

The gateway records the open event server-side when it allows — no second call needed.

### Close Shortcut

Actions:

```
0. Get Current Date
1. Format Date → ISO 8601
2. Text: userId
3. POST /api/usage/record { userId, appName, eventType: "close", eventTime }
```

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
4. You can still find it via App Library or Spotlight search

### Step 4: Set Up Close Automation

1. Open **Shortcuts** → **Automations** tab
2. Tap **+** → **App**
3. Select the app (e.g., Instagram)
4. Check **Is Closed** only
5. Tap **Next** → search for and select the close shortcut
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
| Close automation requires "When App Is Closed" trigger | User must set this up manually (iOS restriction) |
| Shortcut icon must be set manually | User picks the app icon when adding to home screen |
| No background enforcement if phone is locked/rebooted | Shortcut-based — runs on user action only |
| Shortcut alert timer is static | iOS Shortcuts can't show a live countdown; shows target unblock time instead |

---

## Troubleshooting

| Issue | Solution |
|-------|---------|
| App opens even when blocked | User is tapping the real app, not the shortcut — hide the real app |
| Close events not recording | Verify the close automation is set up and "Ask Before Running" is off |
| "Network error" in shortcut | Check API URL is correct and backend is deployed |
| Shortcut file won't import | Verify it's signed — run `shortcuts sign` locally |
| Block not clearing | Check `blockedUntil` timestamp in Firestore — may be a timezone issue |
