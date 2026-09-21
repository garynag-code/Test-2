# Mission Hero — Data Model & ERD

Conventions applied to **every** table:

- `id` is a UUID (`@default(uuid())`).
- `createdAt` / `updatedAt` on every row.
- `deletedAt` (nullable) where content is authored and may need to disappear from the
  UI without destroying history — tasks, rewards, traits, challenges, missions,
  profiles. **Ledgers and audit logs are never soft-deleted and never updated.**
- Every child-owned row carries `childId`; every family-owned row carries `familyId`.
  This redundancy is deliberate: it lets every query filter on the tenant key directly
  rather than joining upward, which makes tenant isolation cheap and hard to forget.
- Status is an enum, never a free string.

## 1. Entity-relationship overview

```
                                   ┌──────────┐
                                   │   User   │  (parents/guardians only)
                                   └────┬─────┘
                                        │ 1
                                        │
                                   ┌────▼──────────┐
                            ┌──────│ FamilyMember  │──────┐
                            │      └───────────────┘      │
                            │ *                           │
                       ┌────▼─────┐                       │
                       │  Family  │───────────────────────┘
                       └────┬─────┘
        ┌───────────────────┼───────────────────┬────────────────────┐
        │                   │                   │                    │
 ┌──────▼──────┐     ┌──────▼──────┐     ┌──────▼───────┐    ┌───────▼────────┐
 │ChildProfile │     │    Task     │     │    Reward    │    │ CharacterTrait │
 └──────┬──────┘     └──────┬──────┘     └──────┬───────┘    └───────┬────────┘
        │                   │                   │                    │
        │            ┌──────▼────────┐   ┌──────▼──────────┐  ┌──────▼────────────┐
        │            │TaskAssignment │   │RewardRedemption │  │CharacterSubmission│
        │            │ TaskSchedule  │   └─────────────────┘  └──────┬────────────┘
        │            │TaskOccurrence │                               │
        │            └──────┬────────┘                        ┌──────▼──────────┐
        │                   │                                 │CharacterApproval│
        │            ┌──────▼────────┐                        └─────────────────┘
        │            │TaskCompletion │──┬──┐
        │            └──────┬────────┘  │  └──► TaskEvidence
        │                   │           └────► TaskApproval
        │                   │
        │   ┌───────────────┴──────────────────────────────────────┐
        │   │              LEDGERS (append-only)                   │
        ├──►│ XpTransaction · RewardPointsTransaction ·            │
        │   │ CharacterStarTransaction                             │
        │   └──────────────────────────────────────────────────────┘
        │
        ├──► DailyCheckIn                 ├──► Streak
        ├──► MemorySubmission ─► MemoryApproval
        ├──► SecretMissionDiscovery ─► SecretMissionSubmission
        ├──► AchievementUnlock            ├──► BadgeUnlock
        ├──► CharacterBadgeProgress       ├──► ChildCollectible
        ├──► ChildAvatarItem              ├──► RewardSpin
        ├──► ChildSetting                 └──► Notification
                                                    │
 Family ──► FamilySetting · AppSetting · AuditLog · RewardWheel ─► RewardWheelItem
                                       · MemoryChallenge · SecretMission · Theme
                                       · Achievement · Badge · CharacterBadge
                                       · Level · DigitalCollectible · AvatarItem
```

## 2. Identity & tenancy

### `User`
Parents/guardians only. `email` (citext, unique), `passwordHash`, `displayName`,
`emailVerifiedAt`, `lastLoginAt`, `status`.
No `User` row is ever created for a child (ADR-003).

### `Family`
`name`, `timezone` (IANA, drives every "calendar day" decision), `familyCode`
(unique, 8 chars, unambiguous alphabet — used for device binding), `locale`,
`currencyCode` (rewards like "R20 pocket money" are display-only strings plus an
optional amount).

### `FamilyMember`
Join table `User ↔ Family` with `role` (`OWNER | PARENT | GUARDIAN`) and `status`.
Unique on `(familyId, userId)`. **This table is the authorization root**: a parent's
access to anything is proven by an active `FamilyMember` row.

### `ParentProfile`
Per-family display preferences for a parent (nickname the kids see, avatar, notification
prefs). Separate from `User` so one adult in two families can present differently.

### `ChildProfile`
`familyId`, `nickname` (not legal name — §40), `ageBracket` (`AGE_6_8 | AGE_9_11 |
AGE_12_14`), `birthMonth`/`birthYear` (optional, month+year only — no full DOB),
`avatarKey`, `themeKey`, `pinHash` (nullable), `pinRequired`, `pinFailedAttempts`,
`pinLockedUntil`, `status`, `sortOrder`.
Unique on `(familyId, nickname)`.

