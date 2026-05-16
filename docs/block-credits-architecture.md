# Block Credits System — Architecture

## Overview

Block Credits are an in-game currency earned by winning challenges and spent to temporarily block a friend's access to social media. This document covers how credits are tracked, transferred, and spent — not the blocking mechanism itself.

**1 Block Credit = 1 minute of blocked access for a friend**

---

## Data Model (Firestore)

### `users/{userId}`
```
{
  blockCredits: number,          // current balance
  lifetimeCreditsEarned: number, // for leaderboard / stats
  lifetimeCreditsSpent: number
}
```

### `challenges/{challengeId}`
```
{
  type: "app" | "custom",
  title: string,
  description: string,
  metric: "screen_time" | "opens" | "streak_days",  // what is measured
  targetApp: string | null,      // null = all apps
  startDate: timestamp,
  endDate: timestamp,
  status: "pending" | "active" | "claimable" | "settled" | "cancelled",
  createdBy: userId,

  // For custom (friend bet) challenges only
  maxParticipants: number,       // open slots — challenge starts when filled
  stake: number,                 // same stake for all participants
  participants: [
    {
      userId: string,
      stake: number,             // credits escrowed
      result: "pending" | "won" | "lost",
      metricValue: number | null, // populated at settlement
      accepted: boolean          // always true (set on join)
    }
  ],
  totalPot: number,              // grows as participants join
  winner: userId | null,

  // For app challenges only
  goal: number | null,           // target metric value to beat
  rewardCredits: number | null   // credits awarded on completion
}
```

### `creditTransactions/{txId}`
```
{
  userId: string,
  type: "challenge_win" | "challenge_loss" | "weekly_reward" | "spend_block" | "refund",
  amount: number,                // positive = credit, negative = debit
  balanceBefore: number,
  balanceAfter: number,
  relatedChallengeId: string | null,
  relatedTargetUserId: string | null,  // who was blocked (for spend_block)
  timestamp: timestamp,
  note: string
}
```

### `friendships/{friendshipId}`
```
{
  users: [userId, userId],       // always sorted lexicographically
  status: "pending" | "active",
  createdAt: timestamp
}
```

---

## Backend Endpoints (Vercel Functions)

### Challenges

#### `POST /api/challenges/app`
Creates an app challenge (called manually by the developer, not a cron job).
- Generates a `challenges` doc with `type: "app"`
- Sets `goal` (target metric value to beat), `metric`, `rewardCredits`, `startDate`, `endDate`
- No stakes involved; open to all users

#### `POST /api/challenges/custom`
A user creates an open group challenge. No friend IDs required — the challenge is visible to any friend.
```json
{
  "title": "Who scrolls less this week?",
  "metric": "screen_time",
  "target_app": "Instagram",
  "end_date": "2026-05-22T23:59:59Z",
  "max_participants": 4,
  "stake": 20
}
```
- Creator is auto-joined and their stake escrowed immediately
- Challenge `status: "pending"` until all spots (`max_participants`) are filled
- Once full, status automatically flips to `"active"`

#### `POST /api/challenges/{challengeId}/join`
Any friend of the creator can join an open pending challenge.
- Validates challenge is `pending` and not yet full
- Escrows the `stake` amount from the joining user
- Appends user to `participants`; if `participants.length == maxParticipants`, sets `status = "active"`

#### `POST /api/challenges/{challengeId}/decline`
Cancels the challenge (creator only) and refunds all escrowed credits via `refund` transactions.

#### `POST /api/challenges/{challengeId}/claim`
Called by a user when they believe the challenge period has ended and they deserve a reward.
- Rejects if `endDate` has not passed yet (enforced server-side — client cannot spoof this)
- **For app challenges:** reads the user's usage data over the challenge window and checks whether they met the goal; awards `rewardCredits` if so; records a `challenge_win` or no-op if they failed
- **For friend bets:** reads usage data for all participants, determines winner, transfers pot to winner (`challenge_win`), losers already debited at escrow — idempotent, so only the first valid claim triggers settlement and all participants see the result
- Sets challenge `status: "settled"` after resolution
- Returns `{ result: "won" | "lost" | "already_settled", creditsAwarded: number }`

---

### Credits

#### `GET /api/credits/balance`
Returns current `blockCredits` for the authenticated user.

#### `GET /api/credits/transactions`
Returns paginated `creditTransactions` for the authenticated user.

