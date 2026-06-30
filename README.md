# ChatGPT → Google Drive portal

Extract **all** your ChatGPT conversations — including chats inside **Projects**
— from an official data export, render them as clean Markdown, and import them
into **Google Drive**, organised one folder per Project.

Works with **ChatGPT Team** accounts (and Plus/Free). Use it two ways:

- **🖥️ Web portal** — a browser app: drag in your export, preview your chats,
  download a Markdown `.zip`, and one-click import to Google Drive.
- **⌨️ Command line** — the same engine as a scriptable CLI.

---

## Quick start (the portal)

```bash
git clone <this-repo>
cd <this-repo>
pip install -r requirements.txt

python -m chatgpt_export.web      # then open http://localhost:5000
```

Then in the browser:

1. **Upload** your ChatGPT export `.zip` (see Step 1 below to get it) — or click
   **Try the demo** to see it work instantly with sample chats.
2. **Preview** every chat, grouped by Project.
3. **Download** them as a Markdown `.zip`, and/or **Connect Google Drive** and
   import them straight into your Drive.

The portal runs entirely on your own machine. Your chats are never sent
anywhere except to Google Drive, and only when you click *Import*. Downloading
the `.zip` needs no Google setup at all; enabling the Drive button is described
under [Google Drive setup](#google-drive-setup).

---

## Why an export file (and not "just connect to my account")?

OpenAI does **not** provide a public API for reading your ChatGPT
conversations. The only supported, Terms-of-Service-safe way to get every chat
out — Project chats included — is the built-in **Data Export**. This tool
consumes that export, so it's reliable and doesn't risk your account.

---

## Step 1 — Export your data from ChatGPT

1. In ChatGPT, open **Settings → Data Controls → Export Data → Export**.
   - On a **Team** account each member exports their **own** chats this way.
     (A workspace owner can request a full workspace export via OpenAI support /
     the compliance API; that export uses the same `conversations.json` shape,
     so this tool handles it too.)
2. Wait for the email from OpenAI ("Your ChatGPT data export is ready") and
   download the `.zip`. The link expires after ~24 hours.
3. Keep the `.zip` — you'll upload it to the portal. It contains
   `conversations.json`, which includes your Project chats.

## Google Drive setup

Downloading your chats as a `.zip` needs **no** Google setup. To enable the
one-click Drive import, you create a free OAuth client once:

1. Go to the [Google Cloud Console](https://console.cloud.google.com/),
   create (or pick) a project.
2. **Enable the Google Drive API** for that project.
3. **APIs & Services → OAuth consent screen** → add your own Google account as a
   **Test user**.
4. **APIs & Services → Credentials → Create Credentials → OAuth client ID:**
   - **For the portal:** choose **Web application** and add the redirect URI
     shown on the portal's summary page (by default
     `http://localhost:5000/oauth2callback`). Download the JSON and save it as
     **`client_secrets.json`** next to the app, then restart the portal. The
     **Connect Google Drive** button will light up.
   - **For the CLI:** choose **Desktop app** instead and pass the downloaded
     JSON with `--client-secrets`.

The scope requested is `drive.file` — the app can only see and manage the files
**it creates**, never the rest of your Drive.

---

## Command-line interface (optional)

The same engine is available as a CLI if you prefer scripting.

```bash
pip install -r requirements.txt        # Python 3.9+

# Try it with sample data — no export or credentials needed:
python -m chatgpt_export.cli --demo -o my_chats

# Render your real export locally:
python -m chatgpt_export.cli /path/to/chatgpt-export.zip -o my_chats
```

This produces:

```
my_chats/
  <Project name>/
    <Chat title>.md
    <Chat title>.json
  Ungrouped/
    ...
```

You can pass the `.zip`, an already-extracted folder, or `conversations.json`
directly.

### Upload to Google Drive from the CLI

After completing [Google Drive setup](#google-drive-setup) with a **Desktop app**
client:

```bash
python -m chatgpt_export.cli /path/to/chatgpt-export.zip \
    --upload-drive \
    --client-secrets client_secrets.json
```

The first run opens a browser to authorise; the token is cached in `token.json`
so later runs are non-interactive. The tool creates a **`ChatGPT Export`**
folder in your Drive with one sub-folder per Project.

Useful flags:

| Flag | Purpose |
|------|---------|
| `--drive-folder NAME` | Rename the root Drive folder. |
| `--drive-parent ID` | Nest under an existing Drive folder / Shared Drive (the id from its URL). |
| `--no-local` | Upload only; don't write local files. |
| `--no-json` | Skip the per-chat `.json`, Markdown only. |
| `--token PATH` | Where to cache the OAuth token. |

The scope used is `drive.file`, so the tool can only see and manage the files
**it creates** — it cannot read the rest of your Drive.

### Headless / automated (service account)

```bash
export GOOGLE_APPLICATION_CREDENTIALS=service_account.json
python -m chatgpt_export.cli export.zip --upload-drive \
    --drive-parent <shared_drive_or_folder_id>
```

A service account has its own (small) storage, so point `--drive-parent` at a
Shared Drive — or a folder shared with the service account's email — that it can
write to.

---

## What gets extracted

- The **visible thread** of each conversation (follows ChatGPT's
  `current_node`; abandoned edit/regenerate branches are skipped).
- Hidden system prompts are dropped; user, assistant, and tool turns are kept.
- Content types handled: text, code blocks (with language), execution output,
  multimodal text (images noted as `[image attachment]`), and browsing/quote
  blocks. Unknown types degrade to best-effort text.
- Project grouping is read from the export when present; otherwise chats that
  used a custom GPT are grouped by GPT id, and the rest go to `Ungrouped`.

> **Note on Project names:** OpenAI's export format is undocumented and has
> changed over time. If a particular export doesn't label Projects in a way the
> parser recognises, those chats land in `Ungrouped`/`GPT …` rather than being
> lost. Open an issue with a (redacted) sample and the grouping keys can be
> extended.

## Privacy

Your chats are private. `.gitignore` already excludes export archives,
`conversations.json`, rendered output, and all credential/token files so they
are never committed. The tool runs locally and talks only to Google Drive when
you pass `--upload-drive`.

## Tests

```bash
pip install pytest
python -m pytest tests/ -q
```
