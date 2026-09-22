# Testing Mission Hero by hand

Everything below runs against the seeded **Adventure Family**.

```bash
npm install
npm run db:migrate
npm run db:seed
npm run dev          # http://localhost:3000
```

The seed prints the credentials. In short:

| Who         | How to get in                                 |
| ----------- | --------------------------------------------- |
| Mom (owner) | `mom@adventure.family` / `MissionHero123!`    |
| Dad         | `dad@adventure.family` / `MissionHero123!`    |
| Josh (10)   | `/kids` → family code **ADVENTUR** → tap Josh |
| Sarah (7)   | same, tap Sarah                               |

Open the child surface in a private window so you can be a parent and a child
at the same time.

---

## 1. The daily loop — the thing to try first

1. As **Josh**, tap **DONE!** on _Make your bed_. The card becomes
   **Waiting for a grown-up**. Check the three counters at the top: nothing has
   moved. That is the point — a claim is not an award.
2. As **Mom**, go to **Approvals**. Josh's mission is waiting, worth +5 XP and
   +2 points. Tap **Approve**, pick an encouragement chip, then
   **Approve & award**.
3. Back as **Josh**, reload. The counters have moved by exactly what the parent
   saw, and the card reads **Done**.

**Try to break it:** tap **Approve & award** twice quickly. Josh is paid once.

---

## 2. Character — where a star comes from

1. As **Josh**: **Character** → _I was kind today_ → write what happened → **SEND IT!**
2. As **Mom**: **Approvals → Character**. You see the story, Josh's current
   kindness total, and how far the next badge is. Tap **Confirm ⭐ +1**.
3. As **Josh**: **Me**. Kindness is 1, and the copy reads
   _"4 more kindness moments to your next badge."_ — never a mark out of ten.

**Worth noticing:** the child cannot award themselves a star. Tapping the card
does nothing until an adult confirms it.

---

## 3. The reward wheel

Josh starts with 120 points; the wheel needs 100.

1. As **Josh**: **Wheel** → **SPIN!**
2. While it is spinning, reload the page. The result is already decided and
   stored — you see what was won, not a new spin.
3. Spin again: it refuses, because the wheel is one spin a day and the points
   are gone.

As **Sarah** (45 points) the wheel is locked and tells her how many more points
she needs.

---

## 4. Check-in, store, learning, quests

- **Check-in**: the prompt on Josh's home page. Do it, then reopen the app
  repeatedly — it pays once a day, no matter how often you look.
- **Rewards**: redeem _Ice cream_ (60 points). As Mom, **Rewards** → **Not this
  time**. Every point comes back.
- **Learn by heart**: tap **READY TO RECITE** on a verse — the text hides, and
  you type it from memory. As Mom you see both side by side and decide. The app
  does not grade a child's words.
- **Quests**: _Read 10 Extra Pages_ is a bonus challenge, open to anyone.
  Secret missions are hidden around the app — look for a small object on Josh's
  pages. It moves day to day, and refreshing will not conjure one.

---

## 5. Parent depth

- **Progress** — twelve weeks per child, character history, mission history,
  and every ledger entry. Award a bonus at the bottom; it insists on a reason.
- **History** — the audit log. Find the approval you made in step 1, with its
  before and after values.
- **Settings** — turn the wheel off and check it disappears from Josh's app.
  Turn media uploads off and note photo/voice cannot stay on above it.
- **Settings → Grown-ups** — create an invite link, open it in another private
  window, and join as a second parent. Use the link twice: the second time it
  is refused.
- **Settings → Your data** — download the JSON export. Search it for
  `passwordHash`: it is not there.

---

## 6. What to check if you are reviewing the security claims

| Claim                              | How to see it                                                                   |
| ---------------------------------- | ------------------------------------------------------------------------------- |
| A child cannot reach parent admin  | Signed in as Josh, type `/parent` in the address bar                            |
| "Not yours" looks like "not found" | Log in as a second family and open another family's URL                         |
| The client cannot set an amount    | Approve a mission with dev tools open — there is no amount field to tamper with |
| The wheel is decided server-side   | Spin with the network tab open: the response carries the result                 |
| No child PII                       | `/parent/settings` → export, or read `prisma/schema.prisma` for `ChildProfile`  |

---

## 7. Automated tests

```bash
npm run lint
npm run typecheck
npm run test:unit          # pure rules, no database
npm run test:integration   # services against real PostgreSQL
npm run test:e2e           # Playwright, a real browser at phone width
```

`test:integration` needs `TEST_DATABASE_URL` pointing at a **throwaway**
database: it truncates every table between tests.

See [`docs/08-test-strategy.md`](./docs/08-test-strategy.md) for what each tier
is for, and the README's _Status_ section for the current state of the
end-to-end suite.
