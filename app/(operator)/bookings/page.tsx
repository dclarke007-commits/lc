// Booking surface (RSC). Auth-gated by proxy.ts (Story 1.1). Operator surfaces
// stay dynamic — never `use cache` (AD-13), which also gives a fresh idempotency
// nonce per render. Calls ACTIONS only — never imports lib/db (surfaces →
// actions → domain → db). Phone-first, zero client JS (NFR1): the form posts to a
// thin server-action wrapper that redirects with ?error / ?booked.

import Link from 'next/link';
import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { getBookableClients, createBooking } from './actions';
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
  redirect('/bookings?booked=1');
}

export default async function BookingsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; booked?: string }>;
}) {
  const clients = await getBookableClients();
  const sp = await searchParams;
  const errorMsg = bookingErrorMessage(sp.error);
  const booked = sp.booked === '1';
  // Fresh idempotency key per render — a repeat submit of THIS form carries the
  // same key, so commitBooking returns the same Job instead of a second (AD-12).
  const idempotencyKey = randomUUID();

  return (
    <main style={{ padding: '1.5rem', maxWidth: 640 }}>
      <p style={{ margin: '0 0 1rem' }}>
        <Link href="/">&larr; Dashboard</Link>
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
