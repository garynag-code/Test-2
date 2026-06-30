# Browser extractor

For ChatGPT accounts where **Settings → Data Controls** has **no "Export data"
button** — i.e. **ChatGPT Business and Team** workspaces, where OpenAI disables
self-serve export (the bulk Compliance export is Enterprise-only).

`extract-chatgpt.js` reads your conversations from your own logged-in browser
session — the same internal API the ChatGPT web app uses — and saves a
`conversations.json` in the exact shape the official export produces. You then
feed that file to the portal or CLI like any other export.

## How to run it

1. Open **[chatgpt.com](https://chatgpt.com)** (or chat.openai.com) and make sure
   you're logged in to the **workspace whose chats you want**. If you belong to
   several workspaces, switch to the right one first (top-left switcher).
2. Open DevTools: **F12** (or **Cmd/Ctrl+Shift+I**) → **Console** tab.
3. If the console warns that pasting is disabled, type `allow pasting` and press
   Enter.
4. Open `extract-chatgpt.js`, copy the whole file, paste it into the console, and
   press Enter.
5. Watch the progress logs. When it finishes it downloads **`conversations.json`**.
6. Upload that file to the portal (`python -m chatgpt_export.web`) or pass it to
   the CLI (`python -m chatgpt_export.cli conversations.json -o my_chats`).

## What it does / doesn't do

- **Reads only.** It fetches your conversation list and each conversation's
  messages, then saves them to your browser as a download. Nothing is uploaded
  anywhere.
- **Includes Project chats** (they're part of your normal conversation list). It
  also tries to tag each chat with its Project name; if that lookup fails, the
  chats still export — they just land under "Ungrouped".
- **Covers multiple workspaces/accounts** by enumerating your accounts and
  requesting each one's conversations.

## Caveats

- It uses ChatGPT's **internal, undocumented** API, which can change without
  notice. If a step fails, the console log names it — share that error and the
  script can be updated.
- Automated access to ChatGPT is a gray area in OpenAI's terms. This script is
  for exporting **your own data, read-only, from your own browser** (data
  portability). Use it on accounts and data you're authorised to access.
- Large histories take a while: the script paces its requests (a short delay per
  conversation) to avoid hammering the API.
