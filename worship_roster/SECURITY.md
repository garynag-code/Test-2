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

> **Note on `connect-src`.** In shared mode the page calls your Cloudflare
> Worker on another origin, so `connect-src` is `'self' https:` — it permits
> HTTPS API calls but still blocks cleartext and non-HTTP(S) schemes. Because
> `script-src` stays `'self'` with no inline allowance, an attacker can't inject
> script to abuse it, so this is a safe relaxation. For maximum strictness, pin
> it to your exact Worker origin (e.g. `connect-src 'self' https://worship-roster-api.you.workers.dev`).

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

## The shared backend (Cloudflare Worker + D1) — implemented

Shared mode adds a **server**, which is where "commercial-grade security" work
concentrates. It still does **not** make phones more vulnerable — the phone only
ever makes HTTPS API calls; the new surface is server-side, and it's addressed:

- **Transport:** HTTPS/TLS only (Cloudflare-managed), `upgrade-insecure-requests`,
  no mixed content.
- **AuthN/Z:** high-entropy per-team invite codes and 256-bit device tokens.
  Every request is authenticated and **scoped to the caller's team**; leader-only
  actions (lock, new-vote, songs) are enforced **server-side** — the client is
  never trusted. Verified by the test suite (a member's lock attempt returns 403;
  voting a locked block returns 409).
- **Credential storage:** invite codes and device tokens are stored **only as
  SHA-256 hashes**, so a database leak yields no usable credentials.
- **Injection:** all D1 access uses **parameterised prepared statements** — no
  string-built SQL. Every endpoint validates types, enums (positions, practice
  types), and date/month formats; names are sanitised and length-bounded.
- **Abuse controls:** strict **CORS allow-list** (never `*`; requests from
  other origins get 403), a request-size cap, and `no-store` responses.
  Cloudflare's platform provides TLS termination and DDoS protection; for
  per-endpoint rate limiting, add a Cloudflare Rate Limiting rule on the Worker
  route.
- **Web Push:** the VAPID **private key is a Worker secret** (`wrangler secret`),
  never shipped to clients or committed. Reminders are sent **payload-less** —
  no message content is transmitted or needs decrypting; the device simply
  prompts the user to open the app. The VAPID signing is unit-tested with a full
  sign-and-verify round-trip.
- **Least privilege / no third-party runtime code:** the Worker has no npm
  runtime dependencies; `wrangler` is a build-time dev tool only.

This serverless/managed design (Workers + D1) keeps the attack surface and
patching burden low — the pragmatic path to commercial-grade security for a team
of this size. Recommended next hardening: add a Cloudflare Rate Limiting rule and
enable Dependabot on the repo.

## Reporting

Found something? Open a private security advisory on the repository rather than
a public issue.
