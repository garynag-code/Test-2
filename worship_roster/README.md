# 🎵 Worship Team Roster

A **mobile-friendly** web app for running a worship team: build the Sunday
roster, schedule monthly practices by **majority vote**, post the weekly song
list with **chords**, and drive a **reminder system** for leaders and musicians.

It is a zero-backend, single-page app — plain HTML/CSS/JavaScript with
`localStorage` persistence — so it runs on any phone and can be hosted as static
files (e.g. GitHub Pages) with no build step.

## Run it

Just open `index.html` in a browser, or serve the folder:

```bash
cd worship_roster
python3 -m http.server 8000     # then open http://localhost:8000
```

## 📱 Install on an Android device

The app is a **PWA** (progressive web app): it has a web manifest, a service
worker and icons, so Android Chrome will install it to the home screen and run
it **full-screen and offline**, like a native app. Pick whichever route suits
you — the first is easiest.

### Option A — GitHub Pages, then "Add to Home screen" (recommended, free)

A PWA installs only from **HTTPS** (or `localhost`), which GitHub Pages provides.

1. On GitHub: **repo → Settings → Pages → Build and deployment → Deploy from a
   branch**, choose this branch and the **root** folder, and Save.
2. Wait ~1 min, then on your **Android phone open Chrome** and go to:
   `https://<your-user>.github.io/<repo>/worship_roster/`
   (for this repo: `https://garynag-code.github.io/test-2/worship_roster/`).
3. Tap the **⋮ menu → Install app** (or **Add to Home screen**). It lands on
   your home screen with the music-note icon and opens full-screen. It keeps
   working with no signal after the first load.

### Option B — Same Wi-Fi, straight from your computer (quick test)

1. On a computer on the **same Wi-Fi**, run `python3 -m http.server 8000` inside
   `worship_roster/`.
2. Find that computer's LAN IP (`ipconfig` / `ip addr`), then on the phone open
   `http://<computer-ip>:8000/`.
   *Note:* plain-`http` over Wi-Fi runs the app but **won't install as a PWA**
   (Chrome requires HTTPS for that) — use Option A for the installable version.

### Option C — Build a real APK / Play Store bundle

Point **[PWABuilder](https://www.pwabuilder.com/)** at your GitHub Pages URL
from Option A and it generates a signed Android **APK/AAB** you can sideload or
publish. (The CLI equivalent is Google's **Bubblewrap** / Trusted Web Activity.)

> **Tip:** the app stores its data in the browser per device, so each team
> member installs their own copy. See *Notes & next steps* for sharing one live
> roster across the team.

## Features

The app covers the full brief across five thumb-friendly tabs:

- **📅 Roster** — every Sunday from **2 Jul – 31 Dec 2026**. Assign the eight
  fixed positions per service: Lead Worshipper, Bass, Drums, Guitar, Keyboard
  and three Backup Singers. Each person is only offered for the positions they
  play.
- **🗳️ Practices** — for every month, the team votes on **one weekday practice**
  (Tue–Thu candidates) and **one after-church practice** (Sunday candidates).
  Candidate dates are generated automatically; each member gets one vote per
  block. A **leader locks the majority winner** (a strict majority, more than
  half the team). **Once locked, the date is fixed** — the only way to change it
  is for a leader to **Call a new vote**, which clears the result and re-opens
  voting. This enforces the rule that a majority-chosen date can't be quietly
  changed.
- **🎸 Songs & Chords** — leaders post the monthly song list (title + key).
  Anyone can pull **chords** (opens an Ultimate Guitar lookup for the song) or
  tap **Remind** to schedule a practice reminder for the musicians.
- **🔔 Reminders** — a **weekly "post the song list" nudge for leaders, dated to
  the Wednesday before each Sunday service**, plus auto-generated practice and
  song-practice reminders. Grouped into Due today / Upcoming / Overdue / Done,
  with optional device notifications for anything due today (while the app is
  open).
- **👥 Team** — add/edit members, mark leaders, and set which positions each
  person plays. Removing a member cleans up their votes and assignments.

Use the **selector in the header** to switch which team member you're acting as —
that determines whose vote is cast and whether leader-only controls appear.

## How the rules map to the brief

| Requirement | Where it lives |
|---|---|
| Roster of bass, drums, guitar, keyboard, 3 backup singers, lead worshipper | **Roster** tab — the eight fixed positions |
| Schedule 2 Jul – 31 Dec 2026 | Season constant; Sundays & months generated automatically |
| One weekday + one after-church practice per month, by majority vote | **Practices** tab voting blocks |
| Locked date can't change without a new vote | `lockMajority` / `callNewVote` in `js/app.js` |
| Weekly Wednesday reminder for leaders to post the song list | `buildSeasonReminders` in `js/app.js` |
| Retrieve chords for selected songs | `chordsUrl` + **Chords** button |
| Remind musicians to practise the songs | `remindSongPractice` + **Remind** button |

## Files

```
worship_roster/
  index.html        # app shell, tab bar
  css/styles.css    # mobile-first styling
  js/app.js         # state, scheduling, voting, reminders, rendering
  README.md
```

## Notes & next steps

Reminders and votes live in the browser's `localStorage`, which is ideal for a
self-contained demo the whole team can each run. To make reminders **push to
phones when the app is closed** and to **share one live roster across the team**,
the same UI can be pointed at a small shared backend (the reminder/vote/roster
functions are already isolated for that) with a scheduled job that emails or
push-notifies leaders each Wednesday.
