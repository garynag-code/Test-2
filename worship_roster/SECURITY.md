# Security overview

This document answers the practical question: **can installing this app make a
team member's phone vulnerable to external attacks?** Short answer: **no** — and
below is why, plus the hardening that's in place and what changes once we add a
shared backend.

## Does installing this put phones at risk? No.

This is a **web app**, not a native Android app. Whether opened in Chrome or
"installed" to the home screen as a PWA, it runs **inside the browser's
sandbox** with the same limits as any website:

- **No device access by default.** It cannot read files, contacts, SMS, the
  camera, other apps, or system settings. Those require explicit per-use Android
  permission prompts, and this app requests **none** of them (the only optional
  prompt is web notifications, which you approve and can revoke).
- **No native install, no elevated privileges.** "Add to Home screen" creates a
  shortcut that opens the same sandboxed page full-screen. It is not an APK, does
  not run outside the browser, and cannot escalate privileges.
- **No third-party code.** There are **zero external scripts, CDNs, trackers, or
  npm dependencies** — every file is served from your own origin. That removes
  the most common real-world attack path (a compromised third-party library or
  ad network). Nothing to supply-chain.
- **Data stays on the device.** State lives in the browser's `localStorage` for
  that origin; it is not shared with other apps or sites.

The realistic worst case for a static web app like this is a **cross-site
scripting (XSS)** bug — malicious text (e.g. a crafted song title) running as
code *inside the app's own sandbox*. It still couldn't touch the device, but we
defend against it anyway (below), so it can't even deface the app or read its
own storage improperly.

## Hardening in place

| Control | What it does |
|---|---|
| **Output escaping** | All user-entered text (names, song titles, keys) is HTML-escaped before display, so it can never become markup or script. Verified with an `<img onerror>` payload — it's stored and shown as plain text, no node is created. |
| **Content-Security-Policy** | `script-src 'self'` with **no `unsafe-inline`** — the browser refuses to execute any injected or inline script, neutralising XSS even if an escaping bug slipped through. `default-src 'self'`, `object-src 'none'`, `base-uri 'self'` lock the rest down. |
| **No inline scripts** | The service-worker registration was moved into `app.js` specifically so the strict `script-src 'self'` policy holds with no exceptions. |
| **URL encoding** | The chord-lookup link is built with `encodeURIComponent`, so a song title can't break out of the URL. |
| **Safe external links** | The only outbound link (chord search) uses `rel="noopener noreferrer"` and the page sets `referrer: no-referrer`, preventing tab-nabbing and URL leakage. |
| **HTTPS + upgrade-insecure-requests** | Served over TLS via GitHub Pages; any stray `http:` sub-request is auto-upgraded. |
| **Least privilege** | No login, no secrets, no permissions requested beyond optional notifications. |

## Recommended host headers (defense in depth)

A few controls can only be set as **HTTP response headers**, which GitHub Pages
can't customise. If/when the app is served from a host that can (Cloudflare
Pages, Netlify, Nginx, a CDN), add:

```
Content-Security-Policy: ...same as the meta tag... ; frame-ancestors 'none'
X-Content-Type-Options: nosniff
Referrer-Policy: no-referrer
Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
Permissions-Policy: camera=(), microphone=(), geolocation=(), interest-cohort=()
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Resource-Policy: same-origin
```

`frame-ancestors 'none'` (clickjacking protection) is header-only; it's noted
here because a `<meta>` tag can't deliver it.

## When we add the shared backend

Syncing one roster across phones and sending push reminders introduces a
**server**, which is where "commercial-grade security" work actually
concentrates. Note this still does **not** make phones more vulnerable — the
phone only ever makes HTTPS API calls; the new risk is server-side. The plan:

- **Transport:** HTTPS/TLS only, HSTS, no mixed content.
- **AuthN/Z:** per-team invite codes or magic-link/OAuth sign-in; every request
  authorised against the caller's team and role (leaders vs members) server-side
  — never trust the client.
- **Input validation & injection:** parameterised queries (no string-built SQL),
  strict schema validation on every endpoint, output encoding preserved.
- **Abuse controls:** rate limiting, request size caps, and CORS restricted to
  the app's own origin to blunt DoS and cross-site abuse.
- **Web Push:** VAPID keys and push subscriptions treated as secrets, stored in
  a managed secret store, never shipped to the client or committed to git.
- **Data at rest:** encrypted managed database; least-privilege DB credentials;
  automated backups.
- **Operations:** dependency scanning (Dependabot), pinned/locked dependencies,
  audit logging, and a documented patch cadence.

Preferring a **serverless / managed platform** (e.g. Cloudflare Workers +
managed KV/D1, or a managed Postgres backend) keeps the attack surface and
patching burden low, which is the pragmatic path to commercial-grade security
for a team of this size.

## Reporting

Found something? Open a private security advisory on the repository rather than
a public issue.
