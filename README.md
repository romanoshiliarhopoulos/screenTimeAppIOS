# Stop Doomscrolling

A mobile app that helps users break the doomscrolling habit by monitoring and limiting screen time on iOS.

## Overview

 An iOS app built for a Computer Interface class project. **Development/internal use only. No budget.** It integrates with Apple's Screen Time API to track app usage and give users the tools to set intentional limits on distracting apps.

## Tech Stack

- **Frontend:** React Native
- **Platform:** iOS
- **API:** Apple Screen Time API (via native modules / Family Controls framework)
- **Distribution:** Free (TestFlight, ad-hoc provisioning, or development installation)

## Features

- Track daily screen time per app (with fallback if Screen Time API unavailable)
- Set usage limits on social media and other distracting apps
- Receive nudges and interventions when doomscrolling is detected
- usage reports
- Works with or without Family Controls entitlement

## Prerequisites

- macOS with Xcode installed
- Node.js and npm/yarn
- React Native CLI
- Apple Developer account (free tier is fine)
- One or more iOS devices for testing

## Getting Started

```bash
# Install dependencies
npm install

# Run on iOS simulator (for UI testing)
npx react-native run-ios

# Build for physical device (required for actual screen time access)
# See docs/screen-time-api.md for entitlement setup
```

## Distribution

### For Testing with Others

**TestFlight (Recommended):**

```bash
# Build and upload to TestFlight via Xcode
# Then invite testers via email or public link
```

**Ad-Hoc Provisioning (Small Groups):**

- Register device UDIDs in Apple Developer account
- Share signed .ipa file with testers

**Development Installation:**

- Connect tester's device to your Mac via Xcode

See [Distribution Options](docs/screen-time-api.md#distribution-for-data-collection) for details.

## Project Structure

```
screenTimeAppIOS/
├── src/
│   ├── components/    # UI components
│   ├── screens/       # App screens
│   └── native/        # Native module bridges to Screen Time API
├── ios/               # Xcode project
└── docs/
    ├── screen-time-api.md  # API integration & fallback strategy
    ├── architecture.md     # System design
    └── testing.md          # Test patterns
```

## Important Notes

- **Family Controls Entitlement:** Approval is uncertain and may take weeks. The app has a fallback approach (custom tracking) if denied.
- **Physical Device Required:** Screen Time API only works on real iOS devices, not simulators.
- **No Cost:** Built for class project with zero budget. All tools and services used are free.

## Documentation

- [CLAUDE.md](CLAUDE.md) — Development guide for Claude agents
- [docs/screen-time-api.md](docs/screen-time-api.md) — Full API integration strategy with fallbacks
- [docs/architecture.md](docs/architecture.md) — System architecture overview
- [docs/testing.md](docs/testing.md) — Testing conventions and patterns

## License

MIT
