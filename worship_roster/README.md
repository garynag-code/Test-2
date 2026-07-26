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

Add it to your phone's home screen for an app-like, full-screen experience.

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
