# Mission Hero — Core Business Rules

Rules are numbered so tests and code comments can cite them (`// BR-14`).

## Value & ledgers

- **BR-1** No value is created outside the service layer. UI and API never compute awards.
- **BR-2** Every award is an append-only ledger row. Balances are `SUM(amount)`.
- **BR-3** XP rows and Character Star rows must be `> 0`. Lifetime XP is therefore
  monotonic; redeeming rewards cannot reduce it.
- **BR-4** Reward Point rows may be negative. Balance may never go below zero: a debit is
  rejected if `balance + amount < 0`, checked inside the transaction.
- **BR-5** Character Stars are never spendable. No debit path exists.
- **BR-6** Every award carries an idempotency key unique per `(childId, ledger)`.
  A repeated award is a no-op returning the original row.
- **BR-7** A manual adjustment requires a non-empty `reason` and is always audited.
  Manual adjustments may be negative **only** for Reward Points.

## Tasks

- **BR-8** A task must be worth at least one unit of something.
- **BR-9** A child may hold at most one non-cancelled completion per occurrence.
- **BR-10** Submitting a completion awards nothing. Value moves only on approval.
- **BR-11** Only a parent of the same family may approve. A child approving anything is
  an authorization failure, not a validation error.
- **BR-12** Approving a completion that is not `PENDING` is a no-op that returns the
  existing outcome (idempotent double-tap).
- **BR-13** Rejection awards nothing, sets `REJECTED`, and reopens the occurrence so the
  child may try again. Copy is encouraging, never punitive.
- **BR-14** `REQUEST_REDO` reopens the occurrence and clears the completion, preserving
  the original as history.
- **BR-15** If `Task.approvalRequired` is false, submission auto-approves through the
  _same_ service path — including ledger, streak, achievement and audit writes. There is
  no second, shortcut code path.
- **BR-16** Evidence is required at submission when the task demands it, and only if the
  family permits that media type.
- **BR-17** An occurrence whose `dueAt` has passed with no submission becomes `MISSED` on
  read. Missing a task never deducts anything.

## Recurrence

- **BR-18** Occurrence dates are computed in the **family's** timezone.
- **BR-19** `SELECTED_DAYS` uses ISO weekday numbers 0=Sunday … 6=Saturday.
- **BR-20** `WEEKDAYS` = Mon–Fri, `WEEKENDS` = Sat–Sun.
- **BR-21** A schedule never produces dates before `startDate` or after `endDate`.
- **BR-22** `MONTHLY` on day 31 falls back to the last day of shorter months.
- **BR-23** Occurrences materialise lazily and idempotently under
  `unique(taskId, childId, occurrenceDate)`.
- **BR-24** Deactivating a task stops future occurrences but preserves past ones.

## Daily check-in

- **BR-25** At most one check-in per child per **family-local calendar day**, enforced by
  a unique constraint — repeated app opens cannot farm it.
- **BR-26** Check-in rewards are configured per family and may be zero.
- **BR-27** Check-in advances the `DAILY_CHECK_IN` streak exactly once per day.

## Character

- **BR-28** A character submission awards nothing on its own (§7 of the brief).
- **BR-29** A parent confirmation awards exactly **one** star for that trait, unless the
  parent explicitly grants a bonus, which is a separate audited action.
- **BR-30** A second approval of the same submission is impossible
  (`unique(submissionId)`) and returns the original result.
- **BR-31** XP may accompany a star if the family enabled it; stars and XP are still two
  separate ledger rows with two separate keys.
- **BR-32** A child may submit multiple character moments per day; each is adjudicated
  independently. A per-day soft cap (default 5) prevents spam without shaming.
- **BR-33** `characterAutoApprove` may be enabled per child; it routes through the same
  approval service with `actor = system` and is recorded in the audit log.
- **BR-34** Character trait totals are never rendered as a mark, grade, or deficiency.
  Copy for a low total is "Let's grow this one."

## Weekly progress

- **BR-62** The weekly quest target is what is actually scheduled that week, not
  the family's goal. A bar a child cannot fill however hard they work is
  demotivating; the family goal is an aspiration for _configuring_ tasks, and is
  used only as a fallback when nothing is scheduled.
