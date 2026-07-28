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
  // Set this to your deployed Worker URL to turn on shared mode + push.
  // (Filled in after the first deploy — leave empty to stay in local mode.)
  apiBase: '',
  // Public VAPID key for Web Push (safe to expose; the private key is a server secret).
  vapidPublicKey: 'BOt8KohaLoHaf8hZzFMPsl2k8rTR-4kMEr1qbehp6KHv2ryMJvUxGDG5kxStW9bJJQae0FpYtHFbNX667Hocf_0',
};
