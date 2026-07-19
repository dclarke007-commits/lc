// Booking surface (RSC). Auth-gated by proxy.ts (Story 1.1). Operator surfaces
// stay dynamic — never `use cache` (AD-13), which also gives a fresh idempotency
// nonce per render. Calls ACTIONS only — never imports lib/db (surfaces →
// actions → domain → db). Phone-first, zero client JS (NFR1): the form posts to a
// thin server-action wrapper that redirects with ?error / ?booked.

import Link from 'next/link';
import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { getBookableClients, createBooking, getConfirmationDraft } from './actions';
import { sendDraft } from '../draft/actions';
import { deepLink } from '@/lib/delivery/deeplink';
import { bookingErrorMessage } from '@/lib/domain/bookingErrors';

export const dynamic = 'force-dynamic';

const field: React.CSSProperties = { display: 'block', marginBottom: '0.75rem' };
const input: React.CSSProperties = {
  display: 'block',
  width: '100%',
  padding: '0.6rem',
  fontSize: '1rem',
  marginTop: '0.25rem',
  boxSizing: 'border-box',
};

// Thin server-action wrapper so the native <form action> gets a void return. The
// typed { ok, data } | { ok:false, reason } contract lives in the action. On
// failure redirect to ?error=<reason>; on success ?booked=1 (zero client JS).
async function book(formData: FormData): Promise<void> {
  'use server';
  const result = await createBooking(formData);
  if (!result.ok) redirect(`/bookings?error=${result.reason}`);
  // Carry the committed Job id so the surface can show its confirmation draft (2.4).
  redirect(`/bookings?booked=1&job=${result.data.id}`);
}

export default async function BookingsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; booked?: string; job?: string }>;
}) {
  const clients = await getBookableClients();
  const sp = await searchParams;
  const errorMsg = bookingErrorMessage(sp.error);
  const booked = sp.booked === '1';

  // Story 2.4: after a successful booking, compose the confirmation DRAFT for the
  // committed Job and show a tap-to-send affordance. Draft only — nothing auto-sends
  // (FR19); the drafted_at row was already written at commit. Reuses the 2.2/2.3 send
  // path (sendDraft) verbatim — no new delivery or logging here.
  let confirmBody: string | null = null;
  let confirmSlot = '';
  let confirmAmount = '';
  let confirmNonce = '';
  let confirmClientId = '';
  let confirmHasPhone = false;
  if (booked && sp.job) {
    const res = await getConfirmationDraft(sp.job);
    if (res.ok) {
      confirmBody = res.data.draft.body;
      confirmSlot = res.data.slot;
      confirmAmount = res.data.amountDollars;
      confirmNonce = res.data.nonce;
      confirmClientId = res.data.clientId;
      // recipient is the client's phone; deepLink returns null when unusable.
      confirmHasPhone = deepLink(res.data.draft, 'whatsapp') != null;
    }
  }
  // Fresh idempotency key per render — a repeat submit of THIS form carries the
  // same key, so commitBooking returns the same Job instead of a second (AD-12).
  const idempotencyKey = randomUUID();

  return (
    <main style={{ padding: '1.5rem', maxWidth: 640 }}>
      <p style={{ margin: '0 0 1rem' }}>
        <Link href="/dashboard">&larr; Dashboard</Link>
      </p>
      <h1 style={{ fontSize: '1.25rem', margin: '0 0 1rem' }}>Book a job</h1>

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

      {booked && !errorMsg && (
        <div style={{ margin: '0 0 1.5rem' }}>
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
            Booked.
          </p>

          {confirmBody !== null && (
            <section>
              <h2 style={{ fontSize: '1rem', margin: '0 0 0.5rem' }}>
                Confirmation message
              </h2>
              <p style={{ margin: '0 0 0.75rem', color: '#555' }}>
                Ready to send — nothing goes out until you tap.
              </p>
              <p
                style={{
                  whiteSpace: 'pre-wrap',
                  background: '#f5f5f5',
                  padding: '0.8rem',
                  borderRadius: 4,
                  margin: '0 0 1rem',
                }}
              >
                {confirmBody}
              </p>

              {confirmHasPhone ? (
                <div style={{ display: 'flex', gap: '0.75rem' }}>
                  {/* Reuses the 2.2/2.3 send path verbatim: form POST → sendDraft logs
                      the dispatch once (Job-keyed nonce → idempotent re-tap) then
                      redirects to the wa.me/sms deep link. */}
                  {(['whatsapp', 'sms'] as const).map((channel) => (
                    <form key={channel} action={sendDraft} style={{ margin: 0 }}>
                      <input type="hidden" name="client" value={confirmClientId} />
                      <input type="hidden" name="type" value="booking_confirmation" />
                      <input type="hidden" name="slot" value={confirmSlot} />
                      <input type="hidden" name="amount" value={confirmAmount} />
                      <input type="hidden" name="nonce" value={confirmNonce} />
                      <input type="hidden" name="channel" value={channel} />
                      <button
                        type="submit"
                        style={{
                          padding: '0.7rem 1.2rem',
                          fontSize: '1rem',
                          border: '1px solid #0a5c2b',
                          borderRadius: 4,
                          background: '#fff',
                          color: '#0a5c2b',
                          cursor: 'pointer',
                        }}
                      >
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
          )}
        </div>
      )}

      {clients.length === 0 ? (
        <p>
          No clients yet. <Link href="/clients">Add a client</Link> first.
        </p>
      ) : (
        <form action={book} style={{ maxWidth: 420 }}>
          <input type="hidden" name="idempotencyKey" value={idempotencyKey} />

          <label style={field}>
            Client
            <select style={input} name="clientId" defaultValue="" required>
              <option value="" disabled>
                Choose a client…
              </option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>

          <label style={field}>
            Date
            <input style={input} name="date" type="date" required />
          </label>

          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              margin: '0 0 1rem',
            }}
          >
            <input type="checkbox" name="override" />
            Override caps (book past a full day or week)
          </label>

          <button
            type="submit"
            style={{ padding: '0.7rem 1.2rem', fontSize: '1rem' }}
          >
            Book job
          </button>
        </form>
      )}
    </main>
  );
}
