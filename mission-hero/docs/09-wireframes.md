# Mission Hero — Initial UI Wireframes

Mobile-first. Every frame below is 390 px wide (the primary target). Tablet and desktop
widen the same components into 2- and 3-column grids; nothing is redesigned.

## K1 — Child home (`/kids/home`)

```
┌───────────────────────────────────────┐
│ ☰            MISSION HERO          🔔③│
│                                       │
│   ╭──────────────────────────────╮    │
│   │  ◐ 6     HEY JOSH!           │    │  ← level ring, animated fill
│   │          LEVEL 6 EXPLORER    │    │
│   │  🔥 7 DAY STREAK             │    │
│   ╰──────────────────────────────╯    │
│                                       │
│  ┌────────┐ ┌────────┐ ┌────────┐     │
│  │ ⚡1,850 │ │ ⭐ 320 │ │ ❤️  27 │     │  ← three systems, never merged
│  │   XP   │ │ POINTS │ │ STARS  │     │
│  └────────┘ └────────┘ └────────┘     │
│                                       │
│  NEXT WHEEL SPIN                      │
│  ████████████████░░░░   80 / 100      │
│                                       │
│  TODAY'S MISSIONS              3 left │
│  ┌───────────────────────────────┐    │
│  │ 🛏️  Make Bed          +5 XP   │    │
│  │                     ╭───────╮ │    │
│  │                     │ DONE! │ │    │  ← 56px tall, thumb-reachable
│  │                     ╰───────╯ │    │
│  ├───────────────────────────────┤    │
│  │ 📚  Read 20 Minutes  +15 XP   │    │
│  │                     ╭───────╮ │    │
│  │                     │ DONE! │ │    │
│  │                     ╰───────╯ │    │
│  ├───────────────────────────────┤    │
│  │ ✏️  Homework   +20 XP ⭐+10   │    │
│  │      ⏳ Waiting for Mom       │    │  ← pending, calm pulse, not a button
│  └───────────────────────────────┘    │
│                                       │
│  CHARACTER POWER                      │
│  What kind of hero were you today?    │
│  ( ❤️ Kind )( ⭐ Honest )( 💪 Brave )  │
│                                       │
│  WEEKLY QUEST        18 / 25          │
│  ██████████████░░░░░░                 │
│                          💎 ← hidden  │
│  SECRET OBJECTS   3 found this week   │
├───────────────────────────────────────┤
│  🏠 Home  🗺️ Map  ❤️ Me  🎁 Rewards   │
└───────────────────────────────────────┘
```

Notes: three separate counters make the three progression systems legible at a glance.
The pending card is visually distinct but not greyed-out-sad. The hidden object is drawn
at one of ~8 eligible anchor points chosen by a per-day seed.

## K2 — Mission complete celebration (overlay)

```
        ✨   MISSION COMPLETE!   ✨
              ╭──────────╮
              │    📚    │        ← task icon scales in
              ╰──────────╯
             Read 20 Minutes

            +10 XP      +5 ⭐

      "Proud of your effort." — Mom      ← parent's encouragement

        ██████████████░░░  Level 6
        140 XP to Level 7

              ╭──────────╮
              │  AWESOME │
              ╰──────────╯
```

Under `prefers-reduced-motion`, confetti is replaced by a single fade and the values
appear immediately.

## K3 — Character check-in (`/kids/character`)

```
┌───────────────────────────────────────┐
│ ←        CHARACTER POWER              │
│                                       │
│  What kind of person were you today?  │
│                                       │
│  ┌─────────────┐  ┌─────────────┐     │
│  │     ❤️      │  │     ⭐      │     │
│  │  I was kind │  │ I was honest│     │  ← cards lift + tilt on press
│  │    today    │  │    today    │     │
│  └─────────────┘  └─────────────┘     │
│  ┌─────────────┐  ┌─────────────┐     │
│  │     🤝      │  │     💪      │     │
│  │ I helped    │  │ I didn't    │     │
│  │  someone    │  │  give up    │     │
│  └─────────────┘  └─────────────┘     │
│         ▾ 11 more traits ▾            │
└───────────────────────────────────────┘
            ↓ after selecting
┌───────────────────────────────────────┐
│  ❤️  KINDNESS                          │
│  Awesome. Tell us what happened.      │
│  ┌───────────────────────────────┐    │
│  │ I helped my little brother    │    │
│  │ pack away his toys.           │    │
│  └───────────────────────────────┘    │
│   🎤 Record      📷 Photo   (if on)   │
│          ╭──────────────╮             │
│          │  SEND IT!    │             │
│          ╰──────────────╯             │
│     Mom or Dad will see this ✨        │
└───────────────────────────────────────┘
```

## K4 — Reward wheel (`/kids/wheel`)

