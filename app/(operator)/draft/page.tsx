// Draft-preview + tap-to-send surface (RSC, Story 2.2). Auth-gated by proxy.ts.
// Dynamic — never `use cache` (AD-13). Calls ACTIONS only for data (never lib/db,
// AD-1); calls lib/delivery (a pure sibling of domain, not a db module) to render
// the deep-link. Zero client JS (NFR1): a GET form picks (client, type, slot,
// amount); the preview shows the composed body and two deep-link ANCHORS. The OS
// opens WhatsApp/SMS pre-filled ONLY when the operator taps an anchor — nothing
// sends on render or on compose (FR19, no autonomous send).
//
// This is the minimal preview seam. Story 2.4 wires the real trigger (booking
// confirmation on commit); this surface proves compose→deliver end-to-end now.

import { randomUUID } from 'node:crypto';
import Link from 'next/link';
import { listDraftClients, previewDraft, sendDraft } from './actions';
import { deepLink } from '@/lib/delivery/deeplink';
import { templateErrorMessage } from '@/lib/domain/templateErrors';
import {
  MESSAGE_TEMPLATE_TYPES,
  MESSAGE_TEMPLATE_LABELS,
} from '@/lib/domain/messageTemplateConfig';

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
const sendBtn: React.CSSProperties = {
  display: 'inline-block',
  padding: '0.7rem 1.2rem',
  fontSize: '1rem',
  border: '1px solid #0a5c2b',
  borderRadius: 4,
  background: '#fff',
  color: '#0a5c2b',
  cursor: 'pointer',
};

export default async function DraftPage({
  searchParams,
}: {
  searchParams: Promise<{
    client?: string;
    type?: string;
    slot?: string;
    amount?: string;
    error?: string;
  }>;
}) {
  const sp = await searchParams;
  const clients = await listDraftClients();

  const selectedClient = sp.client ?? '';
  const selectedType = sp.type ?? '';
  const slot = sp.slot ?? '';
  const amount = sp.amount ?? '';

  // A fresh per-render nonce identifies THIS draft (Story 2.3, Option B). Both send
  // forms below carry it; the send action keys the MessageLog row on it, so a re-tap
  // of the rendered form logs at most one dispatch.
  const nonce = randomUUID();

  let body: string | null = null;
  let waLink: string | null = null;
  let smsLink: string | null = null;
  // A failed send redirects back with ?error=<reason>; surface it server-side (NFR1).
  let errorMsg: string | null = templateErrorMessage(sp.error);

  if (selectedClient && selectedType) {
    const res = await previewDraft(selectedClient, selectedType, slot, amount);
    if (res.ok) {
      body = res.data.body;
      waLink = deepLink(res.data, 'whatsapp');
      smsLink = deepLink(res.data, 'sms');
    } else {
      errorMsg = templateErrorMessage(res.reason);
    }
  }

  return (
    <main style={{ padding: '1.5rem', maxWidth: 640 }}>
      <p style={{ margin: '0 0 1rem' }}>
        <Link href="/clients">&larr; Clients</Link>
      </p>
      <h1 style={{ fontSize: '1.25rem', margin: '0 0 0.5rem' }}>Draft a message</h1>
      <p style={{ margin: '0 0 1rem', color: '#555' }}>
        Preview the message, then tap to open it pre-filled in WhatsApp or SMS.
        Nothing sends until you tap.
      </p>

      {clients.length === 0 && (
        <p role="status" style={{ color: '#555' }}>
          No clients yet — <Link href="/clients">add one</Link> first.
        </p>
      )}

      <form method="get" action="/draft" style={{ maxWidth: 420 }}>
        <label style={field}>
          Client
          <select style={input} name="client" defaultValue={selectedClient} required>
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
          Message
          <select style={input} name="type" defaultValue={selectedType} required>
            <option value="" disabled>
              Choose a message…
            </option>
            {MESSAGE_TEMPLATE_TYPES.map((t) => (
              <option key={t} value={t}>
                {MESSAGE_TEMPLATE_LABELS[t]}
              </option>
            ))}
          </select>
        </label>

        <label style={field}>
          Slot (optional)
          <input
            style={input}
            name="slot"
            type="text"
            defaultValue={slot}
            placeholder="Tue Jul 21, 9am"
          />
        </label>

        <label style={field}>
          Amount (optional, USD)
          <input
            style={input}
            name="amount"
            type="number"
            inputMode="decimal"
            min={0}
            step={0.01}
            defaultValue={amount}
          />
        </label>

        <button type="submit" style={{ padding: '0.7rem 1.2rem', fontSize: '1rem' }}>
          Preview
        </button>
      </form>

      {errorMsg && (
        <p
          role="alert"
          style={{
            color: '#b00020',
            background: '#fde8e8',
            padding: '0.6rem 0.8rem',
            borderRadius: 4,
            margin: '1.5rem 0 0',
          }}
        >
          {errorMsg}
        </p>
      )}

      {body !== null && (
        <section style={{ marginTop: '1.5rem' }}>
          <h2 style={{ fontSize: '1rem', margin: '0 0 0.5rem' }}>Preview</h2>
          <p
            style={{
              whiteSpace: 'pre-wrap',
              background: '#f5f5f5',
              padding: '0.8rem',
              borderRadius: 4,
              margin: '0 0 1rem',
            }}
          >
            {body}
          </p>

          {waLink && smsLink ? (
            <div style={{ display: 'flex', gap: '0.75rem', margin: 0 }}>
              {/* Zero-JS send (Story 2.3): each control is a form POST. The tap logs
                  the dispatch ONCE (server action) then redirects to the deep link so
                  the OS opens WhatsApp/SMS pre-filled. Both forms carry the same
                  `nonce`, so tapping either (or re-tapping) never double-logs. */}
              {(['whatsapp', 'sms'] as const).map((channel) => (
                <form key={channel} action={sendDraft} style={{ margin: 0 }}>
                  <input type="hidden" name="client" value={selectedClient} />
                  <input type="hidden" name="type" value={selectedType} />
                  <input type="hidden" name="slot" value={slot} />
                  <input type="hidden" name="amount" value={amount} />
                  <input type="hidden" name="nonce" value={nonce} />
                  <input type="hidden" name="channel" value={channel} />
                  <button type="submit" style={sendBtn}>
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
    </main>
  );
}
