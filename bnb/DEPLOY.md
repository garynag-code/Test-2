# Putting Perch online with Supabase

This is the step that lets you use Perch **from your phone**, from anywhere,
with your computer switched off.

You do not need to understand any of it to follow it. Roughly 30 minutes.

---

## What you're setting up, in plain terms

Right now Perch keeps your bookings in a file on your computer. Online, two
things change:

1. **Supabase holds your bookings** instead of that file. It's a company that
   rents out databases; the free plan is far more than a guesthouse needs.
2. **Supabase also handles the login**, so only you can see your guests.

Perch already knows how to do both. You're giving it three settings.

---

## Step 1 — Make a Supabase project

1. Go to **supabase.com** and sign up (free, no card).
2. Click **New project**.
   - **Name:** anything — "Perch".
   - **Database password:** click Generate, then **copy it somewhere safe now**.
     You cannot see it again, and you'll need it in Step 2.
   - **Region:** whichever is closest to you.
3. Wait a couple of minutes while it builds.

## Step 2 — Collect three settings

In your Supabase project, in the sidebar:

| Setting | Where to find it |
|---|---|
| **`DATABASE_URL`** | **Connect** (top bar) → **Connection string** → **URI**. Copy it, then replace `[YOUR-PASSWORD]` with the password from Step 1. |
| **`SUPABASE_URL`** | **Project Settings → API → Project URL**. Looks like `https://abcdefgh.supabase.co`. |
| **`SUPABASE_ANON_KEY`** | **Project Settings → API → Project API keys → `anon` `public`**. |

There's an optional fourth that makes sign-in checks instant instead of
requiring a call back to Supabase on each one:

| **`SUPABASE_JWT_SECRET`** | **Project Settings → API → JWT Settings → JWT Secret**. |
|---|---|

Perch works without it — it just asks Supabase to verify each sign-in instead.

> **Keep the database URL and the JWT secret private.** They're passwords. The
> `anon` key is designed to be public, so that one's fine to paste around.

## Step 3 — Put Perch on a host

Perch is an ordinary Python web app, so most hosts will take it. Whichever you
pick, you need to set these, using the values from Step 2:

```
DATABASE_URL=postgresql://postgres:YOURPASSWORD@db.abcdefgh.supabase.co:5432/postgres
SUPABASE_URL=https://abcdefgh.supabase.co
SUPABASE_ANON_KEY=eyJhbG...
SUPABASE_JWT_SECRET=your-jwt-secret        # optional
PERCH_SYNC_TOKEN=make-up-a-long-random-string
```

and tell the host to start it with:

```bash
python -m bnb --host 0.0.0.0 --port $PORT
```

Perch creates its own tables the first time it starts. There's nothing to run
by hand.

**A safety net worth knowing about:** if you set `--host 0.0.0.0` (which means
"let other devices reach this") *without* configuring a login, Perch refuses to
start and tells you why. It will not put your guests' names, emails and phone
numbers somewhere anyone can read them.

## Step 4 — Sign in

Open your new web address. You'll get a sign-in screen — click **Create one**,
use your own email, and pick a password.

Supabase emails you a confirmation link first (unless you turn that off under
**Authentication → Providers → Email**). Click it, then sign in.

Your account starts with three empty rooms called Room 1, 2 and 3, and no
bookings. Nothing is invented for you.

## Step 5 — Keep the channels syncing

This one is easy to miss and it matters. Perch only notices a new Airbnb
booking when something tells it to look. On your own computer that's you
pressing **↻**. Online, something needs to do it on a schedule.

Point any scheduler at this address, hourly:

```
POST  https://your-perch-address/api/cron/sync
Header:  X-Perch-Sync-Token: <the PERCH_SYNC_TOKEN you made up>
```

A free GitHub Actions workflow does this fine, as does any host's built-in
scheduler or a free uptime-checker.

This also keeps your Supabase project awake — free projects pause after a week
with no activity, and an hourly sync means that never happens.

## Step 6 — Put it on your phone

Open the address in your phone's browser, then **Add to Home Screen**. It gets
an icon and opens like a normal app, because it is one.

---

## What it costs

Nothing, on Supabase's free plan — 500MB of database, where a guesthouse's
entire booking history is a few megabytes. Hosting the app itself is typically
$0–5/month depending on who you choose.

## If something goes wrong

Visit `https://your-perch-address/healthz`. It answers with which database it's
using and whether the login is switched on, and it deliberately never shows any
password. That one line usually says what's misconfigured.

## Known gap

There's no screen yet for renaming rooms or setting your property's name,
timezone and currency — they're set from the defaults on first sign-in. That's
the next thing worth building.
