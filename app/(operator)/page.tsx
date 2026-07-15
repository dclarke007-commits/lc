import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SESSION_COOKIE, verifySession } from '@/lib/auth/session';

// Operator surfaces stay dynamic — never `use cache` (AD-7/AD-13).
export const dynamic = 'force-dynamic';

// Empty authenticated shell, server-rendered (RSC). No client login for anyone
// else (AD-6). proxy.ts already gates this route; the in-page check is a
// defense-in-depth read of the session for display only.
export default async function DashboardPage() {
  const secret = process.env.SESSION_SECRET;
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = secret ? await verifySession(token, secret) : null;
  if (!session) redirect('/sign-in');

  return (
    <main style={{ padding: '1.5rem', maxWidth: 640 }}>
      <h1 style={{ fontSize: '1.25rem', margin: 0 }}>Operator dashboard</h1>
      <p style={{ color: '#555' }}>
        Signed in. The book is empty — scaffolding only (Story 1.1).
      </p>
    </main>
  );
}
