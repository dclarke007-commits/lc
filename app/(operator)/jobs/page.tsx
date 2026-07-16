// Jobs surface (RSC). Auth-gated by proxy.ts (Story 1.1). Operator surfaces stay
// dynamic — never `use cache` (AD-13). Calls ACTIONS only — never imports lib/db
// or lib/domain (surfaces → actions → domain → db). Phone-first, zero client JS
// (NFR1): each control is a tiny <form> posting to a thin server-action wrapper
// that redirects with ?error / ?done.

import Link from 'next/link';
import { redirect } from 'next/navigation';
import {
  getOwnerJobs,
  getRebookProposal,
  prepareRebook,
  sendRebook,
  markOutcome,
  correctOutcome,
  cancelJob,
  rescheduleJob,
} from './actions';
import { lifecycleErrorMessage } from '@/lib/domain/lifecycleErrors';
import { deepLink } from '@/lib/delivery/deeplink';

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

async function submitCancel(formData: FormData): Promise<void> {
  'use server';
  const result = await cancelJob(formData);
  if (!result.ok) redirect(`/jobs?error=${result.reason}`);
  redirect('/jobs?done=1');
}

async function submitReschedule(formData: FormData): Promise<void> {
  'use server';
  const result = await rescheduleJob(formData);
  if (!result.ok) redirect(`/jobs?error=${result.reason}`);
  redirect('/jobs?done=1');
}

const btn: React.CSSProperties = {
  padding: '0.4rem 0.7rem',
  fontSize: '0.9rem',
  cursor: 'pointer',
};

