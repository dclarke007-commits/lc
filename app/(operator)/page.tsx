import Link from 'next/link';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SESSION_COOKIE, verifySession } from '@/lib/auth/session';
import { ExportButtons } from './export/ExportButtons';
import {
  getDashboardCapacity,
  getDashboardMetrics,
  getLeakIndicators,
  getGoneColdList,
} from './actions';

// Presentation-only: integer cents → "$1,234". No float math crosses the domain;
// this is a label. Whole dollars — the operator reads trajectory, not pennies.
function fmtCents(cents: number): string {
  return `$${Math.round(cents / 100).toLocaleString('en-US')}`;
}

// Signed delta with an explicit +, for the month-over-month revenue trend.
function fmtDeltaCents(cents: number): string {
  const sign = cents > 0 ? '+' : cents < 0 ? '−' : '';
  return `${sign}${fmtCents(Math.abs(cents))}`;
}

// A conversion ratio → whole-percent label. null (empty denominator) renders "—"
// (FR25 — "no data" is never shown as "0%"). Presentation-only; the domain returns
// the raw ratio and decides null vs a number.
function fmtRate(ratio: number | null): string {
  return ratio === null ? '—' : `${Math.round(ratio * 100)}%`;
}

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
  padding: '0.6rem 0.7rem',
  borderBottom: '1px solid var(--line)',
  textAlign: 'left',
};

// Story 6.1 metric tiles — phone-legible, one number each. A top accent bar
// (via .tile-accent + --tile-bar) encodes each tile's health at a glance.
const tile: React.CSSProperties = {
  background: 'var(--surface)',
  border: '1px solid var(--line)',
  borderRadius: 'var(--radius)',
  padding: '0.9rem',
  boxShadow: 'var(--shadow-sm)',
};
const tileLabel: React.CSSProperties = {
  fontSize: '0.75rem',
  color: 'var(--muted)',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  fontWeight: 600,
};
const tileValue: React.CSSProperties = {
  fontFamily: 'var(--font-display)',
  fontSize: '1.7rem',
  fontWeight: 700,
  letterSpacing: '-0.02em',
  marginTop: '0.3rem',
  fontVariantNumeric: 'tabular-nums',
};
const tileUnit: React.CSSProperties = { fontSize: '1rem', color: 'var(--faint)', fontWeight: 400 };
const tileWhy: React.CSSProperties = { fontSize: '0.75rem', color: 'var(--muted)', marginTop: '0.4rem' };

