/* ============================================================================
 * ChatGPT browser extractor  —  for accounts with no "Export data" button
 * (ChatGPT Business / Team workspaces, where self-serve export is disabled).
 *
 * It reads your conversations the same way the ChatGPT web app does — using
 * your own logged-in session — and saves a `conversations.json` in the exact
 * shape the official export uses, so you can upload it to the portal.
 *
 *  HOW TO USE
 *  ----------
 *  1. Open https://chatgpt.com  (or chat.openai.com) and make sure you're
 *     logged in to the workspace whose chats you want. If you have several
 *     workspaces, switch to the right one first (top-left switcher).
 *  2. Open DevTools:  F12  (or  Cmd/Ctrl+Shift+I)  →  "Console" tab.
 *  3. If the console shows a "pasting is disabled" warning, type  allow pasting
 *     and press Enter, then paste.
 *  4. Paste this entire file and press Enter. Watch the progress logs.
 *  5. When it finishes it downloads `conversations.json`. Upload that to the
 *     portal ( python -m chatgpt_export.web ) or pass it to the CLI.
 *
 *  NOTES
 *  -----
 *  - This uses ChatGPT's internal, undocumented API. It may break if OpenAI
 *    changes it; if a step fails, the console log says which one.
 *  - It only READS your own conversations. Nothing is sent anywhere except
 *    back to your own browser as a download.
 *  - Project chats are included automatically (they're part of your normal
 *    conversation list). The script also tries to label each chat with its
 *    Project name; if that lookup fails, those chats still export — they just
 *    land under "Ungrouped" in the portal.
 * ========================================================================== */

