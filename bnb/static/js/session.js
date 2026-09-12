/* Signing in, against Supabase Auth.
 *
 * Supabase's REST endpoints are used directly rather than its JavaScript SDK:
 * the SDK would be a CDN dependency on the critical path, and Perch is meant to
 * open on a phone with one bar of signal. This is about sixty lines instead.
 *
 * The access token is short-lived and the refresh token is what actually keeps
 * the owner signed in, so both are stored and the pair is renewed a little
 * before expiry rather than after a request has already failed.
 */

const KEY = 'perch.session.v1';
const RENEW_MARGIN_SECONDS = 60;

let config = { enabled: false, url: '', anon_key: '' };

export function configure(next) {
  config = { ...config, ...(next || {}) };
  return config;
}

export const isEnabled = () => Boolean(config.enabled);

function read() {
  try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; }
}

function write(session) {
  try {
    if (session) localStorage.setItem(KEY, JSON.stringify(session));
    else localStorage.removeItem(KEY);
  } catch { /* private browsing */ }
}

function store(payload) {
  if (!payload?.access_token) return null;
  const session = {
    access_token: payload.access_token,
    refresh_token: payload.refresh_token,
    // Absolute, so a device that sleeps for an hour doesn't think it has time left.
    expires_at: Date.now() + (Number(payload.expires_in || 3600) * 1000),
    email: payload.user?.email || null,
  };
  write(session);
  return session;
}

async function post(path, body) {
  const response = await fetch(`${config.url}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: config.anon_key },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error_description || payload.msg
      || payload.message || 'sign-in failed');
    error.status = response.status;
    throw error;
  }
  return payload;
}

export async function signIn(email, password) {
  return store(await post('/auth/v1/token?grant_type=password', { email, password }));
}

export async function signUp(email, password) {
  const payload = await post('/auth/v1/signup', { email, password });
  // With email confirmation switched on, Supabase returns a user but no
  // token — the owner has to click the link first.
  return { session: store(payload), needsConfirmation: !payload.access_token };
}

export function signOut() {
  write(null);
}

export function currentEmail() {
  return read()?.email || null;
}

/** A valid access token, renewed first if it is about to expire. */
export async function token() {
  if (!config.enabled) return null;
  const session = read();
  if (!session) return null;

  if (Date.now() < session.expires_at - RENEW_MARGIN_SECONDS * 1000) {
    return session.access_token;
  }
  if (!session.refresh_token) {
    write(null);
    return null;
  }
  try {
    const renewed = store(
      await post('/auth/v1/token?grant_type=refresh_token',
                 { refresh_token: session.refresh_token }));
    return renewed?.access_token || null;
  } catch (error) {
    // A refresh token is rejected for good (revoked, or the password
    // changed) — but a flat network is temporary, so don't sign the owner
    // out over it and lose their offline queue.
    if (error.status >= 400 && error.status < 500) write(null);
    return null;
  }
}

export const hasSession = () => Boolean(read());
