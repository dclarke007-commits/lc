// Edit surface (RSC). Auth-gated by proxy.ts. Loads the owner-scoped client via
// an action (never lib/db directly) and renders the shared form bound to
// editClient. A missing/other-owner id resolves to notFound() — the owner_id
// filter makes another tenant's row unreachable (AD-8).

import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { getOwnerClient, editClient } from '../../actions';
import { ClientForm } from '../../ClientForm';

export const dynamic = 'force-dynamic';

// Thin server-action wrapper: run the typed editClient, then return to the list
// on success. The { ok, data } | { ok:false, reason } contract lives in the action.
async function saveClient(formData: FormData): Promise<void> {
  'use server';
  const result = await editClient(formData);
  if (result.ok) redirect('/clients');
}

export default async function EditClientPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const client = await getOwnerClient(id);
  if (!client) notFound();

  return (
    <main style={{ padding: '1.5rem', maxWidth: 640 }}>
      <p style={{ margin: '0 0 1rem' }}>
        <Link href="/clients">&larr; Clients</Link>
      </p>
      <h1 style={{ fontSize: '1.25rem', margin: '0 0 1rem' }}>
        Edit {client.name}
      </h1>
      <ClientForm action={saveClient} client={client} submitLabel="Save changes" />
    </main>
  );
}
