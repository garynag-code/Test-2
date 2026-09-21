# Mission Hero — Architecture Proposal

> **Big Goals. Small Wins. Awesome Kids.**

## 1. Purpose of this document

This is the architecture that the implementation follows. It is written before the
code, and the code is expected to match it. Where the implementation deviates, the
deviation is recorded in [§12 Decisions](#12-architecture-decisions-adrs).

## 2. Product shape in one paragraph

Mission Hero is a family-scoped, multi-tenant web application. A **family** is the
tenant boundary. Inside a family there are **parents** (full administrative control)
and **children** (a deliberately narrow, high-energy game surface). Children generate
*claims* — "I did my reading", "I was kind today", "I can recite this verse". Parents
*adjudicate* those claims. Only an adjudicated claim moves value: XP, Reward Points and
Character Stars are all written as **immutable ledger entries** by the server, inside a
database transaction, exactly once.

The single most important architectural invariant:

> **The client never creates value.** Every XP point, Reward Point, Character Star,
> wheel outcome and badge unlock is computed and persisted server-side, inside a
> transaction, guarded by an idempotency key.

## 3. High-level system diagram

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                                   CLIENTS                                    │
│                                                                              │
│   Child surface (/kids/*)              Parent surface (/parent/*)            │
│   - Mobile-first, animated             - Mobile-first, calm, dense           │
│   - Framer Motion, confetti            - Tables, approval queues, settings   │
│   - Reads only its own child context   - Reads only its own family context   │
└───────────────┬──────────────────────────────────────┬───────────────────────┘
                │ Server Actions / Route Handlers      │
                ▼                                      ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                        APPLICATION LAYER  (Next.js App Router)               │
│                                                                              │
│  app/(kid)/…   app/(parent)/…   app/api/…                                    │
│   • Rendering + form wiring ONLY. No business rules live here.               │
│   • Every entry point calls:  requireParent() | requireChild()               │
│   • Every mutation entry point parses input with a Zod schema first.         │
└───────────────┬──────────────────────────────────────────────────────────────┘
                ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                      AUTHORIZATION LAYER  (src/server/auth)                   │
│  • Resolves the caller from a signed cookie → ParentActor | ChildActor        │
│  • Produces an ActorContext { actorType, userId?, childId?, familyId }        │
│  • assertChildInFamily(), assertParentOfFamily(), assertSelfChild()           │
│  • familyId is NEVER accepted from the request body.                          │
└───────────────┬──────────────────────────────────────────────────────────────┘
                ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                         SERVICE LAYER  (src/features/*/service)               │
│  Pure-ish orchestration. Owns business rules, transactions, idempotency.      │
│  tasks · approvals · ledger · character · rewards · reward-wheel ·            │
│  check-ins · memory · secret-missions · streaks · achievements · audit        │
└───────────────┬──────────────────────────────────────────────────────────────┘
                ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                      REPOSITORY LAYER  (src/features/*/repo)                  │
│  The only place Prisma is called. Accepts a tx client so services compose.    │
└───────────────┬──────────────────────────────────────────────────────────────┘
                ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                        PostgreSQL  (Prisma migrations)                        │
│  Immutable ledgers · unique constraints as the last line of defence           │
└──────────────────────────────────────────────────────────────────────────────┘
```

## 4. Layering rules (enforced, not aspirational)

| Layer | May import | May **not** import |
| --- | --- | --- |
| `app/**` (pages, actions) | features' service API, schemas, UI components | `@prisma/client`, repositories |
| `src/features/*/service` | repositories, domain, other services, `src/server/*` | React, `next/*` UI |
| `src/features/*/repo` | `@prisma/client`, domain types | services |
| `src/domain/**` | nothing but types/constants | everything else |
| `src/components/**` | UI primitives, feature *types* | services, Prisma |

`src/domain` is deliberately dependency-free: it holds the *rules* (level curve, badge
thresholds, streak arithmetic, wheel weighting) as pure functions that can be unit
tested in microseconds with no database.

Practical consequence: **a page never computes XP**. It calls
`approvalService.approveTaskCompletion(...)` and renders whatever comes back.

## 5. The three value systems

Three independent ledgers, never merged, never mutated:

| System | Table | Spendable? | Can decrease? | Purpose |
| --- | --- | --- | --- | --- |
| **XP** | `XpTransaction` | No | No (`amount > 0` enforced) | Progress & levels |
| **Reward Points** | `RewardPointsTransaction` | Yes | Yes (negative entries) | Redemption & wheel |
| **Character Stars** | `CharacterStarTransaction` | **No** | No (`amount > 0` enforced) | Recognition of character |

Balances are always **derived** (`SUM(amount)`), never stored as an editable column.
A `ChildBalanceSnapshot` may later be added as a *cache* — it is never the source of
truth, and it is rebuilt from the ledger.

Lifetime XP = `SUM(XpTransaction.amount)` and, because XP entries may not be negative,
lifetime XP is monotonically non-decreasing by construction. This is a *database*
guarantee (`CHECK (amount > 0)`), not a code convention.

## 6. Idempotency — how "award exactly once" is guaranteed

Every ledger write carries an `idempotencyKey` with a **unique index per child per
ledger**. The key is derived deterministically from the thing that caused the award:

```
xp:task_completion:<taskCompletionId>
xp:daily_check_in:<childId>:<localDate>
xp:memory_submission:<memorySubmissionId>
star:character_submission:<characterSubmissionId>
points:wheel_spin_cost:<rewardSpinId>
points:redemption:<rewardRedemptionId>
```

The flow is: open transaction → re-read the source row `FOR UPDATE` → check its status
is still pending → flip status → insert ledger rows → commit. A duplicate request either
(a) loses the status check, or (b) hits the unique index. Both paths return the original
result rather than an error, so a double-tapped **Approve** button is harmless.

Duplicate protection therefore has three independent layers:

1. **Status transition guard** — `PENDING → APPROVED` only, checked inside the tx.
2. **Row lock** — `SELECT … FOR UPDATE` on the completion row prevents interleaving.
3. **Unique index** — the database refuses a second identical ledger key.

## 7. Request lifecycle for a value-moving action

`Parent taps "Approve"` →

1. **Server Action** `approveCompletionAction(formData)`
2. `requireParent()` → `ParentActor { userId, familyId }` from the signed session cookie
3. `approveCompletionSchema.parse(input)` — Zod, strips unknown keys (anti mass-assignment)
4. `approvalService.approveTaskCompletion({ actor, completionId, note })`
5. Inside `prisma.$transaction`:
   - load completion **joined through** `child.familyId` → 404 if it isn't this family (IDOR defence)
   - guard status
   - update completion → `APPROVED`
   - `ledgerService.award()` × N (XP / points / stars, each idempotent)
   - `streakService.recordActivity()`
   - `achievementService.evaluate()`
   - `badgeService.evaluate()`
   - `notificationService.enqueue()` for the child
   - `auditService.record()` with before/after snapshots
6. `revalidatePath()` and return a `CelebrationPayload` the child UI replays

If any step throws, the whole transaction rolls back — there is no state in which a
completion is approved but the XP was not written.

## 8. Authentication & session model

Two distinct session types, two distinct cookies, two distinct trust levels.

**Parent** — `mh_session`, httpOnly, SameSite=Lax, Secure in production, signed JWT
(`jose`, HS256, 30-day rolling). Email + password today (bcrypt, cost 12). The provider
interface (`src/server/auth/providers`) is shaped so Google / Apple / Microsoft OIDC
drop in without touching call sites.

**Child** — children have no email and no password. Access is a two-step, device-bound
flow:

1. **Device binding (once per device):** an adult enters the family's `Family Code`.
   This sets `mh_device`, a long-lived signed cookie carrying only `familyId`. It
   confers *no* authority — it only says "this device may show this family's profile
   picker".
2. **Profile + PIN:** the child taps their avatar; if `pinRequired`, a 4–6 digit PIN is
   verified (bcrypt, rate-limited, lockout after 5 failures). Success issues `mh_child`,
   a signed JWT carrying `{ childId, familyId }` with a shorter TTL.

A child session can never be upgraded to a parent session. All `/parent/**` routes call
`requireParent()`; there is no route where a `ChildActor` satisfies a parent check.

**Parent Gate** — re-entering parent administration from a shared device requires the
parent's password or a parent PIN if the last full authentication is older than the
configured window. Implemented as `requireFreshParent()` on settings/finance routes.

## 9. Server-side randomness (reward wheel)

The wheel is the one place a child could plausibly try to cheat, so it is the strictest
path in the system:

- The browser calls `spinWheelAction(wheelId)`. It sends **no** random value.
- The server re-checks eligibility (threshold, cooldown, spins-per-period, active flag)
  inside the transaction, deducts points if configured, draws a winner using
  `crypto.randomInt` over the cumulative weights, and **persists the `RewardSpin` row
  before returning**.
- The response contains the *index* of the winning segment. The animation is instructed
  to land there. The client cannot re-roll: a refresh mid-animation shows the persisted
  result, because the spin is already committed.
- Weights are integers; the draw is `randomInt(0, totalWeight)` and a running-sum scan,
  which is uniform and free of floating-point bias.

## 10. Scheduling & recurrence

Tasks are defined once with a `TaskSchedule` (RRULE-like but explicit columns:
`frequency`, `weekdays[]`, `monthDay`, `interval`, `startDate`, `endDate`, `dueTime`).
**Occurrences are not pre-materialised for all time.** Instead:

- `taskScheduleService.occurrencesFor(task, dateRange, timezone)` is a *pure function*
  that expands a schedule into dates. It is exhaustively unit tested.
- A `TaskOccurrence` row is materialised lazily the first time a given
  `(taskId, occurrenceDate)` is viewed or acted on, under a unique constraint. This keeps
  "what is due today" cheap to query and gives completions a stable thing to point at.

All date arithmetic uses the **family's timezone**, not the server's and not the
browser's. "One check-in per calendar day" means one per family-local day.

## 11. Non-functional targets

| Concern | Target | How |
| --- | --- | --- |
| First contentful paint (child dashboard, 4G) | < 1.5 s | Server Components, no client-side data waterfall, route-level streaming |
| Interaction feedback | < 100 ms | Optimistic *animation only*; value shown after server confirms |
| Correctness of balances | Exact, always | Derived from ledger; property-tested |
| Tenant isolation | Absolute | Every repo query filtered by `familyId` from the session |
| Accessibility | WCAG 2.1 AA | Semantic HTML, 44px targets, `prefers-reduced-motion`, non-colour status |
| Test signal | Critical paths green before new features | §8 test strategy |

## 12. Architecture decisions (ADRs)

**ADR-001 — Server Actions over a REST API for the MVP.**
Accepted. The client is the only consumer; Server Actions remove a serialization layer
and keep authorization adjacent to the mutation. A thin `/api/*` surface is retained for
things that genuinely need it (health, future native app). Revisit when a native client
ships (Phase 2).

**ADR-002 — Derived balances, immutable ledgers.**
Accepted. Storing a mutable `points` integer makes double-award bugs silent and
unrecoverable. Ledgers make them visible, auditable and repairable. Cost: a `SUM` per
read, mitigated by a covering index on `(childId)` and, if ever needed, a snapshot cache.

**ADR-003 — Custom child session rather than Auth.js for children.**
Accepted. Auth.js models *users with credentials*. Children deliberately have no email,
no recoverable password and a device-bound trust model. Forcing them into Auth.js would
mean creating shadow `User` rows for children, which increases the blast radius of an
auth bug and stores more child data than we want. Parents use the standard
email/password + OIDC-ready path; children use a narrow, purpose-built session. Both
resolve to the same `ActorContext` so downstream code sees one abstraction.

**ADR-004 — Character Stars are not spendable.**
Accepted, and enforced in the type system: `CharacterStarTransaction.amount` has a
`CHECK (amount > 0)` constraint and no service exposes a debit. This is a product ethics
decision (§6/§40 of the brief) encoded as a schema constraint so it cannot drift.

**ADR-005 — Lazy occurrence materialisation.**
Accepted. Pre-generating every occurrence of a daily task for years is unbounded write
amplification; generating nothing makes "what's due" an expensive scan. Lazy
materialisation under a unique constraint gets both.

**ADR-006 — Parent verification of character claims is the default.**
Accepted. A child clicking "I was kind" awards nothing. Only `CharacterApproval` writes
a star. A family may opt out per-child (`ChildSetting.characterAutoApprove`), which is an
explicit, audited settings change.
