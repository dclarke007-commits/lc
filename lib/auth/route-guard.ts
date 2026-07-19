// Pure path classification for the operator gate (proxy.ts). Kept framework-free
// so it is unit-testable without constructing a NextRequest.
//
// AD-6: the operator is a single authenticated session; client booking surfaces
// (`/book/[token]`) are token-bearer and MUST stay open (FR34, no client login).
// The sign-in surface itself must be reachable while unauthenticated.

const PUBLIC_PREFIXES = ['/book'];
const PUBLIC_EXACT = new Set(['/', '/sign-in', '/request']);

/**
 * True when a path is reachable WITHOUT an operator session.
 * Everything else is operator-gated and requires a valid session cookie.
 */
export function isPublicPath(pathname: string): boolean {
  if (PUBLIC_EXACT.has(pathname)) return true;
  if (pathname.startsWith('/sign-in/')) return true;
  return PUBLIC_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
}