## 3. Task domain

### `Task`
Template, not an instance. `familyId`, `title`, `description`, `categoryId`, `iconKey`,
`colorKey`, `xpValue`, `rewardPointsValue`, `characterTraitId?` + `characterStarValue`,
`difficulty` (`EASY | STANDARD | CHALLENGING | EPIC`), `evidenceType`
(`NONE | PHOTO | NOTE | VOICE | PARENT_CONFIRM`), `approvalRequired` (default `true`),
`streakEligible`, `isFamilyTask`, `active`, `notes`, `createdByUserId`, `deletedAt`.

`CHECK (xpValue >= 0 AND rewardPointsValue >= 0 AND characterStarValue >= 0)` and
`CHECK (xpValue + rewardPointsValue + characterStarValue > 0)` — a task must be worth
*something*.

### `TaskAssignment`
`taskId`, `childId`, `active`. Unique `(taskId, childId)`. A family task creates one
assignment per participating child, so per-child progress stays independent.

### `TaskSchedule`
One per task. `frequency` (`ONE_TIME | DAILY | WEEKDAYS | WEEKENDS | SELECTED_DAYS |
WEEKLY | MONTHLY | QUARTERLY | ANNUAL | CUSTOM`), `interval` (every *n* periods),
`weekdays` (int[] 0–6), `monthDay`, `month`, `startDate`, `endDate`, `dueTime`
(local time-of-day), `timezone` (inherited from family unless overridden).

### `TaskOccurrence`
A materialised due-date for a task/child. `taskId`, `childId`, `occurrenceDate` (a
**date**, in family-local terms), `dueAt` (timestamptz), `status`
(`OPEN | SUBMITTED | APPROVED | REJECTED | MISSED | SKIPPED`).
**Unique `(taskId, childId, occurrenceDate)`** — this constraint is what makes
"one completion per task per day" structurally true rather than hopefully true.

### `TaskCompletion`
The child's claim. `occurrenceId` (unique — one live claim per occurrence),
`taskId`, `childId`, `submittedAt`, `status` (`PENDING | APPROVED | REJECTED |
CANCELLED`), `childNote`, `resolvedAt`, `resolvedByUserId`.

### `TaskApproval`
The parent's verdict, one row per resolution attempt (a redo creates a new completion,
so history is preserved). `completionId`, `parentUserId`, `decision`
(`APPROVE | REJECT | REQUEST_REDO | ASK_QUESTION`), `encouragementMessage`,
`xpAwarded`, `pointsAwarded`, `starsAwarded`, `decidedAt`.

### `TaskEvidence`
`completionId`, `type` (`PHOTO | NOTE | VOICE`), `storageKey`, `mimeType`, `byteSize`,
`durationMs`, `textBody`, `uploadedAt`.
Media is only accepted when `FamilySetting.mediaUploadsEnabled` is true **and** the task
asks for it. Files live behind an authenticated, family-scoped route — never a public URL.

## 4. Ledgers (append-only)

Three structurally identical tables. Using `XpTransaction` as the template:

| Column | Notes |
| --- | --- |
| `id` | uuid |
| `childId` | indexed |
| `familyId` | denormalised for tenant-scoped queries |
| `amount` | **`CHECK (amount > 0)`** for XP and Stars; signed for Reward Points |
| `sourceType` | `TASK_COMPLETION | DAILY_CHECK_IN | MEMORY_SUBMISSION | CHARACTER_APPROVAL | SECRET_MISSION | BONUS_CHALLENGE | STREAK_MILESTONE | ACHIEVEMENT | WHEEL_SPIN | REWARD_REDEMPTION | MANUAL_ADJUSTMENT` |
| `sourceId` | uuid of the causing row (nullable for manual) |
| `traitId` | **Character Stars only** — which trait the star belongs to |
| `idempotencyKey` | **unique `(childId, idempotencyKey)`** |
| `awardedByUserId` | who caused it (parent for approvals, null for system) |
| `reason` | required for `MANUAL_ADJUSTMENT` |
| `description` | human-readable, shown in history |
| `createdAt` | |

`RewardPointsTransaction` additionally allows `amount < 0` and carries
`CHECK (amount <> 0)`. A redemption or wheel cost writes a single negative row; there is
no "update the balance" path anywhere in the codebase.

Derived reads:

