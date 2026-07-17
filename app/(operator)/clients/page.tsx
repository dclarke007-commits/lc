// Client list + create surface (RSC). Auth-gated by proxy.ts (Story 1.1).
// Operator surfaces stay dynamic — never `use cache` (AD-7/AD-13): derived
// state (gone-cold, expectedNextDate) is computed on read, so caching a client
// list would serve stale derivations later. This surface calls ACTIONS only —
// it never imports lib/db (surfaces → actions → domain → db).

import Link from 'next/link';
import { redirect } from 'next/navigation';
import {
  listOwnerClientsWithLapse,
  createClient,
  getWinBackDraft,
  sendWinBack,
} from './actions';
import { clientErrorMessage } from '@/lib/domain/clientErrors';
import { deepLink } from '@/lib/delivery/deeplink';
import { ClientForm } from './ClientForm';

export const dynamic = 'force-dynamic';

// Thin server-action wrapper so the native <form action> gets a void return.
// The typed { ok, data } | { ok:false, reason } contract lives in createClient.
// On failure we redirect to ?error=<reason> so the surface can show a banner
// with zero client JS (NFR1); on success we redirect to clear any stale error.
async function addClient(formData: FormData): Promise<void> {
  'use server';
  const result = await createClient(formData);
  if (!result.ok) redirect(`/clients?error=${result.reason}`);
  redirect('/clients');
}

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

// Story 3.6 (AC1): the win-back is a HIGHLIGHTED call-to-action on a gone-cold client.
const winBackBtn: React.CSSProperties = {
  display: 'inline-block',
  padding: '0.35rem 0.7rem',
  fontSize: '0.85rem',
  border: '1px solid #8a5a00',
  borderRadius: 4,
  background: '#fff7e6',
  color: '#8a5a00',
  fontWeight: 600,
  textDecoration: 'none',
};

/**
 * The win-back panel (Story 3.6). Reads the composed check-in draft via getWinBackDraft
 * (a PURE read — the gone-cold gate lives in the action, AD-7) and renders WhatsApp/SMS
 * SEND FORMS posting to sendWinBack, so a tap logs ONE dispatched `win_back` MessageLog
 * (Story 2.3 path, idempotent per-client nonce) then opens the pre-filled chat. Reads
 * ONLY via the action — never lib/db or lib/domain.
 */
async function WinBackPanel({ clientId }: { clientId: string }) {
  const res = await getWinBackDraft(clientId);

  const panel: React.CSSProperties = {
    border: '1px solid #cbd5e1',
    background: '#f8fafc',
    borderRadius: 6,
    padding: '0.9rem 1rem',
    margin: '0 0 1.25rem',
  };

  if (!res.ok) {
    // Map the typed reason to a generic operator message; never surface a raw reason
    // code or a 500. Unknown reasons fall back to a safe generic message.
    return (
      <section style={panel} aria-label="Win-back message">
        <p role="alert" style={{ color: '#b00020', margin: 0 }}>
          {clientErrorMessage(res.reason)}
        </p>
      </section>
    );
  }

  const draft = res.data;
  // Deep-link presence is the phone-presence gate only. The actual send goes through the
  // sendWinBack POST (which recomposes the SAME body and records the dispatch) — never a
  // plain anchor, so the tap logs exactly once (Story 2.3/3.6).
  const waLink = deepLink(draft, 'whatsapp');
  const smsLink = deepLink(draft, 'sms');

  return (
    <section style={panel} aria-label="Win-back message">
      <h2 style={{ fontSize: '1rem', margin: '0 0 0.4rem' }}>
        Win-back check-in
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
          {/* Zero-JS send (Story 2.3/3.6): each control is a form POST to sendWinBack. The
              tap LOGS the dispatch ONCE (message_type = win_back, nonce winback:<clientId>)
              then redirects to the wa.me/sms deep link so the OS opens the chat pre-filled.
              A re-tap re-opens but never double-logs (idempotent per-client nonce). */}
          {(['whatsapp', 'sms'] as const).map((channel) => (
            <form key={channel} action={sendWinBack} style={{ margin: 0 }}>
              <input type="hidden" name="client" value={clientId} />
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

export default async function ClientsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; winback?: string }>;
}) {
  const clients = await listOwnerClientsWithLapse();
  const sp = await searchParams;
  const errorMsg = clientErrorMessage(sp.error);
  const winBackClientId = sp.winback?.trim() || null;

  return (
    <main style={{ padding: '1.5rem', maxWidth: 640 }}>
      <h1 style={{ fontSize: '1.25rem', margin: '0 0 1rem' }}>Clients</h1>

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

      {winBackClientId && <WinBackPanel clientId={winBackClientId} />}

      <section style={{ marginBottom: '2rem' }}>
        <h2 style={{ fontSize: '1rem' }}>Add a client</h2>
        <ClientForm action={addClient} submitLabel="Add client" />
      </section>

      <section>
        <h2 style={{ fontSize: '1rem' }}>
          Your clients ({clients.length})
        </h2>
        {clients.length === 0 ? (
          <p style={{ color: '#555' }}>No clients yet.</p>
        ) : (
          <ul style={{ listStyle: 'none', padding: 0 }}>
            {clients.map((c) => (
              <li
                key={c.id}
                style={{
                  padding: '0.6rem 0',
                  borderBottom: '1px solid #eee',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: '0.75rem',
                }}
              >
                <Link href={`/clients/${c.id}/edit`}>
                  <strong>{c.name}</strong> — {c.phone} · {c.cadence} ·{' '}
                  {/* gone-cold is the Story-3.5 DERIVED status (AD-7); it overrides the
                      stored active/provisional label when the client has lapsed. */}
                  {c.goneCold ? (
                    <span style={{ color: '#8a5a00', fontWeight: 600 }}>
                      gone-cold
                    </span>
                  ) : (
                    c.status
                  )}
                </Link>
                {c.goneCold && (
                  <Link
                    href={`/clients?winback=${encodeURIComponent(c.id)}`}
                    style={winBackBtn}
                  >
                    Win back
                  </Link>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
