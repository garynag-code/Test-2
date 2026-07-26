/* Runtime configuration.
 *
 * Leave `apiBase` EMPTY to run the app fully local (per-device localStorage) —
 * this is the default and needs no server.
 *
 * To turn on the shared, multi-phone backend, deploy the Cloudflare Worker in
 * ../server (see server/README.md) and set:
 *   apiBase        -> your Worker URL, e.g. "https://worship-roster-api.you.workers.dev"
 *   vapidPublicKey -> the VAPID public key you generated (for push reminders)
 */
window.ROSTER_CONFIG = {
  apiBase: '',
  vapidPublicKey: '',
};