```sql
-- balance
SELECT COALESCE(SUM(amount),0) FROM "RewardPointsTransaction" WHERE "childId" = $1;
-- lifetime xp (identical, because XP rows cannot be negative)
SELECT COALESCE(SUM(amount),0) FROM "XpTransaction" WHERE "childId" = $1;
-- stars per trait
SELECT "traitId", SUM(amount) FROM "CharacterStarTransaction"
 WHERE "childId" = $1 GROUP BY "traitId";
```

Indexes: `(childId, createdAt DESC)` for history, `(childId)` for the sum,
`(sourceType, sourceId)` for "what did this approval pay out?".

## 5. Character domain

### `CharacterTrait`
`familyId` (nullable ⇒ platform default, cloned into a family on creation), `key`,
`label`, `emoji`, `colorKey`, `description`, `promptText` ("I was kind today"),
`sortOrder`, `active`, `deletedAt`. Unique `(familyId, key)`.

### `CharacterSubmission`
The child's claim. `childId`, `traitId`, `localDate`, `story` (text), `mood`,
`evidenceId?`, `status` (`PENDING | APPROVED | REJECTED | QUESTION_ASKED`),
`submittedAt`. Index `(childId, localDate)`.

### `CharacterApproval`
`submissionId` (unique), `parentUserId`, `decision`, `encouragementMessage`,
`starsAwarded`, `xpAwarded`, `question`, `decidedAt`.

### `CharacterBadge` / `CharacterBadgeProgress`
`CharacterBadge`: `familyId?`, `traitId?`, `name` ("Kindness Hero"), `tier`
(`BRONZE | SILVER | GOLD | DIAMOND`), `threshold`, `iconKey`, `description`.
Unique `(familyId, traitId, tier)`.
`CharacterBadgeProgress`: `childId`, `badgeId`, `currentCount`, `unlockedAt`.
Unique `(childId, badgeId)` — unlock is idempotent.

## 6. Rewards

### `RewardCategory`, `Reward`
`Reward`: `familyId`, `name`, `description`, `type` (`EXPERIENCE | PHYSICAL |
PRIVILEGE | SCREEN_TIME | POCKET_MONEY | FOOD | PARENT_TIME | DIGITAL | CUSTOM`),
`iconKey`, `imageKey`, `pointsCost`, `inventoryQuantity` (null = unlimited),
`requiresParentApproval`, `active`, `expiresAt`, `deletedAt`.

### `RewardEligibility`
`rewardId`, `childId` — absence of rows means "all children".

### `RewardRedemption`
`rewardId`, `childId`, `pointsSpent`, `status` (`PENDING | FULFILLED | REJECTED |
CANCELLED`), `requestedAt`, `resolvedAt`, `resolvedByUserId`, `note`.
The points debit and the inventory decrement happen in **one** transaction with
`SELECT … FOR UPDATE` on the reward row, so two children cannot claim the last one.

### `RewardWheel`, `RewardWheelItem`, `RewardSpin`
`RewardWheel`: `familyId`, `name`, `pointThreshold`, `deductPoints`, `pointsCost`,
`spinsPerDay`, `spinsPerWeek`, `cooldownMinutes`, `active`.
`RewardWheelItem`: `wheelId`, `label`, `rewardId?`, `weight` (**int ≥ 1**), `iconKey`,
`colorKey`, `segmentIndex`, `active`, `maxWinsPerChild?`.
`RewardSpin`: `wheelId`, `childId`, `wheelItemId`, `segmentIndex`, `pointsSpent`,
`rngSeedHash`, `resultRevealedAt`, `createdAt`.
The spin row is written **before** the client animates. `segmentIndex` is what the
animation is told to land on.

## 7. Engagement

- **`DailyCheckIn`** — `childId`, `localDate`, `mood`, `goalText`, `gratitudeText`,
  `xpAwarded`, `pointsAwarded`. **Unique `(childId, localDate)`** — this single
  constraint is the whole defence against farming XP by reopening the app.
- **`MemoryChallenge`** — `familyId`, `title`, `category` (`BIBLE_VERSE | QUOTE |
  AFFIRMATION | FAMILY_SAYING | VOCABULARY | SCHOOL_FACT | CUSTOM`), `reference`,
  `bodyText`, `xpValue`, `rewardPointsValue`, `verificationType`
  (`TYPED | PARENT_CONFIRM | VOICE`), `startDate`, `endDate`, `active`.
  `MemoryChallengeAssignment` scopes it to children.
- **`MemorySubmission`** / **`MemoryApproval`** — same claim/adjudicate shape.
  Unique partial index on `(challengeId, childId)` where `status = 'APPROVED'` ⇒ a
  challenge pays out at most once per child.
- **`SecretMission`** — `familyId`, `title`, `instructions`, `rarity` (`COMMON | RARE |
  EPIC | LEGENDARY`), rewards, `hiddenObjectKey`, `availableFrom/To`, `active`.