const card: React.CSSProperties = {
  marginTop: '1.25rem',
  background: 'var(--surface)',
  border: '1px solid var(--line)',
  borderRadius: 'var(--radius)',
  padding: '1.1rem',
  boxShadow: 'var(--shadow-sm)',
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
  const metrics = await getDashboardMetrics();
  const leaks = await getLeakIndicators();
  const cold = await getGoneColdList();
  const full = cap.roomLeft === 0;
  const revenueUp = metrics.revenueDeltaCents >= 0;

  const used = cap.weeklyCeiling - cap.roomLeft;
  const pct =
    cap.weeklyCeiling > 0
      ? Math.min(100, Math.round((used / cap.weeklyCeiling) * 100))
      : 0;

  return (
    <main style={{ padding: '1.5rem 0 2.5rem', maxWidth: 680 }}>
      <h1 style={{ margin: '0.25rem 0 0' }}>Operator dashboard</h1>
      <p style={{ margin: '0.25rem 0 0', color: 'var(--muted)' }}>
        The honest numbers — where the money leaks, and the room you have left.
      </p>

      {/* Story 6.1 — the honest numbers. Each tile maps to a named leak or a
          cash/capacity decision (FR25, NFR1); nothing vanity ships here. */}
      <section
        aria-labelledby="metrics-heading"
        style={{
          marginTop: '1rem',
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
          gap: '0.75rem',
        }}
      >
        <h2 id="metrics-heading" style={{ gridColumn: '1 / -1', fontSize: '1rem', margin: 0 }}>
          The numbers
        </h2>

        {/* Capacity decision */}
        <div
          className="tile-accent"
          style={{ ...tile, '--tile-bar': 'var(--teal)' } as React.CSSProperties}
        >
          <div style={tileLabel}>Utilization</div>
          <div style={tileValue}>
            {metrics.consuming}
            <span style={tileUnit}> / {metrics.weeklyCeiling}</span>
          </div>
          <div style={tileWhy}>booked this week — capacity</div>
        </div>

        {/* Payment leak */}
        <div
          className="tile-accent"
          style={{
            ...tile,
            '--tile-bar':
              metrics.outstandingTotalCents > 0 ? 'var(--danger)' : 'var(--green)',
          } as React.CSSProperties}
        >
          <div style={tileLabel}>Outstanding</div>
          <div
            style={{
              ...tileValue,
              color:
                metrics.outstandingTotalCents > 0 ? 'var(--danger)' : 'var(--success)',
            }}
          >
            {fmtCents(metrics.outstandingTotalCents)}
          </div>
          <div style={tileWhy}>owed to you — payment leak</div>
        </div>

        {/* Cash trajectory */}
        <div
          className="tile-accent"
          style={{
            ...tile,
            '--tile-bar': revenueUp ? 'var(--green)' : 'var(--danger)',
          } as React.CSSProperties}
        >
          <div style={tileLabel}>Revenue (mo.)</div>
          <div style={tileValue}>{fmtCents(metrics.revenueThisMonthCents)}</div>
          <div style={{ ...tileWhy, color: revenueUp ? 'var(--success)' : 'var(--danger)' }}>
            {fmtDeltaCents(metrics.revenueDeltaCents)} vs last month
          </div>
        </div>

        {/* Retention — revenue leak. NOTE: repeat and lapsed are INDEPENDENT counts,
            not a partition — a client with ≥2 completed jobs who is also cold right now
            is counted in BOTH. The "·" separator (not "/") avoids reading as a ratio. */}
        <div
          className="tile-accent"
          style={{ ...tile, '--tile-bar': 'var(--teal)' } as React.CSSProperties}
        >
          <div style={tileLabel}>Repeat &amp; lapsed</div>
          <div style={tileValue}>
            {metrics.repeatCount}
            <span style={tileUnit}> &middot; </span>
            <span style={{ color: metrics.lapsedCount > 0 ? 'var(--danger)' : undefined }}>
              {metrics.lapsedCount}
            </span>
          </div>
          <div style={tileWhy}>
            {metrics.repeatCount} repeat &middot; {metrics.lapsedCount} cold (independent) &middot; repeat rate{' '}
            {metrics.repeatRate === null
              ? '—'
              : `${Math.round(metrics.repeatRate * 100)}%`}{' '}
            (30d)
          </div>
        </div>
      </section>

      {/* Story 6.2 — the three leak indicators, front and center (FR24, AR19).
          Each is a conversion the operator can watch close: is the inquiry leak,
          the one-time leak, or a fresh regular-lapse the one to act on now? */}
      <section
        aria-labelledby="leaks-heading"
        style={{
          marginTop: '1rem',
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
          gap: '0.75rem',
        }}
      >
        <h2 id="leaks-heading" style={{ gridColumn: '1 / -1', fontSize: '1rem', margin: 0 }}>
          Leak indicators
        </h2>

        {/* Inquiry leak (Epic 4) */}
        <div
          className="tile-accent"
          style={{ ...tile, '--tile-bar': 'var(--teal)' } as React.CSSProperties}
        >
          <div style={tileLabel}>Inquiry → booking</div>
          <div style={tileValue}>{fmtRate(leaks.inquiryRate)}</div>
          <div style={tileWhy}>
            {leaks.inquiryBookings} booked / {leaks.inquiryCount} inquiries — inquiry leak
          </div>
        </div>

        {/* Rebooking leak (Epic 3) */}
        <div
          className="tile-accent"
          style={{ ...tile, '--tile-bar': 'var(--teal)' } as React.CSSProperties}
        >
          <div style={tileLabel}>One-time → repeat</div>
          <div style={tileValue}>{fmtRate(leaks.oneTimeRate)}</div>
          <div style={tileWhy}>
            {leaks.oneTimeConverted} of {leaks.oneTimeClients} one-timers came back — rebooking leak
          </div>
        </div>

        {/* Fresh lapse — act now */}
        <div
          className="tile-accent"
          style={{
            ...tile,
            '--tile-bar':
              leaks.caughtColdThisWeek > 0 ? 'var(--danger)' : 'var(--green)',
          } as React.CSSProperties}
        >
          <div style={tileLabel}>Caught cold (7d)</div>
          <div
            style={{
              ...tileValue,
              color: leaks.caughtColdThisWeek > 0 ? 'var(--danger)' : 'var(--success)',
            }}
          >
            {leaks.caughtColdThisWeek}
          </div>
          <div style={tileWhy}>regulars just slipped — win them back now</div>
        </div>
      </section>

      {/* Story 6.3 — the gone-cold list with direct win-back (FR23). Each cold
          regular is one tap from the Story-3.6 win-back panel, which re-derives the
          gone-cold gate server-side (this list is never trusted as authorization). */}
      <section
        aria-labelledby="cold-heading"
        style={card}
      >
        <h2 id="cold-heading" style={{ fontSize: '1rem', margin: '0 0 0.5rem' }}>
          Gone cold &middot; win them back
        </h2>
        {cold.length === 0 ? (
          <p style={{ margin: 0, color: 'var(--success)', fontSize: '0.9rem' }}>
            No regulars are cold right now.
          </p>
        ) : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {cold.map((c) => (
              <li
                key={c.id}
                style={{
                  display: 'flex',
                  alignItems: 'baseline',
                  justifyContent: 'space-between',
                  gap: '0.75rem',
                  padding: '0.5rem 0',
                  borderBottom: '1px solid var(--line)',
                }}
              >
                <span>
                  <strong>{c.name}</strong>{' '}
                  <span style={{ color: 'var(--faint)', fontSize: '0.85rem' }}>
                    due {fmtDay(c.expectedNextDate)}
                  </span>
                </span>
                <Link
                  href={`/clients?winback=${encodeURIComponent(c.id)}`}
                  style={{ whiteSpace: 'nowrap' }}
                >
                  Win back →
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section
        aria-labelledby="cap-heading"
        style={card}
      >
        <h2 id="cap-heading" style={{ fontSize: '1rem', margin: '0 0 0.5rem' }}>
          This week &middot; {fmtDay(cap.weekStart)}
        </h2>

        <p style={{ margin: '0 0 0.6rem', fontSize: '1.05rem' }}>
          <strong>Room left this week:</strong>{' '}
          <span
            style={{
              color: full ? 'var(--danger)' : 'var(--success)',
              fontWeight: 600,
            }}
          >
            {cap.roomLeft}
          </span>{' '}
          <span style={{ color: 'var(--faint)' }}>/ {cap.weeklyCeiling}</span>
          {cap.over > 0 && (
            <span className="tag tag--warn" role="status" style={{ marginLeft: '0.5rem' }}>
              &#9888; {cap.over} over
            </span>
          )}
        </p>

        {/* Signature — the week as a fill line: how much of the ceiling is spoken
            for. Green→teal while there's room; amber→red once the week is full. */}
        <div
          className="meter"
          role="img"
          aria-label={`${used} of ${cap.weeklyCeiling} booked this week`}
          style={{ '--pct': `${pct}%`, marginBottom: '0.9rem' } as React.CSSProperties}
        >
          <div className={`meter__fill${full ? ' meter__fill--full' : ''}`} />
        </div>

        {full && (
          <p
            role="status"
            style={{
              margin: '0 0 0.75rem',
              color: 'var(--amber)',
              background: 'var(--amber-bg)',
              padding: '0.5rem 0.7rem',
              borderRadius: 'var(--radius-sm)',
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
                    <span className="tag tag--muted">Past</span>
                  ) : d.open ? (
                    <span className="tag tag--open">Open</span>
                  ) : d.maxed ? (
                    <span className="tag tag--danger">
                      Day-maxed
                      {d.nextOpen
                        ? ` · next open ${fmtDay(d.nextOpen)}`
                        : ' · no open day soon'}
                    </span>
                  ) : (
                    // Under its per-day cap, but the WEEK is at the ceiling — not
                    // bookable without an override. Distinct from "Day-maxed".
                    <span className="tag tag--danger">Week full</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* Story 6.4 — data ownership. Export the owner's clients + jobs as CSV so the
          data is owned, not rented (FR35, NFR5). Server Action does the owner-scoped
          read + serialize; this is only the download trigger. */}
      <section
        aria-labelledby="export-heading"
        style={card}
      >
        <h2 id="export-heading" style={{ fontSize: '1rem', margin: '0 0 0.5rem' }}>
          Own your data
        </h2>
        <p style={{ margin: '0 0 0.75rem', fontSize: '0.85rem', color: 'var(--muted)' }}>
          Download your clients and jobs as CSV — your data, not rented.
        </p>
        <ExportButtons />
      </section>
    </main>
  );
}
