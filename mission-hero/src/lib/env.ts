import { z } from 'zod';

/**
 * Environment is validated at boot so a misconfigured deployment fails loudly
 * at start rather than at 2 a.m. in the middle of an approval (docs/03 §10).
 */
const schema = z.object({
  DATABASE_URL: z.string().url(),
  TEST_DATABASE_URL: z.string().url().optional(),
  AUTH_SECRET: z
    .string()
    .min(
      32,
      'AUTH_SECRET must be at least 32 characters — generate with `openssl rand -base64 48`',
    ),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_URL: z.string().url().default('http://localhost:3000'),
  MEDIA_UPLOADS_ENABLED: z
    .string()
    .optional()
    .transform((value) => value === 'true'),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

export function getEnv(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  cached = parsed.data;
  warnIfCookiesCannotSurvive(cached);
  return cached;
}

/**
 * Session cookies are `Secure` in production, and a browser silently discards
 * a `Secure` cookie sent over plain http.
 *
 * The failure has no symptom worth the name: the sign-in form posts, the
 * server sets a perfectly good cookie, the browser drops it, and the parent
 * lands back on the login page with nothing to read. Serving over http is a
 * reasonable thing to try on a home network, so say so at boot rather than
 * leaving someone to work it out from an empty cookie jar.
 *
 * `http://localhost` is exempt because browsers treat it as a secure context.
 */
function warnIfCookiesCannotSurvive(env: Env): void {
  if (env.NODE_ENV !== 'production') return;

  const { protocol, hostname } = new URL(env.APP_URL);
  if (protocol === 'https:') return;
  if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]') return;

  console.warn(
    `[mission-hero] APP_URL is ${env.APP_URL}, but session cookies are Secure in ` +
      'production and browsers discard those over plain http — sign-in will fail ' +
      'silently. Serve this behind HTTPS, or use `npm run dev` for testing on a ' +
      'phone over a local network.',
  );
}

export const isProduction = (): boolean => getEnv().NODE_ENV === 'production';
export const isTest = (): boolean => getEnv().NODE_ENV === 'test';
