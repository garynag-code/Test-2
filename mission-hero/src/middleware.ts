import { NextResponse, type NextRequest } from 'next/server';
import { COOKIE_CHILD_SESSION, COOKIE_PARENT_SESSION } from '@/domain/constants';

/**
 * A per-request nonce lets the CSP drop 'unsafe-inline' for scripts in
 * production.
 *
 * Next.js takes the nonce from the **request's** Content-Security-Policy
 * header, so the policy has to be set on the request as well as the response —
 * otherwise Next stamps no nonce on the scripts it injects and, because
 * 'strict-dynamic' makes browsers ignore 'self', every script on the page is
 * blocked. The symptom is a site that still works (server actions degrade
 * gracefully) but has no interactivity at all.
 *
 * In development the dev server needs eval, so the policy is relaxed there and
 * there only.
 */
function buildCsp(nonce: string, isProduction: boolean): string {
  const scriptSrc = isProduction
    ? `'self' 'nonce-${nonce}' 'strict-dynamic'`
    : "'self' 'unsafe-inline' 'unsafe-eval'";

  return [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    // Tailwind generates a stylesheet, but Next injects inline style tags.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(isProduction ? ['upgrade-insecure-requests'] : []),
  ].join('; ');
}

/**
 * A coarse gate in front of the two surfaces.
 *
 * This is a convenience redirect, **not** the authorization boundary: the
 * cookie is only checked for presence here because middleware runs on the edge
 * without database access. Every page and action still calls a guard that
 * verifies the signature and the live membership row (docs/03 §2).
 */
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname.startsWith('/parent') && !isAuthRoute(pathname)) {
    if (!request.cookies.get(COOKIE_PARENT_SESSION)) {
      return redirectTo(request, '/parent/login');
    }
  }

  if (pathname.startsWith('/kids/') && !request.cookies.get(COOKIE_CHILD_SESSION)) {
    return redirectTo(request, '/kids');
  }

  const nonce = crypto.randomUUID().replace(/-/g, '');
  const isProduction = process.env.NODE_ENV === 'production';

  const csp = buildCsp(nonce, isProduction);

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('Content-Security-Policy', csp);
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  if (isProduction) {
    response.headers.set(
      'Strict-Transport-Security',
      'max-age=63072000; includeSubDomains; preload',
    );
  }
  return response;
}

function isAuthRoute(pathname: string): boolean {
  return pathname === '/parent/login' || pathname === '/parent/register';
}

function redirectTo(request: NextRequest, path: string) {
  const url = request.nextUrl.clone();
  url.pathname = path;
  url.search = '';
  return NextResponse.redirect(url);
}

export const config = {
  // Every route, so the security headers are never missing from one of them.
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
