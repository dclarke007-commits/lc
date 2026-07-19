import type { ReactNode } from 'react';
import Link from 'next/link';
import { cookies } from 'next/headers';
import { SESSION_COOKIE, verifySession } from '@/lib/auth/session';

// The operator app shell. This route group includes /sign-in, so the shell is
// session-aware: authenticated operators get the top bar + nav; an unauthenticated
// visitor (the sign-in screen) gets a bare centered card — no nav is ever shown to
// someone without a session (defense-in-depth alongside proxy.ts / AD-6).
export const dynamic = 'force-dynamic';

const NAV = [
  { href: '/', label: 'Dashboard' },
  { href: '/clients', label: 'Clients' },
  { href: '/bookings', label: 'Book a job' },
  { href: '/jobs', label: 'Jobs' },
  { href: '/requests', label: 'Requests' },
  { href: '/inquiries', label: 'Inquiries' },
  { href: '/link', label: 'Link' },
  { href: '/settings', label: 'Settings' },
];

function Brand() {
  return (
    <Link href="/" className="brand">
      <span className="brand__mark" aria-hidden="true">
        &#10022;
      </span>
      <span>
        Loves<span className="brand__love">Cleaning</span>
      </span>
    </Link>
  );
}

export default async function OperatorLayout({
  children,
}: {
  children: ReactNode;
}) {
  const secret = process.env.SESSION_SECRET;
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = secret ? await verifySession(token, secret) : null;

  // Unauthenticated (sign-in): centered card, brand only, no nav.
  if (!session) {
    return (
      <div className="auth-shell">
        <div style={{ width: '100%', maxWidth: 380 }}>
          <div className="auth-brand">
            <Brand />
          </div>
          {children}
        </div>
      </div>
    );
  }

  return (
    <>
      <header className="appbar">
        <div className="appbar__inner">
          <Brand />
          <nav className="nav" aria-label="Main">
            {NAV.map((item) => (
              <Link key={item.href} href={item.href}>
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
      </header>
      <div className="container">{children}</div>
    </>
  );
}
