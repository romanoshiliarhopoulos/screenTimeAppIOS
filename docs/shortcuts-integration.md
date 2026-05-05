# iOS Shortcuts Integration

This guide explains how users set up iOS Shortcuts automations to collect app usage data.

## Overview

Instead of your app tracking app usage in the background, users create iOS Shortcuts that automatically log when they open/close "doomscroll" apps (Instagram, TikTok, YouTube, etc.). These Shortcuts send the data to your backend API.

**Advantages:**

- Works without special entitlements or permissions
- Users control exactly what apps are tracked
- Easy to add/remove apps
- Fully transparent (users see the automations)

## Distribution: How Users Get Their Shortcuts

The goal is zero manual configuration for users. After onboarding, the app generates a personalized Shortcut file — with the user's `userId`, `deviceId`, and each tracked app pre-configured — and downloads it directly into the Shortcuts app.

### How It Works

```
User completes onboarding
  → Selects apps to track: ["Instagram", "TikTok"]
  → Taps "Set Up Shortcuts" button in app

App calls GET /api/shortcuts/generate?userId=xxx&deviceId=xxx&apps=Instagram,TikTok
  → Backend generates a .shortcut file for each tracked app
  → Each file has userId, deviceId, appName, and API URL baked in

App opens the download URL via Linking.openURL()
  → Safari opens briefly → iOS intercepts the .shortcut file
  → Shortcuts app launches with the "Add Shortcut" import screen

User taps "Add Shortcut" → done
  → One manual step remains: set up the Automation trigger
```

### The One Manual Step (Unavoidable)

iOS does not allow apps to create automation triggers programmatically. Users must do this once per tracked app:

```
1. Open Shortcuts app → Automations tab
2. Tap "+" → New Automation → App
3. Select the app (e.g., Instagram)
4. Check "Is Opened" and "Is Closed"
5. Tap "Next" → Add Action → "Run Shortcut"
6. Select the "Track Instagram" shortcut you just added
7. Disable "Ask Before Running"
8. Tap "Done"
```

Provide a screenshot walkthrough in the app's onboarding flow for this step. It takes ~30 seconds.

### What Gets Baked Into the Shortcut File

| Field      | How It's Set                                           |
| ---------- | ------------------------------------------------------ |
| `userId`   | Hardcoded at generation time from the user's account   |
| `deviceId` | Read dynamically via `Device Details → Name` action    |
| `appName`  | Hardcoded per file (one file per tracked app)          |
| API URL    | Hardcoded at generation time from your Vercel endpoint |

`deviceId` is read dynamically — not baked in — so the shortcut stays correct if the user switches phones or renames their device.

---

## Backend: Generating Shortcut Files

### Endpoint

```
GET /api/shortcuts/generate?userId={userId}&apps={comma-separated app names}
```

Returns a `.shortcut` file download (one app per file). To generate multiple, call the endpoint once per app and present each as a separate download step.

### How the .shortcut Format Works

`.shortcut` files are signed binary plist (Apple Property List) files. iOS automatically opens them in Shortcuts when downloaded. The pipeline to generate one:

```
XML plist template → fill placeholders → plutil (binary) → shortcuts sign → serve
```

Serve the signed file with:

```
Content-Type: application/x-apple-shortcut
Content-Disposition: attachment; filename="Track Instagram.shortcut"
Cache-Control: no-store
```

The plist structure and generator are in [backend/shortcuts/](../backend/shortcuts/). The template was validated locally: XML lint passes, binary conversion succeeds, and `shortcuts sign` accepts it.

### Backend Implementation

Two files implement generation:

**[backend/shortcuts/tracker-template.plist.xml](../backend/shortcuts/tracker-template.plist.xml)** — the validated XML plist template with `{{PLACEHOLDER}}` values for `USER_ID`, `APP_NAME`, `API_URL`, and five UUIDs (one per action, used to wire variable references between actions).

**[backend/shortcuts/generate-shortcut.ts](../backend/shortcuts/generate-shortcut.ts)** — strips comments, fills placeholders with `crypto.randomUUID()` per request, converts to binary via `plutil`, and signs via `shortcuts sign`. Returns a `Buffer` ready to send.