```
┌───────────────────────────────────────┐
│ ←            REWARD WHEEL             │
│         YOU UNLOCKED A SPIN!          │
│                  ▼                    │
│            ╭───────────╮              │
│         ╱  │ 🍦 │ 🎬 │  ╲             │
│        │ 🎮 │       │ 🎁 │            │
│         ╲  │ 💰 │ 🍕 │  ╱             │
│            ╰───────────╯              │
│                                       │
│      Costs 100 points · You have 120  │
│          ╭──────────────╮             │
│          │    SPIN!     │             │
│          ╰──────────────╯             │
│   Next spin available tomorrow        │  ← plain fact, no pressure countdown
└───────────────────────────────────────┘
```

The wheel is given the server's `segmentIndex` before it starts turning. No
near-miss easing, no slot-machine sound, no coin rain (§42).

## K5 — Child profile / "Me" (`/kids/me`)

```
│  JOSH · LEVEL 8 EXPLORER              │
│  ╭────────╮                           │
│  │  🦸    │  ← avatar + equipped items │
│  ╰────────╯                           │
│                                       │
│  MY CHARACTER                         │
│  Perseverance  ██████████████  21     │
│  Kindness      ████████████    17     │
│  Gratitude     ██████████      14     │
│  Honesty       ████████        12     │
│  Helpfulness   ███████         10     │
│  Self Control  █████            8     │
│     "Let's grow this one." 💛         │  ← never a deficiency label
│                                       │
│  BADGES   🏅Kindness Hero (Silver)    │
│           🏅Never Give Up (Gold)      │
│           🔒Truth Teller · 3 to go    │
│                                       │
│  COLLECTION  🐉 🐧 🎩 ✨ 🔒 🔒        │
```

## P1 — Parent dashboard (`/parent`)

```
┌───────────────────────────────────────┐
│ MISSION HERO            Adventure Fam │
│                                       │
│  ⚠️  5 things need you                │
│  ┌───────────────────────────────┐    │
│  │ 3 missions waiting          → │    │
│  │ 1 character moment          → │    │
│  │ 1 memory verse              → │    │
│  └───────────────────────────────┘    │
│                                       │
│  CHILDREN                             │
│  ┌───────────────────────────────┐    │
│  │ 🦸 Josh    Lv 6 · 🔥7         │    │
│  │    This week  18/25  ███████░ │    │
│  │    ⚡1850  ⭐320  ❤️27         │    │
│  ├───────────────────────────────┤    │
│  │ 🦄 Sarah   Lv 3 · 🔥2         │    │
│  │    This week  11/20  █████░░░ │    │
│  │    ⚡640   ⭐95   ❤️12         │    │
│  └───────────────────────────────┘    │
│                                       │
│  QUICK ACTIONS                        │
│  [+ Task] [Approve] [+ Reward]        │
│  [Award Bonus] [+ Verse] [+ Mission]  │
│                                       │
│  RECENT                               │
│  • Josh completed Reading    2m ago   │
│  • Sarah unlocked a spin     1h ago   │
│  • Josh: Kindness confirmed  3h ago   │
└───────────────────────────────────────┘
```

## P2 — Approval queue (`/parent/approvals`)

```
│  [ Missions ③ ] [ Character ① ] [ Memory ① ]
│
│  ┌───────────────────────────────┐
│  │ 🦸 Josh · 📚 Read 20 Minutes  │
│  │ Submitted 4 minutes ago       │
│  │ "I read 2 chapters of Percy"  │
│  │ [ 📷 photo ]                  │
│  │ Worth: +10 XP  +5 points      │
│  │ ╭─────────╮ ╭──────╮ ╭──────╮ │
│  │ │ APPROVE │ │ ASK  │ │ REDO │ │
│  │ ╰─────────╯ ╰──────╯ ╰──────╯ │
│  └───────────────────────────────┘
│
│  ── approve sheet ──────────────────
│  Add a word of encouragement?
│  (Proud of you) (Great consistency)
│  (Well done for helping) [ free text ]
│  ╭─────────────────────────────────╮
│  │      APPROVE & AWARD            │
│  ╰─────────────────────────────────╯
```

## P3 — Character approval

```
│  🦸 Josh says he showed KINDNESS ❤️
│  "I helped Sarah clean her room."
│  Today, 4:12 pm
│
│  ╭─────────╮ ╭───────────╮ ╭────────╮
│  │ CONFIRM │ │ ASK ABOUT │ │ NOT    │
│  │  ⭐ +1  │ │    IT     │ │ THIS   │
│  ╰─────────╯ ╰───────────╯ ╰────────╯
│
│  Josh's Kindness: 16 → 17
│  3 more to Kindness Hero (Gold)
```

## Design tokens

| Token | Child surface | Parent surface |
| --- | --- | --- |
| Radius | 24px cards, 999px buttons | 12px |
| Type | Bold display for numbers, 18px body min | 15px body |
| Motion | spring, 250–400ms, confetti on award | 120ms fades only |
| Palette | per-theme gradient duo + white cards | neutral slate + one accent |
| Touch target | ≥ 56px | ≥ 44px |
| Status | icon + shape + colour (never colour alone) | same |

Accessibility constants that override everything: minimum 4.5:1 text contrast,
`prefers-reduced-motion` honoured, all icon-only controls carry `aria-label`,
and every state is distinguishable without colour.
