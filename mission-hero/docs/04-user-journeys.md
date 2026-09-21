# Mission Hero — Main User Journeys

## J1 — Parent onboarding (first run)

```
Landing (/)
  └─ "I'm a parent" → /parent/register
       email, password, display name
         └─ create User + Family + FamilyMember(OWNER) + FamilySetting
            + seed platform defaults into the family
              (7 character traits, 8 levels, starter achievements, starter badges)
         └─ → /parent/onboarding
              step 1  Family name + timezone
              step 2  Add a child   (nickname, age bracket, avatar, theme, optional PIN)
              step 3  Pick starter missions (a checklist of ~10 suggested tasks)
              step 4  Show the Family Code + "open this on your child's device"
         └─ → /parent  (dashboard)
```

Design note: onboarding must leave the family in a *playable* state. A parent who stops
after step 2 still has traits, levels and a check-in — the child surface is never empty.

## J2 — Child first login

```
Landing (/) → "I'm a hero" → /kids
  no mh_device cookie?  → Family Code screen (8 chars, big keypad)
                           → sets mh_device { familyId }
  → Profile picker: avatars, nicknames, current level ring
  → tap profile
       pinRequired? → 4–6 digit keypad (5 tries, then a friendly lockout screen)
  → sets mh_child { childId, familyId }
  → /kids/home
```

## J3 — Daily loop (the heart of the product)

```
/kids/home
  ┌ Greeting + level ring + streak flame + XP / Points / Stars counters
  ├ "Next wheel spin" progress bar
  ├ TODAY'S MISSIONS  (cards: icon, title, reward chips, big DONE button)
  ├ CHARACTER POWER   ("What kind of hero were you today?")
  ├ WEEKLY QUEST      (18 / 25)
  └ hidden object     (rendered at a per-day pseudo-random surface)

tap DONE
  → if evidenceType != NONE: evidence sheet (note / photo / voice)
  → POST completion  → occurrence becomes SUBMITTED
  → card flips to "Waiting for Mom" with a calm pending animation
  → parent notification enqueued
```

## J4 — Parent approval (Vertical Slice 1)

```
/parent  → "3 missions waiting"
  → /parent/approvals
      grouped by child, newest first, evidence inline
      row actions:  Approve ✓   Ask about it   Try again
      Approve opens a 1-tap sheet with optional encouragement chips
        ("Proud of your effort", "Great consistency", free text)
  → approveTaskCompletion() transaction:
        completion  PENDING → APPROVED
        + XpTransaction        (idempotencyKey xp:task_completion:<id>)
        + RewardPointsTransaction
        + CharacterStarTransaction (if the task carries a trait)
        + streak recompute
        + achievement evaluation
        + badge evaluation
        + notification to child
        + audit log
  → child's next load shows MISSION COMPLETE! celebration with the exact awards
```

## J5 — Character check-in (Vertical Slice 2)

```
/kids/character
  "What kind of hero were you today?"  → animated trait cards
  tap ❤️ I was kind today
  "Awesome. Tell us what happened."    → text (and voice/photo if the family allows)
  submit → CharacterSubmission PENDING → "Waiting for Dad"

/parent/approvals  (Character tab)
  "Josh says he showed kindness today."   + the story
  Confirm / Ask about it / Not this time / + encouragement
  Confirm → +1 Kindness star, trait total, badge thresholds, character streak, audit
  → child sees  KINDNESS POWER +1  ·  "You're becoming a Kindness Hero!"
```

The rejection copy is deliberate: **"Let's talk about this one"**, never "rejected".
A rejected character claim is a conversation prompt, not a punishment.

## J6 — Reward wheel (Vertical Slice 3)

```
child reaches the point threshold
  → /kids/home shows  YOU UNLOCKED A SPIN!
  → /kids/wheel
      wheel renders the parent's segments
      tap SPIN  → server: eligibility → deduct → weighted draw → persist RewardSpin
                → returns { segmentIndex, label, spinId }
      wheel animates to segmentIndex, confetti, celebration card
      refresh mid-animation → the persisted result is shown (no re-roll)
  → parent notified; if the reward needs fulfilling it appears in the parent's queue
```

## J7 — Reward store redemption

```
/kids/rewards → affordable rewards highlighted, others show "42 more points"
  tap Redeem → confirm sheet showing the cost and the new balance
  → transaction: FOR UPDATE on reward → inventory check → negative points row
                 → RewardRedemption (PENDING or FULFILLED per config)
  → parent queue if approval required
```

## J8 — Memory challenge

```
/kids/memory → assigned verses / quotes / affirmations
  READY TO RECITE → the text is hidden → type it from memory
  → MemorySubmission PENDING (the typed text is stored for the parent to read)
  → parent compares and approves → award once, ever, per child per challenge
```

## J9 — Secret mission discovery

```
a hidden object (chest / gem / rocket) is placed on one of ~8 eligible surfaces,
chosen by a per-child, per-day seed so it moves but is stable within a day
  tap it → SECRET MISSION FOUND!  (rarity-tinted reveal)
  → SecretMissionDiscovery row (unique per child+mission)
  → the mission joins today's missions with its own reward chips
```

## J10 — Parent weekly review

```
/parent/progress
  per-child: completion %, XP, points, stars by trait, streaks, overdue tasks
  character history: every confirmed moment, readable as a story of the week
  audit: every award, adjustment and settings change
```

## J11 — Family with two parents

A second adult is invited by email; the invite creates a `FamilyMember(PARENT)` on
acceptance. Either parent can approve anything; the approval records *which* parent
decided, and the child's celebration says "Mom approved your reading".

## J12 — Streak break (the empathy path)

```
child misses a day
  → next login: "New streak starts today. Let's go!" with the previous best shown
    as a target ("Your best is 12 days")
  → no red, no loss language, no interstitial guilt screen
```
