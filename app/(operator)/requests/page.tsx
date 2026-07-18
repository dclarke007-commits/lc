// Approval-queue surface (RSC). Auth-gated by proxy.ts (Story 1.1). Operator
// surfaces stay dynamic — never `use cache` (AD-13): the pending queue must reflect
// live rows (an approved/declined row disappears immediately). Calls ACTIONS only —
// it never imports lib/db or lib/domain (surfaces → actions → domain → db). Phone-
// first, zero client JS (NFR1): each row's approve/decline is a tiny <form> posting
// the request id to a thin server-action wrapper that redirects to a banner param.

import Link from 'next/link';
import { redirect } from 'next/navigation';
import {
  listOwnerPendingRequests,
  approveRequest,
  declineRequest,
} from './actions';

export const dynamic = 'force-dynamic';

// Presentation-only day label from a 'YYYY-MM-DD' key — "Mon, Aug 3". Formatted in
// UTC so the calendar day never shifts (a request `date` is a tz-independent local
// calendar day, AD-9); this is a label, not clock math, so it stays in the surface
// rather than importing lib/domain (matches the dashboard/jobs surface convention).
function fmtDay(dateKey: string): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

// Thin server-action wrappers so the native <form action> gets a void return. The
// typed { ok, data } | { ok:false, reason } contract lives in the action. On failure
// we redirect to ?error=<code>; on success ?approved=1 / ?declined=1 (zero client JS).
async function approve(formData: FormData): Promise<void> {
  'use server';
  const result = await approveRequest(formData);
  if (!result.ok) {
    // Only 'no-availability' carries a client-meaningful banner (the slot filled
    // before approval). Every other reason maps to a generic error — the raw machine
    // reason is NEVER echoed into the URL.
    const code =
      result.reason === 'no-availability' ? 'no-longer-available' : 'error';
    redirect(`/requests?error=${code}`);
  }
  redirect('/requests?approved=1');
}

async function decline(formData: FormData): Promise<void> {
  'use server';
  const result = await declineRequest(formData);
  if (!result.ok) redirect('/requests?error=error');
  redirect('/requests?declined=1');
}

// The ONLY error codes this surface renders. Reading an untrusted ?error= param, we
// gate on Object.hasOwn against this whitelist so a hand-typed code never echoes an
// arbitrary string into the page — an unknown code renders no banner.
const ERROR_MESSAGES: Record<string, string> = {
  'no-longer-available':
    'That day is no longer available — it filled up, or is now in the past, since the request came in. Nothing was booked. You can decline the request.',
  error: 'Something went wrong. Please try again.',
};

const cell: React.CSSProperties = {
  padding: '0.5rem 0.6rem',
  borderBottom: '1px solid #eee',
  verticalAlign: 'top',
  textAlign: 'left',
};

const approveBtn: React.CSSProperties = {
  padding: '0.4rem 0.7rem',
  fontSize: '0.9rem',
  cursor: 'pointer',
  border: '1px solid #0a5c2b',
  borderRadius: 4,
  background: '#e6f4ea',
  color: '#0a5c2b',
  fontWeight: 600,
};

const declineBtn: React.CSSProperties = {
  padding: '0.4rem 0.7rem',
  fontSize: '0.9rem',
  cursor: 'pointer',
  border: '1px solid #b00020',
  borderRadius: 4,
  background: '#fff',
  color: '#b00020',
};

export default async function RequestsPage({
  searchParams,
}: {
  searchParams: Promise<{ approved?: string; declined?: string; error?: string }>;
}) {
  const requests = await listOwnerPendingRequests();
  const sp = await searchParams;
  const errorMsg =
    sp.error && Object.hasOwn(ERROR_MESSAGES, sp.error)
      ? ERROR_MESSAGES[sp.error]
      : null;
  const approved = sp.approved === '1';
  const declined = sp.declined === '1';

  return (
    <main style={{ padding: '1.5rem', maxWidth: 720 }}>
      <p style={{ margin: '0 0 1rem' }}>
        <Link href="/">&larr; Dashboard</Link>
      </p>
      <h1 style={{ fontSize: '1.25rem', margin: '0 0 1rem' }}>
        New-client requests
      </h1>

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

      {approved && !errorMsg && (
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
          Request approved and booked.
        </p>
      )}

      {declined && !errorMsg && (
        <p
          role="status"
          style={{
            color: '#555',
            background: '#f1f5f9',
            padding: '0.6rem 0.8rem',
            borderRadius: 4,
            margin: '0 0 1rem',
          }}
        >
          Request declined.
        </p>
      )}

      {requests.length === 0 ? (
        <p style={{ color: '#555' }}>No pending requests.</p>
      ) : (
        <table style={{ borderCollapse: 'collapse', width: '100%' }}>
          <thead>
            <tr>
              <th style={cell}>Requested day</th>
              <th style={cell}>Client</th>
              <th style={cell}>Contact</th>
              <th style={cell}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {requests.map((r) => (
              <tr key={r.id}>
                <td style={cell}>{fmtDay(r.date)}</td>
                <td style={cell}>
                  <strong>{r.clientName}</strong>
                </td>
                <td style={cell}>
                  {r.clientPhone}
                  {r.clientAddress ? (
                    <>
                      <br />
                      <span style={{ color: '#555' }}>{r.clientAddress}</span>
                    </>
                  ) : null}
                </td>
                <td style={cell}>
                  <div
                    style={{
                      display: 'flex',
                      gap: '0.4rem',
                      flexWrap: 'wrap',
                      alignItems: 'center',
                    }}
                  >
                    {/* Zero-JS approve/decline (like the jobs cancel/move forms): each
                        control POSTs the request id. approve routes through the ONE
                        commitBooking path; decline leaves the slot untouched. */}
                    <form action={approve} style={{ margin: 0 }}>
                      <input type="hidden" name="id" value={r.id} />
                      <button type="submit" style={approveBtn}>
                        Approve
                      </button>
                    </form>
                    <form action={decline} style={{ margin: 0 }}>
                      <input type="hidden" name="id" value={r.id} />
                      <button type="submit" style={declineBtn}>
                        Decline
                      </button>
                    </form>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
