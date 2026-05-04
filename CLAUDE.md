# Development Guide

This document provides essential context for Claude agents working on this project.

## Project Overview

This is an iOS app that helps users break the doomscrolling habit by monitoring and limiting screen time. Built with React Native, it integrates with Apple's Screen Time API (Family Controls framework).

**Purpose:** Computer Interface class project (development/internal use only)  
**Target Platform:** iOS (physical device required for testing)  
**Tech Stack:** React Native, Xcode, Apple Screen Time API  
**Budget:** None — using free distribution methods and development tools only

## Before Starting Any Task

1. **Review the Screen Time API patterns** — [Screen Time API Patterns](docs/screen-time-api.md)
2. **Understand the architecture** — [Architecture Overview](docs/architecture.md)
3. **Follow testing conventions** — [Testing Guide](docs/testing.md)

## Key Constraints

- **Family Controls Entitlement Required (for full features):** The Screen Time API requires a provisioning profile with the `com.apple.developer.family-controls` entitlement. Apple approval may be delayed or denied for class projects. Full Screen Time access may not be available without entitlement.
- **Development-Only App:** This is not a published app. No App Store submission, no production requirements.
- **iOS Only:** Currently targeting iOS. Android support is not planned.
- **React Native:** Use React Native patterns, not native Swift code unless absolutely necessary.
- **Zero Budget:** Use free distribution methods (TestFlight, ad-hoc provisioning) and free tools only.

## Distribution & Data Collection

### For Collecting Data from Testers

**Option 1: TestFlight (Recommended)**
- Apple's official free beta testing platform
- Can invite up to 10,000 testers via link or email
- No budget required
- Automatic crash logs and usage metrics
- Tester data is collected privately by Apple

**Option 2: Ad-Hoc Provisioning**
- Manual provisioning for specific devices
- Useful for < 10 testers (same group)
- Requires device UDIDs registered in Apple Developer account (free tier allows ~100 devices)
- Share signed .ipa file directly

**Option 3: Direct Development Installation**
- Tester connects their device to your Mac
- Install via Xcode (free tier supports any device)
- Best for small in-person testing

### For Accessing Screen Time Data

**With Family Controls Entitlement (Full Access):**
- Direct access to per-app screen time, device activity, and usage reports
- Requires Apple approval (may take weeks or be denied for class projects)

**Without Entitlement (Current Fallback):**
- Request user permission in-app to enable Screen Time notifications
- Use `DeviceActivityEventFilter` for limited data (requires entitlement request submission)
- Implement custom event tracking: log when user opens/closes "doomscroll" apps
- Collect anonymized usage via analytics (no budget → use free tier services)
- Ask users to manually input or share screen time screenshots (low-fi approach for class demo)

## Code Conventions

- Use functional components in React Native
- Keep native bridging code in `src/native/` directory
- Always document why native modules are needed
- Test on physical device for Screen Time API features

## Common Tasks

- Adding a new screen: Create component in `src/screens/`, add route to navigator
- Integrating with Screen Time API: Use native modules in `src/native/`, export clean JS interface
- Adding UI features: Use existing component patterns, test across device sizes

## Getting Help

- **Screen Time API issues:** Check docs/screen-time-api.md and Apple's official documentation
- **Architecture questions:** Refer to docs/architecture.md
- **Test failures:** Review docs/testing.md for test patterns
