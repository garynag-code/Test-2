# Testing Mission Hero by hand

Everything below runs against the seeded **Adventure Family**.

**Start where you are:** on a computer, the next section gets it running
locally. With only a phone, skip to
[Testing from a phone with no computer](#testing-from-a-phone-with-no-computer),
which deploys it and hands you a web address. The walkthroughs further down
apply either way.

## Starting it up, on a computer

You need [Node.js 20 or newer](https://nodejs.org) and
[Docker Desktop](https://www.docker.com/products/docker-desktop/) — Docker only
to run PostgreSQL, so you do not have to install a database by hand.

```bash
cp .env.example .env
```

Open the new `.env` and replace the `AUTH_SECRET` line. It signs the session
cookies, so it must be at least 32 characters — any long string will do for
local testing:

```
AUTH_SECRET="local-testing-only-not-a-real-secret-0123456789"
```

Leave `DATABASE_URL` alone: it already matches the database the next command
starts. Then, from this folder:

```bash
docker compose -f docker-compose.dev.yml up -d   # PostgreSQL on port 5432
npm install                                      # ~2 minutes, once
npm run db:migrate                               # creates the schema
npm run db:seed                                  # the Adventure Family demo
npm run dev                                      # http://localhost:3000
```

Leave that last command running — it is the app. Stop it with `Ctrl+C`, and
stop the database with
`docker compose -f docker-compose.dev.yml down`. Your data survives both;
`npm run db:reset` is what wipes it back to the seed.

## Testing from a phone with no computer

The phone cannot run the app itself — it needs a database and a Node server. So
the app goes on the internet with a real `https://` address, and the phone just
opens it like any website. `render.yaml` at the **repository root** (not in
this folder — Render only looks at the root) describes the whole setup, so the
host builds it without you typing a single command.

Everything below happens in the phone's browser.

1. **Put this repository on GitHub** if it is not already, and sign in to
   [github.com](https://github.com) on the phone.
2. Go to [render.com](https://render.com) and sign up **with GitHub**.
3. **Blueprints** in the left-hand menu → **New Blueprint Instance**, choose
   this repository, and let it read `render.yaml`. (It is not under **New +**
   with the service types; a Blueprint creates several of those at once.)
4. It will ask for one value, **SEED_PARENT_PASSWORD**. Type a password you
   choose and write it down — that is the parent login. It has to be your own:
   the demo password is printed in this repository for anyone to read, and the
   app has no change-password screen yet.
5. **Apply**. The first build takes five to ten minutes. When it finishes,
   Render shows an address like `https://mission-hero.onrender.com`.
6. Open that address on the phone. Sign in as a parent with
   `mom@adventure.family` and the password from step 4, or tap through to the
   child side with the family code **ADVENTUR**.
7. Chrome menu → **Add to Home screen**. It installs as a real app: its own
   icon in the launcher, and it opens full screen without browser chrome.

### What the free tier costs you

|                                           |                                                                                                                                                     |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| The app sleeps after 15 minutes of no use | The next visit takes about a minute to wake. It is not broken                                                                                       |
| The free database expires after 30 days   | Fine for trying it out; a real family needs a paid database or another host                                                                         |
| The region is set to Frankfurt            | Closest Render offers to southern Africa. Change `region:` in the root `render.yaml` if you are elsewhere — the service and the database must match |

### Before you put anything real in it

That address is on the public internet, and anyone who has it can try to sign
in. While you are only testing:

- Keep the seeded Adventure Family. Do not add your own children's names,
  photos or anything you would not want a stranger to read.
- Use a password you do not use anywhere else.
- Delete the Render service when you are done testing.

The app's own privacy rules still hold — no child email or phone number, no
public profiles, nothing shared between families — but none of that is a reason
to trust a test deployment with a real child's details.

---

## Testing on an Android phone, with a computer

This is a phone app first, so it is worth seeing on one. You do not need to
publish anything — the phone can reach the dev server running on your computer,
as long as both are on the same Wi-Fi.

1. Start it the usual way: `npm run dev`.
2. Read the second line it prints:

   ```
   - Local:        http://localhost:3000
   - Network:      http://192.168.1.50:3000     ← this one
   ```

3. Type that **Network** address into Chrome on the phone. That is the whole
   trick: `localhost` on the phone means the phone itself, which is why it has
   to be the numbered address.
4. Chrome menu → **Add to Home screen** puts it one tap away, which is how a
   child would actually reach it.

Sign in on the phone as a child (family code **ADVENTUR**) and keep the parent
side open on your computer. That is the real shape of the product: the child
has the phone, the grown-up approves from somewhere else.

**Use `npm run dev` for this, not a production build.** Session cookies are
marked `Secure` in production, and browsers throw those away over plain
`http://` — so sign-in fails with no error at all: the form posts, the page
comes back, and you are still logged out. The app now warns about this at
startup, but the short version is that a production build wants HTTPS. In
development the cookies are not `Secure`, so everything works.

If the phone cannot load the page at all:

| What to check                                                                                                                                            |
| -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Both devices on the same Wi-Fi — not one on mobile data, and not a "guest" network, which usually blocks devices from seeing each other                  |
| Your computer's firewall. macOS and Windows both prompt the first time something listens on a port; if you dismissed it, allow Node through on port 3000 |
| The address is from **Network:**, not `localhost`                                                                                                        |

Two things are expected and harmless: code changes will not hot-reload on the
phone (refresh the page yourself), and the browser console shows an aborted
`_rsc` request or two, which is Next discarding a prefetch it no longer needs.

One thing is neither. Occasionally a **Create** button sticks on "Creating…"
and the new mission does not appear. It **was** saved — reload the page and it
is there. Do not create it a second time. This is a known open bug, written up
in [docs/08 §10](./docs/08-test-strategy.md).

---

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