**[backend/functions/api/shortcuts/generate.ts](../backend/functions/api/shortcuts/generate.ts)** — the Vercel Function that calls the generator:

```
GET /api/shortcuts/generate?userId={userId}&app={appName}
```

Returns the signed `.shortcut` file. One app per request; the client calls once per tracked app.

> **Deployment note:** `plutil` and `shortcuts` are macOS CLI tools. Vercel's Linux build environment does not have them. For production, run this endpoint on a Mac mini, use a macOS GitHub Actions runner to pre-generate files, or find a pure-Node plist signer. For a class project running on your own machine (local tunnel via ngrok or Cloudflare), the current implementation works fine.

---

## App-Side: Triggering the Download

After the user selects apps to track during onboarding, present a "Set Up Shortcuts" screen.

```typescript
// src/screens/ShortcutSetup.tsx
import * as Linking from "expo-linking";

const API_BASE = "https://your-backend.vercel.app";

async function downloadShortcut(userId: string, appName: string) {
  const url = `${API_BASE}/api/shortcuts/generate?userId=${userId}&apps=${encodeURIComponent(appName)}`;
  await Linking.openURL(url);
  // iOS opens Safari briefly, intercepts the .shortcut file,
  // then launches Shortcuts with the import dialog
}

// In the onboarding screen, after app selection:
async function handleSetupShortcuts(userId: string, trackedApps: string[]) {
  for (const app of trackedApps) {
    await downloadShortcut(userId, app);
    // Brief pause between opens so iOS processes each import
    await new Promise((r) => setTimeout(r, 1500));
  }
}
```

### Onboarding Screen Flow

```
┌─────────────────────────────────────────┐
│  You're tracking: Instagram, TikTok     │
│                                         │
│  [Set Up Shortcuts] ←── main CTA        │
│                                         │
│  After tapping:                         │
│  1. Shortcuts will open twice           │
│     (once per app) — tap "Add" each     │
│  2. Then follow the 3-step automation   │
│     setup shown below                   │
│                                         │
│  [Screenshots of Automation setup]      │
└─────────────────────────────────────────┘
```

### Regenerating Shortcuts

If a user adds or removes tracked apps, or if their account changes, they can regenerate shortcuts from Settings. The old shortcuts can be deleted in the Shortcuts app manually, or new ones simply replace the old ones since they have the same name.

---

## How It Works

### User Perspective (after distribution)

1. User taps "Set Up Shortcuts" in app after onboarding
2. Shortcuts app opens once per tracked app with "Add Shortcut" dialog
3. User taps "Add Shortcut" for each
4. User sets up automation trigger once per app (30 seconds, guided by screenshots)
5. From now on, every time they open/close the tracked app, Shortcut automatically fires and logs the event

### Technical Perspective

**Shortcut Actions (per tracked app):**

1. **On app open or close:** Read device name → Get current timestamp → Build JSON body → POST to `/api/recordUsage`
2. The shortcut does not distinguish open vs. close — the backend infers session boundaries from the event stream

**API Endpoint:**

```
POST https://your-backend.com/api/recordUsage

Body:
{
  "userId": "user123",
  "deviceId": "Romanos iPhone",
  "appName": "Instagram",
  "eventTime": 1715000000
}
```

---

## API Endpoint Reference

### Record Usage Data

**Endpoint:** `POST /api/recordUsage`

**Request Body:**

```json
{
  "userId": "user123",
  "deviceId": "Romanos iPhone",
  "appName": "Instagram",
  "openTime": 1715000000,
  "closeTime": 1715001800
}
```

**Response:**

```json
{
  "success": true,
  "message": "Usage recorded",
  "sessionId": "session-12345"
}
```

**Notes:**

- `userId` is set at shortcut generation time; `deviceId` is read live from the device
- `openTime` and `closeTime` are Unix timestamps (seconds since epoch)
- Either `openTime` or `closeTime` can be null (log opening or closing separately)
- API is idempotent (same request twice = same result)

---

## Testing Without the Shortcut

To test your backend API before building Shortcuts, use curl:

