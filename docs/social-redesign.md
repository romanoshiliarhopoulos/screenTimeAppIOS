# Social Redesign: Doomscroll Together, Quit Together

## Vision

This is not a productivity tool. It's a **multiplayer game where doomscrolling is the enemy** and your friends are both your teammates and your rivals.

The core insight: doomscrolling is not a time-management problem. It's a social-emotional one. People scroll because they're bored, lonely, anxious, or simply acting on autopilot — and no chart showing you "you spent 3 hours on TikTok" has ever fixed that. What does work is other people. The threat of social visibility, the pull of shared identity, and the warmth of being interrupted by someone who cares — these are forces that willpower cannot compete with.

The redesign replaces every weak mechanism (self-monitoring, charts, guilt) with strong ones (live social presence, peer accountability, and a loop that's actually fun to participate in).

**The core loop:**
- You see friends getting sucked in → shame them → they get interrupted → they owe you a reaction
- You get shamed → you watch a friend's video → you feel seen and slightly embarrassed → you try harder
- Everyone's stats are public → competition drives behavior more than willpower ever could
- The group builds a shared identity around fighting doomscrolling together → identity is the strongest regulator of all

---

## Why This Works: The Behavioral Science

### Why existing screen time apps fail

1. **The information gap fallacy.** They assume you scroll because you don't know how much you scroll. You do know. Knowing doesn't help. Behavior change doesn't happen in the information layer.

2. **Willpower depletion.** They rely on individual willpower, which depletes across the day. By 11pm — exactly when you're scrolling — willpower is gone. Disciplines that require sustained willpower fail.

3. **No replacement behavior.** Taking away scrolling without replacing the underlying need (social stimulation, boredom relief, anxiety escape) leaves a vacuum. You find another outlet, or the habit returns.

4. **Shame without support.** Every interaction with a screen time app is the same message: "you failed." This creates shame-avoidance — people stop checking the app rather than change the behavior. The app becomes something to hide from, not engage with.

5. **No social component.** Humans have always regulated individual behavior through group dynamics, not private self-reflection. Every culture, religion, and community that has successfully changed behavior at scale has done it socially.

### Why this approach is different

**1. Replaces the need, not just the behavior.**
The urge to scroll is often a social urge — "what's happening?" — repurposed by algorithms. The live friends feed satisfies that urge directly with something more interesting: what your actual friends are doing, right now. You're not white-knuckling away from Instagram. You have somewhere better to look.

**2. Activates social instinct, not willpower.**
When your friends can see you, behavior regulation shifts from "I should stop" (willpower — weak, depletes) to "I don't want them to see me doing this" (social reputation — hardwired, doesn't deplete). This is the mechanism behind why people behave differently in public than in private, why athletes perform better with crowds, why AA works.

**3. The shame mechanic is loving, not punitive.**
The shamer is a friend who noticed, cared enough to pick up their phone, record a face, and send it. That's fundamentally different from an algorithm telling you you're failing. It's warm. It's funny. It creates connection rather than isolation. The embarrassment comes with a relationship attached, which makes it bearable — even enjoyable.

**4. The 30-second delay targets automaticity, not intention.**
The compulsive opens — the ones that matter — happen in under a second. Your thumb opens Instagram before your prefrontal cortex decided to. A 30-second gateway doesn't suppress the urge; it reintroduces conscious deliberation into an automatic behavior. This is exactly what behavioral therapists call "urge surfing." Over thousands of opens, the automatic response is gradually retrained. If you actually need Instagram for something, 30 seconds is nothing. If you're opening it for the 40th time on autopilot, 30 seconds is enough for your brain to catch up with your thumb.

**5. Gradual reduction, not prohibition.**
The gateway creates friction, not walls. It's not "you cannot scroll." It's "scrolling costs you 30 seconds, and your friends might find out." This is the difference between a crash diet (brittle, ends in relapse) and a sustainable habit (durable, compounds over time). Restriction breeds fixation; friction breeds reconsideration.

**6. The app becomes its own variable reward.**
The most dangerous feature of social media is the unpredictable reward schedule — the same mechanism as slot machines. Occasionally you find something amazing, so you keep pulling the lever. This redesign creates its own unpredictable rewards: will I get shamed today? What's on the wall of shame? Did the group complete this week's challenge? The app hijacks the dopamine loop in service of quitting.

**7. Builds intrinsic motivation over time.**
Week 1: you stop scrolling because your friends are watching. Week 4: you stop because you want to win. Week 8: you stop because "I'm someone who doesn't doomscroll" is part of your identity. The external accountability scaffolds the internal habit until the internal habit can stand alone. This is how every lasting behavior change works.

**8. Turns relapse into a social event.**
Private relapse → private shame → hide it → nothing changes. Public relapse → your friends see it → Alex has to explain the 4-hour Saturday TikTok session → it becomes a story → it gets processed, laughed about, learned from. Social processing of failure is therapeutic. Isolation of failure is not.

---

## The Shortcut Gateway — The Door to Every Doomscrolling App

### The fundamental change

Currently, Shortcuts are passive loggers — they record what already happened. The redesign makes the **Shortcut the actual door** to every tracked app. Nothing gets opened without passing through your backend first.

### The gateway decision tree

```
User taps "Instagram" (a Shortcut masquerading as the real icon)
    │
    ▼
GET /api/gateway?userId=X&app=instagram&token=SECRET
    │
    ├── Is user locked by a friend?
    │       → { action: "block", seconds: 45, lockedBy: "Alex", message: "..." }
    │
    ├── Is there a pending shame video?
    │       → { action: "shame_pending", videoUrl: "...", from: "Alex", shameId: "...", nextAction: "allow|delay|block" }
    │
    ├── Is it a blocked time window? (e.g., after 11pm)
    │       → { action: "block", message: "You set a quiet hour for this time" }
    │
    ├── Daily open limit exceeded?
    │       → { action: "delay", seconds: 60, opensToday: 14, limit: 10, message: "..." }
    │
    ├── Session time limit exceeded?
    │       → { action: "delay", seconds: 30, message: "..." }
    │
    └── Otherwise
            → { action: "allow" }
            → Shortcut logs open, opens Instagram
```

### Delay escalation — friction that grows with habit

The delay isn't static. It scales with how often you've opened the app today:

| Opens today | Gateway response |
|---|---|
| 1–5 | Allow immediately |
| 6–8 | 15-second wait + "Opening in 15s..." message |
| 9–12 | 30-second wait + group notification pending |
| 13–16 | 60-second wait + automatic group notification sent |
| 17+ | 60-second wait + auto-posted to Wall of Shame |

The Shortcut implements delays with a native `Wait` action — the backend just returns `{ seconds: 60 }` and the Shortcut handles it locally. No round-trip needed.

### The shame video in the Shortcut

When the gateway returns `shame_pending`, the Shortcut:

```
1. GET /api/shame/{shameId}/url → signed download URL
2. Get Contents of URL (video bytes)
3. Quick Look (video) → plays fullscreen, native iOS player
   [No skip possible — Quick Look plays through]
4. Wait 10 seconds (post-video cooling period)
5. POST /api/shame/{shameId}/watched (logs it, alerts shamer)
6. Proceed with original action (allow / delay / block)
```

iOS's built-in Quick Look action in Shortcuts plays video fullscreen with no skip button. It's a free, native shame delivery mechanism.

### What the backend controls remotely

| Control | Mechanism |
|---|---|
| Time-of-day blocks | User sets quiet hours; backend returns `block` during those windows |
| Daily open limits | Per-app `openLimit` in user settings; compared against `todayStats` |
| Session length limits | `timeLimit` in minutes per app; backend tracks active session duration |
| Friend-triggered lockout | Friends POST to `/api/lock`; sets `gatewayState.locked` for 60s |
| Shame video queue | Gateway checks `shameQueue` and returns `shame_pending` before any other action |
| Delay escalation | Backend computes opens-today from `todayStats` and returns graduated delay |
| Emergency lockout | Friends can trigger a "hard block" for 5 minutes (once per day per friend) |

### Shortcut setup — one iCloud link per app

Users don't build Shortcuts from scratch. Onboarding provides a tap-to-install iCloud link for each supported app (Instagram, TikTok, YouTube, X/Twitter). After install:

1. Add to home screen with the real app's icon and name
2. Move the real app to App Library
3. The Shortcut is now the only door

The close Shortcut is an iOS automation: "When [App] closes → POST /api/session/close." This runs automatically without user interaction.

---

## Home Screen — Live Friends Feed

The home screen is entirely reimagined. No more "your stats." The primary view is **what your friends are doing right now.**

### Layout

```
┌─────────────────────────────────────┐
│  ● LIVE NOW  3 scrolling            │
│                                     │
│  ┌───────────────────────────────┐  │
│  │  🟢 Alex                      │  │
│  │  Instagram  ·  31 mins        │  │
│  │  ███████████░░  78% of daily  │  │
│  │  opened 11 times today        │  │
│  │                  [SHAME 🔥]   │  │
│  └───────────────────────────────┘  │
│                                     │
│  ┌───────────────────────────────┐  │
│  │  🟢 Maria                     │  │
│  │  TikTok  ·  8 mins            │  │
│  │  ████░░░░░░░░  29% of daily   │  │
│  │  opened 4 times today         │  │
│  │                  [SHAME 🔥]   │  │
│  └───────────────────────────────┘  │
│                                     │
│  ┌───────────────────────────────┐  │
│  │  🟡 Jordan                    │  │
│  │  Instagram  ·  22 mins ago    │  │
│  │  ██░░░░░░░░░░  14% of daily   │  │
│  │  🔥 8-day streak              │  │
│  │               [👏 Nice streak]│  │
│  └───────────────────────────────┘  │
│                                     │
│  ┌───────────────────────────────┐  │
│  │  ⚫ Sam                       │  │
│  │  Clean  ·  5h 14m             │  │
│  │  ░░░░░░░░░░░░  0% today       │  │
│  │  🔥 22-day streak 👑          │  │
│  │              [Cheer on 🙌]    │  │
│  └───────────────────────────────┘  │
│                                     │
│  ─────────────  YOU  ─────────────  │
│  ┌───────────────────────────────┐  │
│  │  Instagram  ·  18 mins        │  │
│  │  █████░░░░░░░  41% of daily   │  │
│  │  opened 7 times today  🟡     │  │
│  └───────────────────────────────┘  │
└─────────────────────────────────────┘
```

### Status indicators

| Indicator | Meaning |
|---|---|
| 🟢 Green + pulsing | Currently in a tracked app (active open session) |
| 🟡 Yellow | Opened a tracked app in the last 30 minutes |
| ⚫ Grey | Clean for 1h+ |
| 🔥 Streak badge | Days under personal daily limit in a row |
| 👑 Crown | Currently #1 in the group this week |
| 🚨 Red border on card | This person has been shamed 3+ times today |

### Real-time updates

The home screen uses Firestore real-time listeners. Each friend's `currentSession` document is a live subscription — when Alex opens Instagram, his card updates within 1–2 seconds on everyone's screen. No polling. No refresh button. It just happens.

### The shame cooldown

Each friend can only be shamed once every 15 minutes. After shaming, the button becomes a countdown:

```
[SHAME 🔥]  →  tap  →  camera opens  →  record  →  send
                                                      ↓
                                              [⏳ 14:32]  counts down
                                                      ↓
                                              [SHAME 🔥]  available again
```

The shame is queued even if the friend isn't actively scrolling — it gets delivered on their next gateway check.

---

## The Shame Flow — Video Messages

### Sending a shame

1. Tap **SHAME** — camera opens immediately, no menus
2. Record up to **15 seconds** (hold to record, release to stop)
3. One-tap preview → **Send** or **Retake**
4. Video uploads to Firebase Storage in background
5. Shame document created in Firestore
6. Friend's Bark notification fires: *"Alex has something to say to you 👀"*
7. The friend's card in your home screen briefly flashes red

The friction of recording a face on camera is the right amount of friction. It's low enough to not stop you, high enough to make every shame intentional.

### Quick shame (no video)

Long-press SHAME for instant reactions — no camera required:

| Reaction | Effect |
|---|---|
| 😤 Disappointed | Animated emoji delivered to their shame queue |
| 🤦 Facepalm | Same |
| 👀 I'm watching you | Same + Bark notification with their current session time |
| 🚨 Emergency | Bark notification set to maximum volume, triggers home screen Shortcut immediately |

Emergency shame can only be used once per day per person.

### Receiving a shame

The gateway delivers it. Quick Look plays the video fullscreen. There's no skip button in the first 5 seconds (enforced by the `Wait 5` action before Quick Look completes). After the video:

- 10-second cooldown timer displays
- Then the original gateway action executes (allow, delay, or block)
- Shame marked as `watched` in Firestore
- Shamer gets: *"Maria watched your shame 👀"*

### The reaction receipt *(opt-in, fun feature)*

Users who enable this have their front camera record a 3-second clip automatically when a shame video starts playing. This reaction clip is sent back to the shamer as a receipt. You shame your friend, and 10 seconds later you get a video of their face realizing they got caught.

This is opt-in. It creates the funniest possible feedback loop.

---

## Notifications — Intelligent, Not Noisy

You don't get a notification every time a friend opens an app — that becomes wallpaper. Instead, notifications fire on meaningful triggers, with strict per-friend cooldowns.

### Shame opportunity alerts (you can shame someone)

| Trigger | Notification text |
|---|---|
| Friend hits 30-min continuous session | "Alex has been on TikTok for 30 mins 👀" |
| Friend hits 80% of their daily limit | "Maria is about to break her record 🚨" |
| Friend opens a tracked app after midnight | "Jordan is doomscrolling at 2am 💀" |
| Friend opens an app 10+ times in one day | "Alex has opened Instagram 10 times today 😬" |

**Cooldown:** You can receive one shame opportunity notification per friend **every 20 minutes**, per app. Hard cap of 5 shame opportunity notifications per hour across all friends (settings-adjustable).

### Status notifications (your own activity)

| Trigger | Notification text |
|---|---|
| You're being outperformed | "Maria has used Instagram less than you 3 days in a row" |
| You're about to break your streak | "You're 18 mins from breaking your 9-day streak" |
| You've already broken your streak | "Streak broken. Your friends will see this." |
| Friend completed a challenge you're losing | "Jordan just completed the week under 1h challenge. You're at 3h 14m." |

### Social notifications

| Trigger | Notification text |
|---|---|
| Your shame was watched | "Alex watched your shame 👁️" |
| Someone reacted to your shame receipt | (reaction video clip delivered) |
| Group milestone | "The group just hit 100 shames sent 🏆" |
| Wall of shame update | "Alex just got added to the wall 🚨" |
| Someone's streak breaks | "Maria just lost a 14-day streak. Send some support." |

---

## Fun Features

### Ghost Mode
Burn one streak day as currency to go invisible for 2 hours — your session data is hidden from the live feed. Friends see "Jordan is offline." Limited to once per week. Creates an interesting economy: your streak is now a resource, not just a score. Spending it feels costly. This also means the best strategy is to not scroll, not to ghost.

### SOS — Rescue Me
When you feel the urge coming and know you're about to spiral, hit SOS before you open anything. This sends a group notification: *"Alex needs rescuing 🆘."* Friends who respond can send a 5-second snap. Receiving any response triggers a 15-minute block on all tracked apps — giving the urge time to pass. This reframes asking for help as smart, not weak.

### Streak Wars
Challenge a specific friend to a head-to-head streak competition. Both accept, and for the next 7 days, whoever cracks first loses. Loser owes a custom stake recorded in-app (coffee, 20 pushups, whatever you agree on). Stakes are visible to the whole group. The social performance of betting on yourself creates commitment that willpower cannot.

### The Morning Pact
Every morning before 10am, the app asks: *"Today I will open [app] max ___ times."* You set a number. It's visible to your group all day. At midnight, the pact is marked kept (✅) or broken (💀) publicly. The act of stating an intention publicly — even a small one — dramatically increases follow-through (this is well-documented in behavioral research). The pact history is visible in your profile.

### Intent Logging at the Gateway
Before allowing access, the Shortcut can ask (every few opens, not every time): *"What are you here for?"* Free text answer, max 30 words. After a week of data, the backend sends back analysis: *"64% of the time you open Instagram, you write 'just checking.' You close within 2 minutes 78% of those times."* Seeing your own stated intentions reflected back is more confronting than any time chart.

### The Scroll Tax
When you exceed your daily limit, the gateway doesn't block you — it starts posting to the group. Every 5 minutes over your limit: *"Alex is now 35 minutes over their TikTok limit."* The updates keep coming as long as you stay over. The peer pressure escalates with the overrun. Being blocked creates resentment; being seen creates motivation.

### Monthly Awards
Auto-generated at month end, delivered as a push notification and pinned in the stats tab:

| Award | Criteria |
|---|---|
| 🏆 Iron Will | Fewest total opens across all apps |
| 😤 Town Sheriff | Most shames sent |
| 🔥 Untouchable | Longest streak |
| 👻 Ghost King | Most Ghost Mode uses (playful negative) |
| 🌅 Early Bird | Lowest scrolling before 10am |
| 🦉 Night Owl | Most sessions after midnight (comedic negative award) |
| 💀 Wall of Famer | Most Wall of Shame appearances |
| 🆘 Most Rescued | Most SOS calls sent (affectionate, not negative) |
| 🎯 Pact Keeper | Highest morning pact completion rate |

These are silly enough to be funny, meaningful enough to be motivating.

### Hall of Fame Shames
The best shame videos (voted on by the group with a like button) get preserved beyond the 7-day auto-delete into a **Hall of Fame**. The group builds lore and inside jokes over time. Knowing a great shame video might live forever raises the bar for shame quality and makes the whole thing more creative.

### Cooldown Challenge
Weekly opt-in group challenges with a collective target — e.g., "Everyone under 45 minutes on Instagram this Saturday." If the whole group completes it, everyone gets a badge and a group celebration notification. Collective rewards build shared identity more powerfully than individual competition alone. You're not just competing against each other; you're defending the group.

### Relapse Support Mode
When someone breaks a long streak (7+ days), the app reframes the notification: instead of just logging failure, it sends a support prompt to the group: *"Alex just broke a 14-day streak. Drop them a note."* Friends can send a quick emoji or voice note. The person who relapsed gets support in the moment they're most likely to spiral further. Failure becomes a group event, not a private shame spiral.

---

## Statistics Tab — The Leaderboard

### Group overview

```
┌───────────────────────────────────────┐
│  THIS WEEK  ·  May 5–11               │
│                                       │
│  👑 Sam      1h 48m avg / day         │
│  2nd Jordan  2h 12m avg / day         │
│  3rd YOU     3h 41m avg / day         │
│  4th Maria   3h 55m avg / day         │
│  5th Alex    4h 33m avg / day  🚨     │
│                                       │
│  Group average: 3h 13m                │
│  You are 28 mins above average        │
│  You beat Alex and Maria this week    │
└───────────────────────────────────────┘
```

### Per-app comparison

```
┌───────────────────────────────────────┐
│  INSTAGRAM  ·  This week              │
│                                       │
│  Sam     38m   ████░░░░░░░░  best 🏆  │
│  Jordan  51m   █████░░░░░░░           │
│  YOU     1h4m  ██████░░░░░░           │
│  Maria   1h22m ████████░░░░           │
│  Alex    2h7m  ████████████  worst    │
│                                       │
│  Avg: 1h 2m  ·  You: +2 mins above   │
└───────────────────────────────────────┘
```

### Streaks board

```
┌───────────────────────────────────────┐
│  STREAKS  ·  under personal daily max │
│                                       │
│  Sam    ████████████████████ 22d 👑🔥 │
│  Jordan ████████████ 12d 🔥           │
│  Maria  ████████ 8d                   │
│  YOU    █████ 5d                      │
│  Alex   █ 1d                          │
│                                       │
│  Shame sent  ·  this month            │
│  YOU    ████████████ 22               │
│  Maria  ████████ 15                   │
│  Sam    █████ 9                       │
│                                       │
│  Shame received  ·  this month        │
│  Alex   ████████████████████ 34 💀    │
│  YOU    ███████ 12                    │
└───────────────────────────────────────┘
```

### Your personal heatmap

```
┌───────────────────────────────────────┐
│  YOUR PATTERNS                        │
│                                       │
│       6am  10am  2pm   6pm   10pm     │
│  Mon   ░░   ░░   ██    ███   ████     │
│  Tue   ░░   ░░   ███   ██    ████     │
│  Wed   ░░   ░░   ░░    ██    █████    │
│  Thu   ░░   ░░   ██    ███   ███      │
│  Fri   ░░   ░░   ████  ███   █████    │
│  Sat   ░░   ████ ████  ████  ████     │
│  Sun   ░░   ████ ████  ████  █████    │
│                                       │
│  You scroll most: Sat afternoons      │
│  You scroll least: Weekday mornings   │
│                                       │
│  You beat the group average:          │
│  ✅ Before 10am every day             │
│  ✅ Tuesday evenings                  │
│                                       │
│  You lose to the group average:       │
│  ❌ Weekend afternoons                │
│  ❌ After 10pm                        │
└───────────────────────────────────────┘
```

### Intent analysis (if intent logging is enabled)

```
┌───────────────────────────────────────┐
│  WHAT YOU SAY YOU'RE LOOKING FOR      │
│                                       │
│  "just checking"     ████████ 64%     │
│  "specific post"     ████ 21%         │
│  "talking to someone"██ 9%            │
│  "news"              █ 6%             │
│                                       │
│  "just checking" sessions: avg 18min  │
│  "specific post" sessions: avg 3min   │
│                                       │
│  You find what you're looking for     │
│  12% of the time.                     │
└───────────────────────────────────────┘
```

---

## Wall of Shame

Visible to the whole group. Server-side only writes. No deletions.

```
┌───────────────────────────────────────┐
│  🏛️  WALL OF SHAME                    │
│                                       │
│  🚨  Alex opened Instagram 47 times   │
│      yesterday. Previous record: 31.  │
│      May 7, 2025                      │
│                                       │
│  🌙  Jordan was on TikTok at 3:14am   │
│      for 52 minutes                   │
│      May 6, 2025                      │
│                                       │
│  👻  YOU used Ghost Mode and then     │
│      scrolled for 2h anyway           │
│      May 5, 2025                      │
│                                       │
│  💀  Maria broke a 19-day streak      │
│      (Saturday afternoon)             │
│      May 4, 2025                      │
└───────────────────────────────────────┘
```

**Entries are auto-generated by the backend — no client can write to this collection directly.**

What gets auto-added:
- Daily open count personal records
- Sessions after midnight
- Bypassed shame videos (detected via session-without-gateway-open pattern)
- Ghost Mode used + still scrolled over limit
- Streak breaks after 7+ days
- Scroll Tax trigger (exceeded daily limit)
- Emergency shame received (logged with context)

---

## Backend Architecture

### Why this needs careful design

The gateway endpoint is called on every single tracked app open. With 10 users each opening 15 apps per day, that's 150 requests/day minimum — but it must respond in under 8 seconds or the Shortcut fails. This means the gateway cannot afford Firestore cold reads under high latency. Every other write pattern must be designed around not blocking the gateway.

### Firestore schema

```
users/{userId}
  ├── profile: { username, displayName, barkKey, avatarUrl, friendGroupId }
  ├── settings: { apps: ["instagram", "tiktok"], dailyLimits: {instagram: {opens: 10, minutes: 60}}, blockedHours: [{start: 22, end: 7}] }
  ├── gatewayState: { locked, lockedUntil, lockedBy, shameQueue: [{id, from, videoRef, createdAt}] }
  │   ↑ Single document — one Firestore read per gateway call
  ├── todayStats: { date, opens: {instagram: 7}, minutes: {instagram: 42}, lastUpdated }
  │   ↑ Updated on every session close — gateway reads this for escalation logic
  ├── currentSession: { appName, startTime, isActive, openCount }
  │   ↑ Friends subscribe to this in real-time for the live feed
  ├── sessions/{sessionId}: { appName, openTime, closeTime, openedViaGateway, shameDelivered }
  ├── streaks/{appName}: { current, longest, lastUpdated }
  └── intents/{sessionId}: { text, appName, timestamp }

groups/{groupId}
  ├── members: [userId, ...]
  ├── wallOfShame: [{type, userId, detail, timestamp, permanent}]
  ├── challenges/{challengeId}: { goal, startDate, endDate, participants, completions }
  └── streakWars/{warId}: { challenger, challenged, startDate, stakes, winnerId }

shames/{shameId}
  ├── from, to, videoRef, type (video|quick), reaction, createdAt, watchedAt, skipped
  └── reactionVideoRef (if opt-in reaction capture is enabled)

notificationCooldowns/{senderId_recipientId_app}
  └── lastSentAt
```

### API endpoints

| Endpoint | Runtime | Purpose |
|---|---|---|
| `GET /api/gateway` | **Edge** | App open — check lock, shame queue, limits. Must be <200ms. |
| `POST /api/session/open` | Serverless | Log app open (called by gateway after deciding allow) |
| `POST /api/session/close` | Serverless | Log app close, update todayStats, check bypass |
| `POST /api/shame/upload-url` | Serverless | Returns signed Firebase Storage upload URL |
| `POST /api/shame` | Serverless | Create shame record, trigger Bark to recipient |
| `POST /api/shame/:id/watched` | Serverless | Mark watched, trigger Bark receipt to shamer |
| `POST /api/shame/:id/skipped` | Serverless | Log bypass, auto-post to wall of shame |
| `POST /api/lock` | Serverless | Friend triggers lockout — writes to target's gatewayState |
| `POST /api/sos` | Serverless | SOS — notifies group, sets 15-min block on target's gatewayState |
| `GET /api/friends/live` | Serverless | Snapshot of all friends' currentSession (for initial load) |
| `GET /api/stats/group` | Serverless | Comparative stats, leaderboard, per-app breakdown |
| `POST /api/intent` | Serverless | Log intent text for a session |
| `POST /api/pact` | Serverless | Submit morning pact |
| `GET /api/awards/monthly` | Serverless | Compute and return monthly awards |

### Gateway endpoint — edge runtime requirements

The gateway MUST run as a Vercel **Edge Function**, not a serverless function. Reasons:

- Edge functions have no cold start (serverless can add 2–4s cold start, risking Shortcut timeout)
- Edge functions run globally close to users, reducing round-trip latency
- The gateway does minimal work: read 2 Firestore documents (`gatewayState` + `todayStats`), make a decision, return JSON

```js
// api/gateway.js — Vercel Edge Runtime
export const runtime = 'edge';

export default async function handler(req) {
  const { userId, app, token } = /* parse params */;

  // 1. Validate token (constant-time comparison)
  // 2. Read gatewayState + todayStats in parallel (Promise.all)
  // 3. Apply decision tree
  // 4. Return { action, ...params }
  // 5. Session open logging happens async — don't await it here
}
```

Firestore reads from Edge: use the Firestore REST API directly (no SDK), which works in Edge runtime. Two parallel REST GET calls per gateway request.

### Real-time presence — Firestore listeners

The home screen subscribes to each friend's `currentSession` document using Firestore's `onSnapshot`. With 10 friends:

- 10 persistent WebSocket-like connections (Firestore manages these efficiently)
- Each session change = 1 write + N reads (one per listener)
- With 5 friends online, 20 session events/day: 100 listener-triggered reads/day
- Well within Firestore free tier (50k reads/day)

When the app moves to background, unsubscribe listeners. Resubscribe on foreground.

### Bypass detection

The Shortcut close automation fires when the real Instagram app closes — regardless of how it was opened (Shortcut or App Library). This creates a detectable signal:

```
Close event arrives for a session
    → Look up the most recent open event for this user+app
    → If no open event in the last 10 minutes → bypass detected
    → Write to wallOfShame, log violation
```

This has edge cases (crashes, network failures) so wall of shame auto-posts for bypasses should note "possible bypass" rather than stating it as fact. The system is probabilistic, not deterministic — and users know that, which is enough of a deterrent.

### Video storage — staying within free tier

Firebase Storage free tier: 5GB storage, 1GB/day download.

- Shame videos: capped at 480p, 15s ≈ 3–5MB each
- With 10 users shaming ~3x/day: ~30 videos/day × 4MB = 120MB/day
- Auto-delete at 7 days: steady-state storage ≈ 840MB
- Hall of Fame preserved shames: capped at 20 total, counted against the 5GB

For download: each shame is watched once = ~4MB. 30 watches/day = 120MB/day. Well within 1GB limit.

Signed URLs expire after 15 minutes — clients can't share or re-download shame videos outside the app.

### Notification architecture — Bark + cooldown enforcement

Each user stores their Bark key in Firestore (`profile.barkKey`). Notifications are sent server-side only — the client never has direct access to another user's Bark key.

Before sending any shame opportunity notification, the backend checks `notificationCooldowns/{senderId}_{recipientId}_{app}`. If `lastSentAt` is within the cooldown window, the notification is dropped. This prevents the notification system from becoming spam.

Emergency shames bypass the cooldown but are rate-limited to once per day per sender-recipient pair.

### Security model

| Resource | Access control |
|---|---|
| Gateway | Request must include user's device token (stored in Firestore, set during onboarding) |
| Shame creation | Requires authenticated sender token |
| Shame video URLs | Signed URLs from backend, expire in 15 minutes, single-use |
| Wall of shame | Server-side writes only; clients have read access, no write |
| Friend's gatewayState | Writable only by the server via authenticated endpoints |
| Group stats | Readable by group members only; computed server-side |

---

## Onboarding — Setup as the Entry Ticket

No Shortcut setup = no gateway = no live presence = nothing to shame anyone about. Onboarding makes setup the price of admission.

### 5-step flow

**Step 1: Create your profile**
Username, display name, profile photo. Username is permanent and public within the group.

**Step 2: Invite friends — minimum 1 to proceed**
Share a deep link. The app won't let you past this step solo. The minimum-viable-group requirement is intentional: accountability requires at least one other person.

**Step 3: Choose your tracked apps**
Pick from Instagram, TikTok, YouTube, X, Snapchat, Reddit, BeReal. For each selected app, set your daily limits (opens and/or minutes). These are shown to your friends.

**Step 4: Install the gateway Shortcuts**
For each selected app, one tap to install from iCloud link. The app then shows a test button: "Tap here to confirm your Instagram Shortcut works." It calls the gateway and shows a success screen. Users can't proceed to step 5 without testing at least one Shortcut.

**Step 5: Set up your Bark key**
Paste your Bark device key (from the Bark app). Test it — the app sends a test notification. Without this, you won't receive shames or alerts.

**Step 6 (optional): Set quiet hours**
Choose times the gateway will block all tracked apps. Default suggestion: 11pm–7am.

---

## What Stays the Same

- Expo Go distribution — no Apple Developer account
- Firestore + Vercel serverless backend
- Bark for push notifications
- iOS Shortcuts for data collection and gateway
- Free tier throughout (Firestore, Vercel, Firebase Storage, Bark)
- React Native / Expo codebase

---

## Summary: The Behavior Change Argument

Before: *"Here are your stats. Feel bad. Try harder alone."*

After: *"Your friends can see you right now. They can interrupt you mid-scroll. You owe them a reaction. The group is watching. Your streak is a social object. Your failures are shared. Your wins are celebrated."*

The mechanism of change shifts from:

| Old mechanism | New mechanism |
|---|---|
| Self-awareness | Social visibility |
| Willpower | Reputation management |
| Private guilt | Shared accountability |
| Static charts | Live social feed |
| Cold turkey thinking | Graduated friction |
| Individual failure | Group support at relapse |
| Passive logging | Active gateway control |

The result isn't just less scrolling. It's a different relationship with scrolling — one where you've chosen, with your friends, to make it harder and funnier and more embarrassing to do mindlessly. That choice, made publicly and repeatedly, reshapes identity. Over time, "I'm someone who doomscrolls" becomes "we're the group that doesn't."

That's worth more than any timer.