(async () => {
  "use strict";

  const TAG = "%c[chatgpt-export]";
  const STYLE = "color:#10a37f;font-weight:bold";
  const log = (...a) => console.log(TAG, STYLE, ...a);
  const warn = (...a) => console.warn(TAG, STYLE, ...a);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // Politeness delays so we don't hammer the API.
  const PAGE_DELAY = 350;   // between list pages
  const DETAIL_DELAY = 250; // between fetching each conversation's messages
  const PAGE_SIZE = 100;

  const origin = location.origin;

  // -- auth ------------------------------------------------------------------

  async function getAccessToken() {
    const r = await fetch(`${origin}/api/auth/session`, { credentials: "include" });
    if (!r.ok) {
      throw new Error(
        `Couldn't read your session (HTTP ${r.status}). Are you logged in to ChatGPT in this tab?`
      );
    }
    const j = await r.json();
    if (!j || !j.accessToken) {
      throw new Error("No access token in session — try reloading the page and logging in again.");
    }
    return j.accessToken;
  }

  function authHeaders(token, accountId) {
    const h = { Authorization: `Bearer ${token}` };
    // Workspace (Business/Team) chats live under a workspace account id; the
    // web app passes it via this header. Personal chats use no header / default.
    if (accountId && accountId !== "default") h["ChatGPT-Account-Id"] = accountId;
    return h;
  }

  // -- accounts (personal + each workspace) ----------------------------------

  async function getAccountIds(token) {
    const ids = new Set();
    try {
      const r = await fetch(`${origin}/backend-api/accounts/check/v4-2023-04-27`, {
        headers: authHeaders(token),
        credentials: "include",
      });
      if (r.ok) {
        const j = await r.json();
        const accounts = (j && (j.accounts || j.account_ordering)) || {};
        for (const key of Object.keys(accounts)) {
          const entry = accounts[key];
          const id =
            (entry && entry.account && entry.account.account_id) ||
            (typeof entry === "string" ? entry : null);
          if (id) ids.add(id);
        }
      }
    } catch (e) {
      warn("account lookup failed, falling back to default:", e.message);
    }
    if (ids.size === 0) ids.add("default");
    return [...ids];
  }

  // -- conversation listing --------------------------------------------------

  async function listConversations(token, accountId) {
    const metas = [];
    let offset = 0;
    while (true) {
      const url = `${origin}/backend-api/conversations?offset=${offset}&limit=${PAGE_SIZE}&order=updated`;
      const r = await fetch(url, { headers: authHeaders(token, accountId), credentials: "include" });
      if (!r.ok) {
        warn(`list page failed for account ${accountId} (HTTP ${r.status})`);
        break;
      }
      const j = await r.json();
      const items = (j && j.items) || [];
      metas.push(...items);
      const total = (j && typeof j.total === "number") ? j.total : null;
      if (items.length < PAGE_SIZE) break;
      if (total !== null && offset + PAGE_SIZE >= total) break;
      offset += PAGE_SIZE;
      await sleep(PAGE_DELAY);
    }
    return metas;
  }

  async function getConversationDetail(token, accountId, id) {
    const r = await fetch(`${origin}/backend-api/conversation/${id}`, {
      headers: authHeaders(token, accountId),
      credentials: "include",
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  }

  // -- best-effort Project (folder) name lookup ------------------------------
  // Maps conversation_id -> project name when the endpoints are available.
  // Any failure here is non-fatal: chats still export, just without a label.

  async function buildProjectMap(token, accountId) {
    const map = {};
    const candidates = [
      `${origin}/backend-api/gizmos/snorlax/sidebar`,
      `${origin}/backend-api/gizmos/snorlax/sidebar?conversations_per_gizmo=20`,
    ];
    let projects = [];
    for (const url of candidates) {
      try {
        const r = await fetch(url, { headers: authHeaders(token, accountId), credentials: "include" });
        if (!r.ok) continue;
        const j = await r.json();
        const items = (j && (j.items || j.gizmos)) || [];
        projects = items
          .map((it) => it.gizmo || it)
          .filter(Boolean)
          .map((g) => ({
            id: g.id || g.gizmo_id,
            name:
              (g.display && (g.display.name || g.display.title)) ||
              g.name ||
              g.title,
            convs: (g.conversations && (g.conversations.items || g.conversations)) || [],
          }))
          .filter((p) => p.id && p.name);
        if (projects.length) break;
      } catch (e) {
        /* try next candidate */
      }
    }

    for (const p of projects) {
      // Conversations already inlined in the sidebar response.
      for (const c of p.convs) {
        const cid = c.id || c.conversation_id;
        if (cid) map[cid] = p.name;
      }
      // Otherwise try to list the project's conversations directly.
      try {
        const r = await fetch(
          `${origin}/backend-api/gizmos/${p.id}/conversations?limit=100`,
          { headers: authHeaders(token, accountId), credentials: "include" }
        );
        if (r.ok) {
          const j = await r.json();
          for (const c of (j.items || [])) {
            const cid = c.id || c.conversation_id;
            if (cid) map[cid] = p.name;
          }
        }
      } catch (e) {
        /* non-fatal */
      }
      await sleep(150);
    }
    return map;
  }

  // -- save ------------------------------------------------------------------

  function download(filename, text) {
    const blob = new Blob([text], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  // -- main ------------------------------------------------------------------

  try {
    log("Starting. Reading your session…");
    const token = await getAccessToken();
    const accountIds = await getAccountIds(token);
    log(`Found ${accountIds.length} account(s):`, accountIds);

    const all = [];
    const seen = new Set();

    for (const accountId of accountIds) {
      log(`Listing conversations for account ${accountId}…`);
      let projectMap = {};
      try {
        projectMap = await buildProjectMap(token, accountId);
        const labelled = Object.keys(projectMap).length;
        if (labelled) log(`  matched ${labelled} chat(s) to Projects`);
      } catch (e) {
        warn("  project labelling skipped:", e.message);
      }

      const metas = await listConversations(token, accountId);
      log(`  ${metas.length} conversation(s) to fetch`);

      for (let i = 0; i < metas.length; i++) {
        const m = metas[i];
        const id = m.id || m.conversation_id;
        if (!id || seen.has(id)) continue;
        seen.add(id);
        try {
          const detail = await getConversationDetail(token, accountId, id);
          detail.id = id;
          detail.conversation_id = id;
          if (m.title && !detail.title) detail.title = m.title;
          if (m.create_time && !detail.create_time) detail.create_time = m.create_time;
          if (m.update_time && !detail.update_time) detail.update_time = m.update_time;
          if (projectMap[id]) detail.project_name = projectMap[id];
          all.push(detail);
        } catch (e) {
          warn(`  skipped ${id}: ${e.message}`);
        }
        if ((i + 1) % 10 === 0 || i === metas.length - 1) {
          log(`  …${i + 1}/${metas.length}`);
        }
        await sleep(DETAIL_DELAY);
      }
    }

    if (all.length === 0) {
      throw new Error(
        "No conversations were retrieved. The API shape may have changed, or this account has no chats."
      );
    }

    log(`Done — ${all.length} conversation(s). Saving conversations.json…`);
    download("conversations.json", JSON.stringify(all));
    log("Saved. Upload conversations.json to the portal to finish.");
  } catch (err) {
    console.error(TAG, STYLE, "Failed:", err);
    warn(
      "If this keeps failing, copy the red error above and share it — the internal API may have changed."
    );
  }
})();
