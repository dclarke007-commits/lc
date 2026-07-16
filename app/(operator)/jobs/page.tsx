// Jobs surface (RSC). Auth-gated by proxy.ts (Story 1.1). Operator surfaces stay
// dynamic — never `use cache` (AD-13). Calls ACTIONS only — never imports lib/db
// or lib/domain (surfaces → actions → domain → db). Phone-first, zero client JS
// (NFR1): each control is a tiny <form> posting to a thin server-action wrapper
// that redirects with ?error / ?done.

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getOwnerJobs, markOutcome, correctOutcome } from './actions';
import { lifecycleErrorMessage } from '@/lib/domain/lifecycleErrors';

export const dynamic = 'force-dynamic';

// Thin server-action wrappers so the native <form action> gets a void return. The
// typed { ok, data } | { ok:false, reason } contract lives in the action. On
// failure redirect to ?error=<reason>; on success ?done=1 (zero client JS).
async function submitOutcome(formData: FormData): Promise<void> {
  'use server';
  const result = await markOutcome(formData);
  if (!result.ok) redirect(`/jobs?error=${result.reason}`);
  redirect('/jobs?done=1');
}

async function submitCorrection(formData: FormData): Promise<void> {
  'use server';
  const result = await correctOutcome(formData);
  if (!result.ok) redirect(`/jobs?error=${result.reason}`);
  redirect('/jobs?done=1');
}

const btn: React.CSSProperties = {
  padding: '0.4rem 0.7rem',
  fontSize: '0.9rem',
  cursor: 'pointer',
};

const cell: React.CSSProperties = {
  padding: '0.5rem 0.6rem',
  borderBottom: '1px solid #eee',
  verticalAlign: 'top',
  textAlign: 'left',
};

const COMPLETION_LABEL: Record<string, string> = {
  booked: 'Booked',
  completed: 'Completed',
  'no-show': 'No-show',
  cancelled: 'Cancelled',
};

/** The outcome/correction controls for one job, chosen by its current state. */
function JobControls({ id, completion }: { id: string; completion: string }) {
  if (completion === 'booked') {
    // NORMAL marks.
    return (
      <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
        <form action={submitOutcome}>
          <input type="hidden" name="jobId" value={id} />
          <input type="hidden" name="outcome" value="completed" />
          <button type="submit" style={btn}>
            Mark completed
          </button>
        </form>
        <form action={submitOutcome}>
          <input type="hidden" name="jobId" value={id} />
          <input type="hidden" name="outcome" value="no-show" />
          <button type="submit" style={btn}>
            Mark no-show
          </button>
        </form>
      </div>
    );
  }

  // Terminal / completed → the ONLY correction exposed in Story 1.5 is
  // completed→cancelled (AD-10 quote-exact, and capacity-safe: `cancelled` does
  // not consume, so the slot frees automatically). Resurrection back to `booked`
  // is intentionally NOT offered here:
  //   - completed→booked is not an AD-10-legal transition (D1); and
  //   - no-show/cancelled→booked re-consumes a slot with NO cap/ceiling recheck
  //     (D2 — keystone bug).
  // Both are deferred to Story 1.6, which adds capacity-checked correction /
  // reschedule and re-opens these paths safely. See deferred-work.md.
  if (completion === 'completed') {
    return (
      <form action={submitCorrection}>
        <input type="hidden" name="jobId" value={id} />
        <input type="hidden" name="to" value="cancelled" />
        <button type="submit" style={btn}>
          Correct to cancelled
        </button>
      </form>
    );
  }
  // no-show / cancelled: no correction offered until Story 1.6.
  return <span style={{ color: '#999' }}>&mdash;</span>;
}

export default async function JobsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; done?: string }>;
}) {
  const jobs = await getOwnerJobs();
  const sp = await searchParams;
  const errorMsg = lifecycleErrorMessage(sp.error);
  const done = sp.done === '1';

  return (
    <main style={{ padding: '1.5rem', maxWidth: 720 }}>
      <p style={{ margin: '0 0 1rem' }}>
        <Link href="/">&larr; Dashboard</Link>
      </p>
      <h1 style={{ fontSize: '1.25rem', margin: '0 0 1rem' }}>Jobs</h1>

      {errorMsg && (
        <p
          role="alert"
          style={{
            color: '#b00020',
            background: '#fde8e8',
            padding: '0.6rem 0.8rem',
            borderRadius: 4,
            margin: '0 0 1rem',
          }}
        >
          {errorMsg}
        </p>
      )}

      {done && !errorMsg && (
        <p
          role="status"
          style={{
            color: '#0a5c2b',
            background: '#e6f4ea',
            padding: '0.6rem 0.8rem',
            borderRadius: 4,
            margin: '0 0 1rem',
          }}
        >
          Updated.
        </p>
      )}

      {jobs.length === 0 ? (
        <p>
          No jobs yet. <Link href="/bookings">Book a job</Link> first.
        </p>
      ) : (
        <table style={{ borderCollapse: 'collapse', width: '100%' }}>
          <thead>
            <tr>
              <th style={cell}>Date</th>
              <th style={cell}>Client</th>
              <th style={cell}>Status</th>
              <th style={cell}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((j) => (
              <tr key={j.id}>
                <td style={cell}>{j.date}</td>
                <td style={cell}>{j.clientName}</td>
                <td style={cell}>
                  {COMPLETION_LABEL[j.completion] ?? j.completion}
                </td>
                <td style={cell}>
                  <JobControls id={j.id} completion={j.completion} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
