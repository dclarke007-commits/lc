// Client list + create surface (RSC). Auth-gated by proxy.ts (Story 1.1).
// Operator surfaces stay dynamic — never `use cache` (AD-7/AD-13): derived
// state (gone-cold, expectedNextDate) is computed on read, so caching a client
// list would serve stale derivations later. This surface calls ACTIONS only —
// it never imports lib/db (surfaces → actions → domain → db).

import Link from 'next/link';
import { listOwnerClients, createClient } from './actions';
import { ClientForm } from './ClientForm';

export const dynamic = 'force-dynamic';

// Thin server-action wrapper so the native <form action> gets a void return.
// The typed { ok, data } | { ok:false, reason } contract lives in createClient.
async function addClient(formData: FormData): Promise<void> {
  'use server';
  await createClient(formData);
}

export default async function ClientsPage() {
  const clients = await listOwnerClients();

  return (
    <main style={{ padding: '1.5rem', maxWidth: 640 }}>
      <h1 style={{ fontSize: '1.25rem', margin: '0 0 1rem' }}>Clients</h1>

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
                }}
              >
                <Link href={`/clients/${c.id}/edit`}>
                  <strong>{c.name}</strong> — {c.phone} · {c.cadence} ·{' '}
                  {c.status}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