// Story 3.4 (AC1): the post-job nudge is the completed-job HIGHLIGHTED variant of the
// same rebook control — a call to action so the operator never forgets to ask for the
// next job. It fires the identical prepareRebook flow; only the emphasis differs.
const nudgeBtn: React.CSSProperties = {
  padding: '0.4rem 0.7rem',
  fontSize: '0.9rem',
  cursor: 'pointer',
  border: '1px solid #0a5c2b',
  borderRadius: 4,
  background: '#e6f4ea',
  color: '#0a5c2b',
  fontWeight: 600,
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

// Story 3.3: the one-tap rebooking control lives on completed OR upcoming (booked)
// jobs (FR10). Zero-JS (AD-13): a <form> POSTs to prepareRebook, which MINTS the stable
// per-client booking link (the write) and then redirects to ?rebook=<jobId>. The write
// lives on that POST — never on this render (AD-1: no write-on-render, code-review P3).
// The GET render below (RebookPanel → getRebookProposal) is a PURE derive READ (AD-7)
// that only reads the already-minted link.
const REBOOKABLE = new Set(['booked', 'completed']);

/**
 * The proposal panel (Story 3.3 slot/draft + Story 3.4 send). Renders the proposed slot,
 * the composed rebooking draft, and — CHANGED in 3.4 — WhatsApp/SMS SEND FORMS (not plain
 * anchors) posting to sendRebook, so a tap logs ONE dispatched rebooking_nudge MessageLog
 * (Story 2.3 path) then opens the pre-filled chat. Reads ONLY via the action.
 */
async function RebookPanel({ jobId }: { jobId: string }) {
  const res = await getRebookProposal(jobId);

  const panel: React.CSSProperties = {
    border: '1px solid #cbd5e1',
    background: '#f8fafc',
    borderRadius: 6,
    padding: '0.9rem 1rem',
    margin: '0 0 1.25rem',
  };

  if (!res.ok) {
    // Map the typed reason (P1–P4) to a generic operator message; never surface a raw
    // reason code or a 500. Unknown reasons fall back to a safe generic message.
    return (
      <section style={panel} aria-label="Rebooking proposal">
        <p role="alert" style={{ color: '#b00020', margin: 0 }}>
          {lifecycleErrorMessage(res.reason)}
        </p>
      </section>
    );
  }

  const { slot, draft } = res.data;

  if (!slot || !draft) {
    return (
      <section style={panel} aria-label="Rebooking proposal">
        <p role="status" style={{ margin: 0 }}>
          No open slot in range. Try again once a day frees up.
        </p>
      </section>
    );
  }

  // Deep-link presence is the phone-presence gate only: whether the client CAN be sent to.
  // The actual send goes through the sendRebook POST (which recomposes the SAME body and
  // records the dispatch) — never a plain anchor, so the tap logs exactly once (Story 3.4).
  const waLink = deepLink(draft, 'whatsapp');
  const smsLink = deepLink(draft, 'sms');
  const send: React.CSSProperties = {
    display: 'inline-block',
    padding: '0.6rem 1rem',
    fontSize: '1rem',
    border: '1px solid #0a5c2b',
    borderRadius: 4,
    background: '#fff',
    color: '#0a5c2b',
    cursor: 'pointer',
  };

  return (
    <section style={panel} aria-label="Rebooking proposal">
      <h2 style={{ fontSize: '1rem', margin: '0 0 0.4rem' }}>
        Proposed next slot: {slot}
      </h2>
      <p
        style={{
          whiteSpace: 'pre-wrap',
          background: '#fff',
          border: '1px solid #e2e8f0',
          padding: '0.7rem',
          borderRadius: 4,
          margin: '0 0 0.8rem',
        }}
      >
        {draft.body}
      </p>
      {waLink && smsLink ? (
        <div style={{ display: 'flex', gap: '0.75rem' }}>
          {/* Zero-JS send (Story 2.3/3.4): each control is a form POST to sendRebook. The
              tap LOGS the dispatch ONCE (message_type = rebooking_nudge, nonce rebook:<id>)
              then redirects to the wa.me/sms deep link so the OS opens the chat pre-filled.
              A re-tap re-opens but never double-logs (idempotent per-job nonce). */}
          {(['whatsapp', 'sms'] as const).map((channel) => (
            <form key={channel} action={sendRebook} style={{ margin: 0 }}>
              <input type="hidden" name="jobId" value={jobId} />
              <input type="hidden" name="channel" value={channel} />
              <button type="submit" style={send}>
                {channel === 'whatsapp' ? 'Open in WhatsApp' : 'Open in SMS'}
              </button>
            </form>
          ))}
        </div>
      ) : (
        <p role="status" style={{ color: '#b00020', margin: 0 }}>
          This client has no usable phone number — add one to send.
        </p>
      )}
    </section>
  );
}

/** The outcome/correction controls for one job, chosen by its current state. */
function JobControls({ id, completion }: { id: string; completion: string }) {
  if (completion === 'booked') {
    // NORMAL marks + cancel + reschedule (Story 1.6). Cancel frees the slot
    // (cancelled does not consume); reschedule moves the row under the cap check.
    return (
      <div
        style={{
          display: 'flex',
          gap: '0.4rem',
          flexWrap: 'wrap',
          alignItems: 'center',
        }}
      >
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
        <form action={submitCancel}>
          <input type="hidden" name="jobId" value={id} />
          <button type="submit" style={btn}>
            Cancel
          </button>
        </form>
        <form
          action={submitReschedule}
          style={{ display: 'flex', gap: '0.25rem', alignItems: 'center' }}
        >
          <input type="hidden" name="jobId" value={id} />
          <input
            type="date"
            name="newDate"
            required
            aria-label="New date"
            style={{ padding: '0.35rem', fontSize: '0.9rem' }}
          />
          <button type="submit" style={btn}>
            Move
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
  searchParams: Promise<{ error?: string; done?: string; rebook?: string }>;
}) {
  const jobs = await getOwnerJobs();
  const sp = await searchParams;
  const errorMsg = lifecycleErrorMessage(sp.error);
  const done = sp.done === '1';
  const rebookJobId = sp.rebook?.trim() || null;

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

      {rebookJobId && <RebookPanel jobId={rebookJobId} />}

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
                  {REBOOKABLE.has(j.completion) && (
                    <div style={{ marginTop: '0.4rem' }}>
                      {/* Zero-JS POST (like the cancel/move forms): prepareRebook mints
                          the per-client link (the write, P3), then redirects to the
                          ?rebook=<id> panel. No GET write-on-render. Story 3.4 (AC1): a
                          just-completed job with no rebooking nudge yet dispatched surfaces
                          the HIGHLIGHTED "Send rebooking nudge" prompt (derive-on-read —
                          j.needsRebookNudge, no stored flag); it fires the SAME flow. Once a
                          nudge is dispatched the predicate flips false → plain Rebook. */}
                      <form action={prepareRebook}>
                        <input type="hidden" name="jobId" value={j.id} />
                        {j.needsRebookNudge ? (
                          <button type="submit" style={nudgeBtn}>
                            Send rebooking nudge
                          </button>
                        ) : (
                          <button type="submit" style={btn}>
                            Rebook
                          </button>
                        )}
                      </form>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
