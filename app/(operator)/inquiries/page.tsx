// Manual inquiry-log surface (RSC). Auth-gated by proxy.ts (Story 1.1). Operator
// surfaces stay dynamic — never `use cache` (AD-7/AD-13): the inquiry list must reflect
// live rows. Calls ACTIONS only — it never imports lib/db or lib/domain (surfaces →
// actions → domain → db). Phone-first, zero client JS (NFR1): the log form is a native
// <form> posting a source (+ optional client) to a thin server-action wrapper that
// redirects to a banner param.

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { logInquiry, listOwnerInquiries } from './actions';
import { listOwnerClients } from '../clients/actions';

export const dynamic = 'force-dynamic';

// Thin server-action wrapper so the native <form action> gets a void return. The typed
// { ok, data } | { ok:false, reason } contract lives in logInquiry. On failure we
// redirect to ?error=<reason>; on success ?logged=1 (zero client JS, NFR1).
async function submitInquiry(formData: FormData): Promise<void> {
  'use server';
  const result = await logInquiry(formData);
  if (!result.ok) redirect(`/inquiries?error=${result.reason}`);
  redirect('/inquiries?logged=1');
}

// The ONLY error codes this surface renders. Reading an untrusted ?error= param, we gate
// on Object.hasOwn against this whitelist so a hand-typed code never echoes an arbitrary
// string into the page — an unknown code renders no banner.
const ERROR_MESSAGES: Record<string, string> = {
  'source-invalid': 'Pick a valid inquiry source.',
  'client-not-found': 'That client could not be found.',
  'owner-unresolved': 'Something went wrong. Please try again.',
  'inquiry-write-failed': 'Something went wrong. Please try again.',
};

// The four manual sources (matches the action whitelist; `link` is server-only, AR12).
const SOURCE_OPTIONS: { value: string; label: string }[] = [
  { value: 'phone', label: 'Phone' },
  { value: 'walk-in', label: 'Walk-in' },
  { value: 'referral', label: 'Referral' },
  { value: 'other', label: 'Other' },
];

const SOURCE_LABELS: Record<string, string> = {
  phone: 'Phone',
  'walk-in': 'Walk-in',
  referral: 'Referral',
  other: 'Other',
  link: 'Link', // display-only, for the 4.2 auto-logged rows in the list
};

const cell: React.CSSProperties = {
  padding: '0.5rem 0.6rem',
  borderBottom: '1px solid #eee',
  textAlign: 'left',
};

const field: React.CSSProperties = {
  display: 'block',
  width: '100%',
  padding: '0.5rem',
  fontSize: '1rem',
  border: '1px solid #ccc',
  borderRadius: 4,
  marginTop: '0.25rem',
};

const submitBtn: React.CSSProperties = {
  padding: '0.6rem 1rem',
  fontSize: '1rem',
  border: '1px solid #0a5c2b',
  borderRadius: 4,
  background: '#e6f4ea',
  color: '#0a5c2b',
  fontWeight: 600,
  cursor: 'pointer',
};

export default async function InquiriesPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; logged?: string }>;
}) {
  const [inquiries, clients] = await Promise.all([
    listOwnerInquiries(),
    listOwnerClients(),
  ]);
  const sp = await searchParams;
  const errorMsg =
    sp.error && Object.hasOwn(ERROR_MESSAGES, sp.error)
      ? ERROR_MESSAGES[sp.error]
      : null;
  const logged = sp.logged === '1';

  return (
    <main style={{ padding: '1.5rem', maxWidth: 640 }}>
      <p style={{ margin: '0 0 1rem' }}>
        <Link href="/dashboard">&larr; Dashboard</Link>
      </p>
      <h1 style={{ fontSize: '1.25rem', margin: '0 0 1rem' }}>Inquiries</h1>

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

      {logged && !errorMsg && (
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
          Inquiry logged.
        </p>
      )}

      <section style={{ marginBottom: '2rem' }}>
        <h2 style={{ fontSize: '1rem' }}>Log an inquiry</h2>
        <form action={submitInquiry} style={{ maxWidth: 360 }}>
          <label style={{ display: 'block', marginBottom: '0.75rem' }}>
            Source
            <select name="source" required defaultValue="phone" style={field}>
              {SOURCE_OPTIONS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>

          <label style={{ display: 'block', marginBottom: '1rem' }}>
            Client (optional)
            <select name="clientId" defaultValue="" style={field}>
              <option value="">— No client (anonymous) —</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} — {c.phone}
                </option>
              ))}
            </select>
          </label>

          <button type="submit" style={submitBtn}>
            Log inquiry
          </button>
        </form>
      </section>

      <section>
        <h2 style={{ fontSize: '1rem' }}>Logged inquiries ({inquiries.length})</h2>
        {inquiries.length === 0 ? (
          <p style={{ color: '#555' }}>No inquiries logged yet.</p>
        ) : (
          <table style={{ borderCollapse: 'collapse', width: '100%' }}>
            <thead>
              <tr>
                <th style={cell}>Source</th>
                <th style={cell}>Client</th>
              </tr>
            </thead>
            <tbody>
              {inquiries.map((i) => (
                <tr key={i.id}>
                  <td style={cell}>{SOURCE_LABELS[i.source] ?? i.source}</td>
                  <td style={cell}>
                    {i.clientId ? (
                      clients.find((c) => c.id === i.clientId)?.name ?? 'Client'
                    ) : (
                      <span style={{ color: '#999' }}>Anonymous</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}