```bash
curl -X POST https://your-backend.com/api/recordUsage \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "test-user",
    "deviceId": "test-device",
    "appName": "Instagram",
    "openTime": 1715000000,
    "closeTime": 1715001800
  }'
```

Or use this HTTP file for testing (save as `test-requests.http`):

```http
### Record an app opening
POST https://your-backend.com/api/recordUsage
Content-Type: application/json

{
  "userId": "user123",
  "deviceId": "iPhone-ABC",
  "appName": "Instagram",
  "openTime": 1715000000
}

### Record an app closing
POST https://your-backend.com/api/recordUsage
Content-Type: application/json

{
  "userId": "user123",
  "deviceId": "iPhone-ABC",
  "appName": "Instagram",
  "closeTime": 1715001800
}
```

---

## Troubleshooting

| Issue                                  | Solution                                                                     |
| -------------------------------------- | ---------------------------------------------------------------------------- |
| Shortcut not running                   | Check if automation is enabled in Shortcuts → Automations                    |
| Shortcut file doesn't open in app      | Ensure `Content-Type: application/x-apple-shortcut` is set on the response  |
| iOS shows "Can't open file"            | Verify the plist structure matches an exported Shortcuts file                |
| API returns 404                        | Verify backend URL is correct and API endpoint exists                        |
| API returns 500                        | Check Firestore rules allow writing; check Vercel Functions logs             |
| Data not appearing in app              | Check Firestore Rules allow reads; verify userId matches                     |
| User switched phones / userId changed  | Regenerate shortcuts from app Settings — tap "Set Up Shortcuts" again        |

---

## Known Limitation: Unlock Sessions

iOS Shortcuts fire `App Closed` when the phone locks and `App Opened` when the user explicitly opens an app. However, **unlocking the phone directly back into an already-open app does not fire `App Opened`**. This means a session that starts from an unlock is not captured via the normal open event.

### How This Manifests

```
open(10:00)  → close(10:05)  → [unlock ~10:20, no event]  → close(11:30)
                ↑ phone locked                               ↑ user exited
```

The backend receives two consecutive close events with no open in between. This pattern exclusively identifies an unlock session.

### Session Reconstruction (20-Minute Cap)

The backend detects this pattern and reconstructs the missing open event dynamically:

```
inferred_open = max(previousClose, currentClose - 20min)
```

- If the user locked and came back within 20 minutes, the full gap is used as the session start
- If the gap exceeds 20 minutes, the session is anchored 20 minutes before the close — reflecting the upper bound of a typical undetected scrolling session before the user consciously exits

Reconstructed sessions are stored with `status: "inferred_unlock"` so they can be surfaced differently in the UI (e.g., "~18 min" rather than a precise figure).

### Firestore Event Structure

Each event is stored individually, and sessions are derived on write:

```json
{
  "userId": "user123",
  "deviceId": "Romanos iPhone",
  "appName": "Instagram",
  "eventType": "open" | "close",
  "timestamp": 1715000000,
  "sessionId": "session-xyz"
}
```

Session documents:

```json
{
  "openTime": 1715001200,
  "closeTime": 1715002800,
  "durationSeconds": 1600,
  "status": "clean" | "inferred_unlock" | "timed_out"
}
```

---

## Limitations

- Shortcuts runs on-device; if the app is force-closed, Shortcut won't trigger
- Users must have Shortcuts app and iPhone (iOS 13+)
- Requires user to enable "Allow Running Scripts" in Shortcuts settings
- Automation triggers must be created manually by the user (iOS restriction — cannot be automated)
- Unlock-to-same-app sessions are reconstructed with a 20-minute cap — not exact
- No background tracking if phone is locked/rebooted (Shortcut runs on-demand when app activity detected)

---

## Next Steps

1. Deploy your backend API (see [Deployment Guide](deployment.md))
2. Export a real shortcut from Shortcuts.app and inspect its plist structure with `plutil -convert xml1`
3. Implement `GET /api/shortcuts/generate` using the plist structure as your template
4. Test the download on device — tap the URL, confirm Shortcuts opens the import dialog
5. Wire up the "Set Up Shortcuts" button in the onboarding screen
6. Add automation setup screenshots to the onboarding flow