- **BR-63** A week counts as _perfect_ only once it has ended with every
  occurrence approved. Awarding "Perfect Week" mid-week would be unexplainable
  to the child who received it.
- **BR-64** "On track" is pro-rated against the days already finished, so Monday
  morning never reads as being behind.

## Badges, levels, achievements, streaks

- **BR-35** A badge tier unlocks the first time `confirmedCount >= threshold`; unlock is
  unique per `(childId, badgeId)` and never revoked.
- **BR-36** Level is derived from lifetime XP via the family's level table. Level never
  decreases.
- **BR-37** Achievements evaluate after every value-moving transaction, inside the same
  transaction, and unlock at most once.
- **BR-38** A streak increments when the qualifying activity happens on a day exactly one
  day after `lastActivityDate`; same-day activity is a no-op; a larger gap restarts at 1.
- **BR-39** `longestCount` is `max(longestCount, currentCount)` and never decreases.
- **BR-40** Breaking a streak produces no penalty and no negative copy.

## Rewards & wheel

- **BR-41** Redemption debits points atomically with the inventory decrement, both under
  a row lock.
- **BR-42** Redemption is rejected if the balance is insufficient, the reward is
  inactive/expired/out of stock, or the child is not eligible.
- **BR-43** A redemption requiring approval holds `PENDING`; **points are debited at
  request time** and refunded (a positive ledger row with its own key) if the parent
  rejects. This prevents a child from queuing more redemptions than they can afford.
- **BR-44** Wheel eligibility = `balance >= pointThreshold` **and** wheel active **and**
  within `spinsPerDay`/`spinsPerWeek` **and** past `cooldownMinutes`.
- **BR-45** The wheel outcome is drawn **server-side** with `crypto.randomInt` over
  integer weights and persisted **before** the response is returned.
- **BR-46** The client receives the winning `segmentIndex` and must land there. The result
  is never recomputed on the client and never re-drawn on replay.
- **BR-47** Points are deducted only if `deductPoints` is true, in the same transaction as
  the spin.
- **BR-48** A segment with `maxWinsPerChild` reached is excluded from the draw (weight 0)
  rather than re-rolled.

## Memory

- **BR-49** A memory challenge awards at most once per child, ever
  (partial unique index on approved submissions).
- **BR-50** Typed recitation is stored verbatim for the parent to compare; the app does
  not auto-grade text in v1.

## Secret missions & hidden objects

- **BR-65** A bonus challenge is a secret mission with `requiresDiscovery` off:
  listed openly, claimable without a discovery row, and awarded under the
  `BONUS_CHALLENGE` ledger source. One model, one submission path, one approval
  path.
- **BR-66** Declining a quest deletes the submission rather than marking it
  rejected, because `unique(childId, missionId)` would otherwise make a second
  attempt impossible. Declining a _recitation_ marks it rejected instead, since
  its uniqueness constraint only covers approved rows.
- **BR-67** Reciting again while an attempt is still waiting replaces it, so a
  parent never sees the same challenge twice in one queue.

- **BR-51** A hidden object's position is derived from
  `hash(childId, localDate, salt) % eligibleSurfaces` — it moves between days but is
  stable within a day, so it can't be farmed by refreshing.
- **BR-52** Discovery is unique per `(childId, missionId)`.
- **BR-53** Discovery itself awards nothing; completing the revealed mission does.
- **BR-54** Rarity affects presentation and reward size only. No purchase, no paid
  randomness, no loot-box framing (§42).

## Authorization

- **BR-55** `familyId` always comes from the session, never the request.
- **BR-56** A parent may act only within families where they hold an active membership.
- **BR-57** A child may read and write only their own child context.
- **BR-58** Unauthorised access to an existing resource returns 404, not 403.
- **BR-59** Every state change listed in §36 of the brief writes an `AuditLog` row.

## Copy & tone

- **BR-60** The child-facing string table may not contain "failed", "lost", "bad",
  "punish", or "you didn't". A unit test asserts this.
- **BR-61** Rejection copy names the parent and invites a retry:
  "Almost there. Dad asked you to try this one again."