#### `POST /api/credits/spend`
Spends credits to block a friend.
```json
{
  "targetUserId": "friendId",
  "minutes": 30
}
```
- Costs `minutes` credits (1 credit = 1 minute)
- Validates balance ≥ minutes
- Deducts from `blockCredits`, records `spend_block` transaction
- Returns `{ success: true, newBalance: number }` — the actual blocking action is handled separately

---

## Frontend — Challenges Page

Credit balance widget is persistent in the page header across all tabs. Tapping it opens the transaction history screen.

### Tab 1: App Challenges (default)
Curated challenges created by the app — the equivalent of weekly/seasonal goals.
- Active challenge card at the top: goal description, metric, progress bar, reward preview, time remaining
- "Upcoming" section: next scheduled challenges with reward amounts
- "Completed" section: past app challenges with credits earned
- No stakes involved — once `endDate` passes, a "Claim Reward" button appears on completed challenge cards
- Tapping it calls `/api/challenges/{challengeId}/claim`; the backend verifies the goal was met and awards credits
- Card updates to show "Claimed" or "Goal not met" based on the response

### Tab 2: Friend Challenges
Create and manage open group challenges.
- **"Open to Join"** section: pending challenges created by friends that the user hasn't joined yet — shows spots filled (e.g. "2/4") and a "Join (X credits)" button
- **"Waiting for Players"** section: challenges the user has joined but aren't full yet — shows remaining spots; creator sees a Cancel button
- **"Active"** section: challenges in progress; shows "Settle" button once `endDate` has passed (any participant can trigger)
- **"Settled"** section: resolved bets with won/lost badge in green/red
- "+" button to create a new challenge (no friend IDs needed — open lobby model)

**Create a Challenge Flow**
1. Tap "+" → enter title, choose metric and optional app
2. Set **Max Participants** (minimum 2, can be a group)
3. Set **Stake** (same for all players)
4. Pick end date: **Today / Tomorrow / This Week / Custom** (Custom shows a native date picker)
5. Confirm → creator's credits escrowed immediately, challenge is now visible to all friends in shared groups
6. Challenge activates automatically when all spots fill

### Tab 3: Active Challenges
A unified live view of everything currently in progress — both app challenges and accepted friend bets.
- Each card shows: title, metric, progress vs. target (or vs. opponent for bets), time remaining
- Friend bet cards show all participants and their current standing
- Tapping a card opens a detail view with full metric history for the challenge window
- Empty state: "No active challenges — start one from App Challenges or challenge a friend"

---

## Credit Economy — Balances and Incentives

| Event | Credits |
|---|---|
| Complete a weekly challenge | +50 |
| Win a 2-person friend bet | +opponent's stake |
| Lose a friend bet | -your stake (escrowed at creation) |
| Block a friend for 1 min | -1 |
| Signup bonus | +25 |

Escrow approach prevents users from betting credits they don't have. There is no way to earn credits outside of challenges — scarcity is intentional.

---

## Settlement Integrity

- Metric values are sourced from `usageSessions` documents written by Shortcuts automations — the same data used for the main dashboard
- Settlement is always computed server-side; clients trigger it but cannot influence the outcome
- All credit mutations are wrapped in Firestore transactions to prevent race conditions and double-spends
- Transaction log is append-only; no document is ever deleted

---

## Settlement Trigger Model

There are no cron jobs. Settlement is fully user-initiated:

- The backend enforces `endDate` — claims submitted before the end are rejected with a `400`
- For friend bets, any participant can trigger settlement once the period ends; the endpoint is idempotent (uses a Firestore transaction with a status check so concurrent claims are safe)
- For app challenges, each user claims independently — their result does not affect others
- A challenge moves to `status: "claimable"` client-side once the local clock passes `endDate` (purely a UI hint); authoritative enforcement is always server-side

---

## Security Rules (Firestore)

- Users can only read their own `creditTransactions`
- Users can read challenge docs they are a participant of
- No client can write to `users.blockCredits` directly — only backend functions via Admin SDK
- Credit mutations require server-side validation of balance before write

---

## Open Questions / Future Work

- Multi-winner splits (e.g., tie-breaking rules for custom bets)
- Group challenges with 3+ participants and proportional pot splits
- Credit gifting between friends
- Weekly leaderboard using `lifetimeCreditsEarned`
