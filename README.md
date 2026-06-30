# ChatGPT → Claude exporter

Extract **all** your ChatGPT conversations — including chats inside **Projects**
— from an official data export and turn them into a single file you can
**import into Claude** (a Project's knowledge, or attached in a chat).

Works with **ChatGPT Team** accounts (and Plus/Free). No accounts to connect, no
API keys — everything runs on your own machine. Use it two ways:

- **🖥️ Web portal** — a browser app: drag in your export, preview your chats,
  download a Claude-ready file.
- **⌨️ Command line** — the same engine as a scriptable CLI.

---

## Quick start (the portal)

```bash
git clone <this-repo>
cd <this-repo>
pip install -r requirements.txt      # just Flask

python -m chatgpt_export.web          # then open http://localhost:5000
```

Then in the browser:

1. **Upload** your ChatGPT export `.zip` (see *Get your export* below) — or click
   **Try the demo** to see it work instantly with sample chats.
2. **Preview** every chat, grouped by Project.
3. **Download** either:
   - **One combined `.md`** — every chat in a single file (easiest to import), or
   - **A `.zip`** — one Markdown file per chat.

The portal runs entirely on your own machine; your chats are never uploaded
anywhere.

---

## Get your export from ChatGPT

1. In ChatGPT, open **Settings → Data Controls → Export Data → Export**.
   - On a **Team** account each member exports their **own** chats this way.
     (A workspace owner can request a full-workspace export via OpenAI support /
     the compliance API; it uses the same `conversations.json` shape, so this
     tool handles it too.)
2. Wait for the email from OpenAI ("Your ChatGPT data export is ready") and
   download the `.zip` (the link expires after ~24 hours).
3. Upload that `.zip` to the portal. It contains `conversations.json`, which
   includes your Project chats.

## Import into Claude

1. Open [claude.ai](https://claude.ai) and create (or open) a **Project**.
2. Add the combined **`chatgpt-chats-for-claude.md`** file to the project's
   **knowledge**. Claude can then answer questions across all your old chats.
   - Or just **attach the file in a normal chat** if you only need it once.
   - Prefer the `.zip` if you'd rather add chats as separate knowledge
     documents — unzip it first; Claude reads the individual `.md` files, not
     the zip itself.

> **Tip:** if a single combined file is too large for one upload, use the `.zip`
> and add the per-chat files (or per-Project folders) individually.

---

## Command-line interface (optional)

The same engine is available as a CLI if you prefer scripting. It needs **no
third-party packages at all**.

```bash
# Try it with sample data — no export needed:
python -m chatgpt_export.cli --demo -o my_chats

# Render your real export:
python -m chatgpt_export.cli /path/to/chatgpt-export.zip -o my_chats
```

This writes into `my_chats/`:

```
my_chats/
  chatgpt-chats-for-claude.md      <- the combined file to import into Claude
  <Project name>/
    <Chat title>.md
    <Chat title>.json
  Ungrouped/
    ...
```

You can pass the `.zip`, an already-extracted folder, or `conversations.json`
directly.

Useful flags:

| Flag | Purpose |
|------|---------|
| `--no-split` | Write only the single combined file, not per-chat files. |
| `--no-combined` | Skip the combined file (per-chat files only). |
| `--no-json` | Skip the per-chat `.json` sidecars. |
| `-o, --out-dir` | Output directory (default `chatgpt_export_output`). |

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

Your chats stay on your machine. `.gitignore` excludes export archives,
`conversations.json`, and rendered output so nothing private is committed.

## Tests

```bash
pip install pytest flask
python -m pytest tests/ -q
```
