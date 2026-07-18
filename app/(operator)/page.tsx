import Link from 'next/link';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SESSION_COOKIE, verifySession } from '@/lib/auth/session';
import { getDashboardCapacity } from './actions';

// Operator surfaces stay dynamic — never `use cache` (AD-7/AD-13). Capacity is
// derived on read, so the numbers below are live mid-call.
export const dynamic = 'force-dynamic';

// Presentation-only date label from a 'YYYY-MM-DD' key. Formatted in UTC so the
// calendar day never shifts; this is a label, not clock math (AD-9 lives in the
// domain — a surface never imports lib/domain).
function fmtDay(dateKey: string): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const wd = dt.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
  return `${wd} ${m}/${d}`;
}

const cell: React.CSSProperties = {
  padding: '0.5rem 0.6rem',
  borderBottom: '1px solid #eee',
  textAlign: 'left',
};

// Empty authenticated shell + at-a-glance capacity (Story 1.7). proxy.ts gates
// this route; the in-page session read is defense-in-depth (AD-6).
export default async function DashboardPage() {
  const secret = process.env.SESSION_SECRET;
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = secret ? await verifySession(token, secret) : null;
  if (!session) redirect('/sign-in');

  // Derived on read (AD-7) via the action layer — surfaces never touch derive/db.
  const cap = await getDashboardCapacity();
  const full = cap.roomLeft === 0;

  return (
    <main style={{ padding: '1.5rem', maxWidth: 640 }}>
      <h1 style={{ fontSize: '1.25rem', margin: 0 }}>Operator dashboard</h1>

      <section
        aria-labelledby="cap-heading"
        style={{
          marginTop: '1rem',
          border: '1px solid #e2e2e2',
          borderRadius: 8,
          padding: '1rem',
        }}
      >
        <h2 id="cap-heading" style={{ fontSize: '1rem', margin: '0 0 0.5rem' }}>
          This week &middot; {fmtDay(cap.weekStart)}
        </h2>

        <p style={{ margin: '0 0 0.75rem', fontSize: '1.05rem' }}>
          <strong>Room left this week:</strong>{' '}
          <span style={{ color: full ? '#b00020' : '#0a5c2b' }}>
            {cap.roomLeft}
          </span>{' '}
          <span style={{ color: '#888' }}>/ {cap.weeklyCeiling}</span>
          {cap.over > 0 && (
            <span
              role="status"
              style={{
                marginLeft: '0.5rem',
                color: '#8a4b00',
                background: '#fff3e0',
                padding: '0.1rem 0.4rem',
                borderRadius: 4,
                fontSize: '0.85rem',
              }}
            >
              &#9888; {cap.over} over
            </span>
          )}
        </p>

        {full && (
          <p
            role="status"
            style={{
              margin: '0 0 0.75rem',
              color: '#8a4b00',
              background: '#fff3e0',
              padding: '0.5rem 0.7rem',
              borderRadius: 4,
              fontSize: '0.9rem',
            }}
          >
            This week is full.
            {cap.weekNextOpen
              ? ` Next open: ${fmtDay(cap.weekNextOpen)}.`
              : ' No open day in the next few weeks.'}
          </p>
        )}

        <table style={{ borderCollapse: 'collapse', width: '100%' }}>
          <thead>
            <tr>
              <th style={cell}>Day</th>
              <th style={cell}>Booked</th>
              <th style={cell}>Status</th>
            </tr>
          </thead>
          <tbody>
            {cap.days.map((d) => (
              <tr key={d.date}>
                <td style={cell}>{fmtDay(d.date)}</td>
                <td style={cell}>
                  {d.consuming}/{d.perDayCap}
                </td>
                <td style={cell}>
                  {d.past ? (
                    <span style={{ color: '#999' }}>Past</span>
                  ) : d.open ? (
                    <span style={{ color: '#0a5c2b' }}>Open</span>
                  ) : d.maxed ? (
                    <span style={{ color: '#b00020' }}>
                      Day-maxed
                      {d.nextOpen
                        ? ` · next open ${fmtDay(d.nextOpen)}`
                        : ' · no open day soon'}
                    </span>
                  ) : (
                    // Under its per-day cap, but the WEEK is at the ceiling — not
                    // bookable without an override. Distinct from "Day-maxed".
                    <span style={{ color: '#b00020' }}>Week full</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <nav style={{ marginTop: '1rem', display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
        <Link href="/clients">Clients</Link>
        <Link href="/bookings">Book a job</Link>
        <Link href="/jobs">Jobs</Link>
        <Link href="/requests">Requests</Link>
        <Link href="/link">Public link</Link>
        <Link href="/settings">Availability &amp; caps</Link>
      </nav>
    </main>
  );
}
