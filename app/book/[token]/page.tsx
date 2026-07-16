// PUBLIC client booking surface — NO login (FR34, AD-6). Access is by signed,
// unguessable token ONLY; the token itself is the entire authorization. Story 3.1
// resolves it to ONE client's genuinely-open slots (day under per-day cap AND week
// under the ceiling — Story 1.7 derive, AD-2/AD-7). View-only: the actual booking
// mutation is Story 3.2. proxy.ts leaves app/book/** open (the one un-authenticated
// surface). AD-13: dynamic, never `use cache`, so slots are live at view time.
//
// A surface (AD-1): it calls the booking DOMAIN resolver, never lib/db or the crypto
// directly. Any invalid/tampered/unknown/revoked token renders ONE generic message
// that reveals nothing about whether a client or token exists (fail closed).

import { resolveBookingView } from '@/lib/domain/booking';
import { formatDateKey } from '@/lib/domain/clock';

export const dynamic = 'force-dynamic';

// isoWeekday (1=Mon..7=Sun) → short label. Index 0 is unused (weekdays are 1-based).
const WEEKDAY_LABEL = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const mainStyle: React.CSSProperties = { padding: '1.5rem', maxWidth: 480 };

export default async function BookPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const result = await resolveBookingView(token);

  // Fail closed: one generic message for every failure mode (invalid signature,
  // unknown/revoked token, missing client). Never leak which one it was.
  if (!result.ok) {
    return (
      <main style={mainStyle}>
        <h1 style={{ fontSize: '1.25rem' }}>Link not valid</h1>
        <p style={{ color: '#555' }}>
          This booking link isn’t valid. Please ask for a new link.
        </p>
      </main>
    );
  }

  const { clientName, openSlots, nextOpen } = result.view;

  return (
    <main style={mainStyle}>
      <h1 style={{ fontSize: '1.25rem' }}>Book a cleaning</h1>
      <p style={{ color: '#555' }}>Hi {clientName} — choose an open day:</p>

      {openSlots.length > 0 ? (
        <ul style={{ listStyle: 'none', padding: 0, margin: '1rem 0' }}>
          {openSlots.map((slot) => (
            <li
              key={slot.date}
              style={{
                padding: '0.75rem 1rem',
                marginBottom: '0.5rem',
                border: '1px solid #ddd',
                borderRadius: 8,
              }}
            >
              {WEEKDAY_LABEL[slot.isoWeekday]} · {formatDateKey(slot.date)}
            </li>
          ))}
        </ul>
      ) : (
        <p style={{ color: '#555', margin: '1rem 0' }}>
          No open days this week.
          {nextOpen ? ` Next opening: ${formatDateKey(nextOpen)}.` : ''}
        </p>
      )}
    </main>
  );
}
