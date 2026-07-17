// Operator auth gate. Next 16 renamed `middleware.ts` -> `proxy.ts` (root).
// Protects every `(operator)` route; redirects unauthenticated hits to /sign-in;
// leaves the public `book/[token]` surface and /sign-in open (AD-6, FR33/FR34).

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { isPublicPath } from '@/lib/auth/route-guard';
import { SESSION_COOKIE, verifySession, getSessionSecret } from '@/lib/auth/session';

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;

  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  // FAIL CLOSED: a missing or weak SESSION_SECRET makes getSessionSecret throw;
  // we treat that as "no valid session" and redirect, never as an open pass.
  let session = null;
  try {
    const secret = getSessionSecret();
    const token = request.cookies.get(SESSION_COOKIE)?.value;
    session = await verifySession(token, secret);
  } catch {
    session = null;
  }

  if (session) {
    return NextResponse.next();
  }

  const signInUrl = new URL('/sign-in', request.url);
  return NextResponse.redirect(signInUrl);
}

export const config = {
  // Run on everything except Next internals and static assets. Public-path
  // exceptions (book/*, sign-in) are handled in-function via isPublicPath.
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
