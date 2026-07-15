// Client list + create surface (RSC). Auth-gated by proxy.ts (Story 1.1).
// Operator surfaces stay dynamic — never `use cache` (AD-7/AD-13): derived
// state (gone-cold, expectedNextDate) is computed on read, so caching a client
// list would serve stale derivations later. This surface calls ACTIONS only —
// it never imports lib/db (surfaces → actions → domain → db).

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { listOwnerClients, createClient } from './actions';
import { clientErrorMessage } from '@/lib/domain/clientErrors';
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

export default async function ClientsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const clients = await listOwnerClients();
  const errorMsg = clientErrorMessage((await searchParams).error);

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
