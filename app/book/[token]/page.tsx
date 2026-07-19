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
import { resolvePublicBookingView } from '@/lib/domain/publicToken';
import { formatDateKey } from '@/lib/domain/clock';
import { generateTokenNonce } from '@/lib/auth/clientToken';
import { confirmBooking } from './actions';
import { PublicRequestForm } from './PublicRequestForm';

export const dynamic = 'force-dynamic';

// isoWeekday (1=Mon..7=Sun) → short label. Index 0 is unused (weekdays are 1-based).
const WEEKDAY_LABEL = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const mainStyle: React.CSSProperties = { padding: '1.5rem', maxWidth: 480 };

const slotButtonStyle: React.CSSProperties = {
  display: 'block',
  width: '100%',
  textAlign: 'left',
  padding: '0.75rem 1rem',
  border: '1px solid var(--line)',
  borderRadius: 'var(--radius-sm)',
  background: 'var(--surface)',
  color: 'var(--ink)',
  fontSize: '1rem',
  fontWeight: 500,
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
  searchParams: Promise<{ booked?: string; error?: string; submitted?: string }>;
}) {
  const { token } = await params;
  const { booked, error, submitted } = await searchParams;

  // Story 4.1 — the ONE public self-serve token, resolved FIRST. A per-client token
  // fails verifyPublicToken fast (distinct PUBLIC_TOKEN_SECRET + the book-public
  // capability guard) with no DB hit, then falls through to the per-client path below.
  // The public surface is VIEW-ONLY here: a stranger sees the operator's open days, but
  // the submission (→ provisional client + PendingRequest) is Story 4.2, so no confirm
  // form is rendered — the slots are non-interactive.
  const publicResult = await resolvePublicBookingView(token);
  if (publicResult.ok) {
    const { openSlots, nextOpen } = publicResult.view;
    // Per-render token-visit session nonce (AR12): embedded in the form so a double-tap
    // of THIS rendered form dedupes to one request/inquiry. A fresh render = a fresh
    // visit session. force-dynamic (above) guarantees this is minted on every load.
    const visit = generateTokenNonce();

    // Untrusted ?error= from the redirect mask. Look it up with Object.hasOwn on a
    // null-proto-safe map so a crafted ?error=__proto__ can never match a banner.
    const PUBLIC_ERROR_COPY: Record<string, string> = {
      'no-availability':
        'That day was just taken — please pick another open day.',
      invalid: 'Sorry, that didn’t go through. Please try again.',
      'too-many':
        'You’re going a bit fast — please wait a moment and try again.',
    };
    const errorCopy =
      typeof error === 'string' && Object.hasOwn(PUBLIC_ERROR_COPY, error)
        ? PUBLIC_ERROR_COPY[error]
        : null;

    return (
      <main style={mainStyle}>
        <h1 style={{ fontSize: '1.25rem' }}>Book a cleaning</h1>

        {/* Request recorded — NOT a confirmed booking (AR5): the operator approves it
            (Story 4.3). No slot is held on the strength of this. */}
        {submitted ? (
          <p style={{ ...bannerBase, background: '#e7f6ec', color: '#1a7f37' }}>
            Thanks — your request is in. We’ll confirm your day shortly.
          </p>
        ) : null}

        {errorCopy ? (
          <p style={{ ...bannerBase, background: '#fdecea', color: '#b42318' }}>
            {errorCopy}
          </p>
        ) : null}

        {openSlots.length > 0 ? (
          <>
            <p style={{ color: 'var(--muted)' }}>
              Pick an open day and tell us how to reach you:
            </p>
            <PublicRequestForm
              token={token}
              visit={visit}
              openSlots={openSlots}
              formatDate={formatDateKey}
            />
          </>
        ) : (
          <p style={{ color: 'var(--muted)', margin: '1rem 0' }}>
            No open days this week.
            {nextOpen ? ` Next opening: ${formatDateKey(nextOpen)}.` : ''}
          </p>
        )}
      </main>
    );
  }

  const result = await resolveBookingView(token);

  // Fail closed: one generic message for every failure mode (invalid signature,
  // unknown/revoked token, missing client). Never leak which one it was.
  if (!result.ok) {
    return (
      <main style={mainStyle}>
        <h1 style={{ fontSize: '1.25rem' }}>Link not valid</h1>
        <p style={{ color: 'var(--muted)' }}>
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

      <p style={{ color: 'var(--muted)' }}>Hi {clientName} — choose an open day:</p>

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
        <p style={{ color: 'var(--muted)', margin: '1rem 0' }}>
          No open days this week.
          {nextOpen ? ` Next opening: ${formatDateKey(nextOpen)}.` : ''}
        </p>
      )}
    </main>
  );
}
