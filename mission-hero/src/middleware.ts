import { NextResponse, type NextRequest } from 'next/server';
import { COOKIE_CHILD_SESSION, COOKIE_PARENT_SESSION } from '@/domain/constants';

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

  const response = NextResponse.next();
  response.headers.set(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      // Next.js injects inline bootstrap scripts; styles are Tailwind-generated.
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self'",
      "connect-src 'self'",
      "object-src 'none'",
      "base-uri 'none'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join('; '),
  );
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
  matcher: ['/parent/:path*', '/kids/:path*'],
};
