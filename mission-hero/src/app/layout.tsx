import type { Metadata, Viewport } from 'next';
import { APP_NAME, APP_TAGLINE } from '@/domain/constants';
import './globals.css';

export const metadata: Metadata = {
  title: { default: APP_NAME, template: `%s · ${APP_NAME}` },
  description: APP_TAGLINE,
  applicationName: APP_NAME,
  // Nothing in this product is meant to be indexed or shared publicly (§40).
  robots: { index: false, follow: false },
};

/*
 * Nothing here may be prerendered.
 *
 * The CSP carries a per-request nonce and `'strict-dynamic'`, which makes a
 * browser ignore `'self'` and refuse every script that does not carry the
 * nonce from *that response's* header. A page built at build time has script
 * tags stamped with a nonce that no longer exists, so the whole page loads and
 * then sits there: no hydration, forms falling back to plain posts that the
 * server does not recognise as actions, and no error anywhere to explain it.
 *
 * Four routes were being prerendered — `/`, `/parent/login`,
 * `/parent/register` and `/_not-found` — and the sign-in page among them. This
 * costs nothing to give up: every page in this product is specific to one
 * family, and the pages that were static are trivial to render.
 *
 * Declared on the root layout rather than page by page so a new route cannot
 * quietly reintroduce it. `/_not-found` has no page file to annotate anyway.
 */
export const dynamic = 'force-dynamic';

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#4f46e5',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-brand focus:px-4 focus:py-2 focus:text-white"
        >
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