- **`SecretMissionDiscovery`** — `childId`, `missionId`, `discoveredAt`,
  `hiddenObjectKey`, `surfaceKey` (where it was hidden). Unique `(childId, missionId)`.
- **`SecretMissionSubmission`** — claim + approval, mirroring tasks.

## 8. Progression

- **`Level`** — `familyId?`, `levelNumber`, `name` ("Explorer"), `minLifetimeXp`,
  `iconKey`, `unlocksCollectibleId?`. Unique `(familyId, levelNumber)`.
- **`Streak`** — `childId`, `kind` (`DAILY_CHECK_IN | ALL_DAILY_TASKS | TASK_GROUP |
  CHARACTER | MEMORY | CUSTOM`), `key`, `currentCount`, `longestCount`,
  `lastActivityDate`, `startedDate`. Unique `(childId, kind, key)`.
- **`Achievement`** / **`AchievementUnlock`** — `Achievement` carries a
  `ruleType` + `ruleConfig` (jsonb) evaluated by a registry of pure predicate functions.
  `AchievementUnlock` unique `(childId, achievementId)`.
- **`Badge`** / **`BadgeUnlock`** — general (non-character) badges, same shape.
- **`DigitalCollectible`** / **`ChildCollectible`** — pets, effects, backgrounds.
  `unlockRule` (jsonb): by level, achievement, star count, streak or secret mission —
  deliberately **not** only by spendable points (§20).
- **`Avatar`, `AvatarItem`, `ChildAvatarItem`** — slot-based (`HAT | CAPE | CROWN |
  HELMET | GLASSES | PET | BACKGROUND | TRAIL`), `equipped` boolean.
  Partial unique index on `(childId, slot)` where `equipped` ⇒ one item per slot.
- **`Theme`** — `key`, `label`, palette + decor manifest; a child picks one.

## 9. Settings, notifications, audit

- **`FamilySetting`** — one row per family: `mediaUploadsEnabled`, `voiceNotesEnabled`,
  `photoEvidenceEnabled`, `wheelEnabled`, `secretMissionsEnabled`,
  `hiddenObjectsEnabled`, `soundEnabled`, `parentGateTimeoutMinutes`,
  `checkInXp`, `checkInPoints`, `weeklyGoalTarget`, `characterVerificationRequired`.
- **`ChildSetting`** — per-child overrides: `pinRequired`, `themeKey`, `reducedMotion`,
  `characterAutoApprove`, `dailyTaskTarget`, `notificationsEnabled`.
- **`AppSetting`** — platform-level key/value (feature flags), no family scope.
- **`Notification`** — `familyId`, `recipientType` (`PARENT | CHILD`),
  `recipientUserId?`, `recipientChildId?`, `kind`, `title`, `body`, `deepLink`,
  `payload` jsonb, `readAt`, `createdAt`. Index `(recipientChildId, readAt)`.
- **`AuditLog`** — **append-only, never deleted**: `familyId`, `actorType`
  (`PARENT | CHILD | SYSTEM`), `actorUserId?`, `actorChildId?`, `action` (enum),
  `entityType`, `entityId`, `beforeValue` jsonb, `afterValue` jsonb, `reason`,
  `ipAddress` (nullable, only where meaningful), `userAgent`, `createdAt`.
  Index `(familyId, createdAt DESC)` and `(entityType, entityId)`.

## 10. Constraint summary — the invariants the database itself enforces

| Invariant | Mechanism |
| --- | --- |
| XP never decreases | `CHECK (amount > 0)` on `XpTransaction` |
| Character Stars never spent | `CHECK (amount > 0)` on `CharacterStarTransaction` |
| No double award | unique `(childId, idempotencyKey)` on all three ledgers |
| One check-in per day | unique `(childId, localDate)` on `DailyCheckIn` |
| One completion per occurrence | unique `occurrenceId` on `TaskCompletion` |
| One occurrence per task/child/day | unique `(taskId, childId, occurrenceDate)` |
| Memory challenge pays once | partial unique `(challengeId, childId) WHERE status='APPROVED'` |
| One approval per submission | unique `submissionId` on `CharacterApproval` / `MemoryApproval` |
| Badge unlocked once | unique `(childId, badgeId)` |
| One equipped item per slot | partial unique `(childId, slot) WHERE equipped` |
| Wheel weights are sane | `CHECK (weight >= 1)` |
| Family code collisions | unique on `Family.familyCode` |

Every one of these is also covered by an automated test that asserts the *behaviour*,
not just the constraint — see `docs/08-test-strategy.md`.
