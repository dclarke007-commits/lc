// PUBLIC client booking surface — NO login (FR34, AD-6). Access is by signed,
// unguessable token ONLY; the token itself is the entire authorization. Story 3.1
// resolves it to ONE client's genuinely-open slots (day under per-day cap AND week
// under the ceiling — Story 1.7 derive, AD-2/AD-7). Story 3.2 adds the direct-confirm:
// each open slot is a zero-JS POST to confirmBooking (the KNOWN client commits in one
// tap, no approval — AD-4/FR7). proxy.ts leaves app/book/** open (the one
// un-authenticated surface). AD-13: dynamic, never `use cache`, so slots are live.
//
// A surface (AD-1): it calls the booking DOMAIN resolver + the confirm Server Action,
// never lib/db or the crypto directly. Any invalid/tampered/unknown/revoked token
// renders ONE generic message that reveals nothing about whether a client or token
// exists (fail closed).

import { resolveBookingView } from '@/lib/domain/booking';
import { formatDateKey } from '@/lib/domain/clock';
import { confirmBooking } from './actions';

export const dynamic = 'force-dynamic';

// isoWeekday (1=Mon..7=Sun) → short label. Index 0 is unused (weekdays are 1-based).
const WEEKDAY_LABEL = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const mainStyle: React.CSSProperties = { padding: '1.5rem', maxWidth: 480 };

const slotButtonStyle: React.CSSProperties = {
  display: 'block',
  width: '100%',
  textAlign: 'left',
  padding: '0.75rem 1rem',
  border: '1px solid #ddd',
  borderRadius: 8,
  background: '#fff',
  fontSize: '1rem',
  cursor: 'pointer',
};

const bannerBase: React.CSSProperties = {
  padding: '0.75rem 1rem',
  borderRadius: 8,
  margin: '1rem 0',
};

export default async function BookPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ booked?: string; error?: string }>;
}) {
  const { token } = await params;
  const { booked, error } = await searchParams;
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

      {/* Direct confirmation — NO "pending approval" state (AD-4): the booking is
          already committed. */}
      {booked ? (
        <p style={{ ...bannerBase, background: '#e7f6ec', color: '#1a7f37' }}>
          You’re booked — see you then. You can book another open day below.
        </p>
      ) : null}

      {/* Lost race after view (AC3/FR9): day-maxed | week-full both map to this ONE
          client-facing line — the raw machine reason is never shown. */}
      {error === 'no-availability' ? (
        <p style={{ ...bannerBase, background: '#fdecea', color: '#b42318' }}>
          That time was just taken — please pick another slot.
        </p>
      ) : null}

      {/* Any other rejection on a VALID link (e.g. a stale form). Generic, no leak. */}
      {error === 'invalid' ? (
        <p style={{ ...bannerBase, background: '#fdecea', color: '#b42318' }}>
          Sorry, that didn’t go through. Please try again.
        </p>
      ) : null}

      <p style={{ color: '#555' }}>Hi {clientName} — choose an open day:</p>

      {openSlots.length > 0 ? (
        <ul style={{ listStyle: 'none', padding: 0, margin: '1rem 0' }}>
          {openSlots.map((slot) => (
            <li key={slot.date} style={{ marginBottom: '0.5rem' }}>
              {/* Zero-JS POST (NFR1): the whole slot is one submit button. Hidden
                  inputs carry the route token + this date; clientId is derived
                  server-side FROM the token (never a form field, AR7/AD-6). */}
              <form action={confirmBooking}>
                <input type="hidden" name="token" value={token} />
                <input type="hidden" name="date" value={slot.date} />
                <button type="submit" style={slotButtonStyle}>
                  {WEEKDAY_LABEL[slot.isoWeekday]} · {formatDateKey(slot.date)}
                </button>
              </form>
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
