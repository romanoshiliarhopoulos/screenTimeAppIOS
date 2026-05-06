# Stop Doomscrolling

An iOS app that helps users break the doomscrolling habit by tracking app usage patterns via iOS Shortcuts automations.

## Overview

Stop Doomscrolling is built for a Computer Interface class project. **Zero budget. No Apple Developer account needed.** It combines iOS Shortcuts (for automatic data collection) with a React Native app (for viewing insights) and a serverless backend (for storage and push notifications).

## How It Works
1. **User sets up Shortcuts** — Creates iOS automations that log when they open/close apps (Instagram, TikTok, etc.)
2. **Shortcuts send data to backend** — Each app open/close triggers an HTTP request with: `appName`, `openTime`, `closeTime`, `userId`
3. **App displays insights** — React Native app fetches data from backend and shows usage trends and patterns
4. **Backend sends notifications** — When usage is high, app sends push notifications to nudge the user

## Tech Stack

- **Frontend:** React Native (via Expo) — instant testing, no builds needed
- **Backend:** Vercel Functions (serverless APIs)
- **Database:** Firestore
- **Data Collection:** iOS Shortcuts automations (user-configured)
- **Push Notifications:** Apple Push Notification service (APNs, via Expo)

## Features

- View daily/weekly app usage broken down by app
- See which apps consume the most time
- Receive push notifications when usage is high
- Configure which apps to track
- Manual data entry fallback

## Prerequisites

- Node.js and npm/yarn
- An iOS device (iPhone/iPad)
- Expo Go app (free, download from App Store)
- Vercel account (free tier)
- Firestore account (free tier, part of Firebase)

## Getting Started

### 1. Frontend Setup

```bash
# Clone and install
npm install

# Start dev server
npm start

# Scan QR code with Expo Go app on iPhone
# App opens and live-reloads as you code
```

### 2. Set Up Shortcuts

See [iOS Shortcuts Integration](docs/shortcuts-integration.md) for shareable iCloud links. Users simply:
- Click the iCloud link on their iPhone
- Tap "Add Shortcut"
- Grant necessary permissions

### 3. Set Up Backend

See [Deployment Guide](docs/deployment.md) for:
- Firestore setup (1 minute)
- Vercel Functions deployment (1 minute)
- APNs certificate setup (5 minutes)

## Project Structure

```
screenTimeAppIOS/
├── src/
│   ├── screens/           # Full-screen views (Dashboard, Stats, Settings)
│   ├── components/        # Reusable UI components
│   ├── hooks/             # Custom React hooks
│   ├── utils/             # Helper functions
│   └── types/             # TypeScript definitions
├── backend/
│   ├── functions/         # Vercel Functions (API endpoints)
│   ├── firestore-rules/   # Firestore security rules
│   └── shortcuts/         # Example Shortcut automation templates
├── docs/
│   ├── architecture.md    # System design (3-layer architecture)
│   ├── shortcuts-integration.md  # Setting up Shortcuts
│   ├── deployment.md      # Backend & APNs setup
│   └── testing.md         # Testing patterns
└── CLAUDE.md              # Development guide for Claude agents
```

## Distribution

### For Testing with Friends

**Easiest — Expo Go (Instant):**
- Send them: `npm start` → they scan QR code with Expo Go app
- No build steps, live updates

**Standalone Build:**
```bash
eas build --platform ios
# Share the resulting iOS app link or .ipa file
```

### Collecting Data

Share iOS Shortcuts via iCloud links (see [Shortcuts Integration](docs/shortcuts-integration.md)). No build process needed — users just click the link and tap "Add Shortcut."

## Important Notes

- **iOS Shortcuts Setup:** Users must manually set up Shortcuts automations (it's easy via iCloud links, takes <1 minute per app)
- **Expo Go:** Requires Expo Go app on iPhone for instant testing. No Xcode, no TestFlight, no $99 Apple Developer account
- **Free Services:** All tools use free tiers (Expo, Vercel, Firestore) — genuinely zero cost
- **Data Privacy:** All data stays in your Firestore project; users own their data

## Documentation

- **[CLAUDE.md](CLAUDE.md)** — Development guide for contributors
- **[docs/architecture.md](docs/architecture.md)** — How the three layers work together
- **[docs/shortcuts-integration.md](docs/shortcuts-integration.md)** — How to create and share Shortcuts
- **[docs/deployment.md](docs/deployment.md)** — How to deploy the backend
- **[docs/testing.md](docs/testing.md)** — Testing patterns and conventions

## License

MIT
