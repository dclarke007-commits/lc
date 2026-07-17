// Edit surface (RSC). Auth-gated by proxy.ts. Loads the owner-scoped client via
// an action (never lib/db directly) and renders the shared form bound to
// editClient. A missing/other-owner id resolves to notFound() — the owner_id
// filter makes another tenant's row unreachable (AD-8).

import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { getOwnerClient, editClient } from '../../actions';
import { clientErrorMessage } from '@/lib/domain/clientErrors';
import { ClientForm } from '../../ClientForm';

export const dynamic = 'force-dynamic';

// Thin server-action wrapper: run the typed editClient, then return to the list
// on success. On failure, redirect back to this edit page with ?error=<reason>
// so the operator sees why the save was rejected (zero client JS, NFR1).
async function saveClient(formData: FormData): Promise<void> {
  'use server';
  const result = await editClient(formData);
  if (result.ok) redirect('/clients');
  const id = String(formData.get('id') ?? '');
  redirect(`/clients/${id}/edit?error=${result.reason}`);
}

export default async function EditClientPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { id } = await params;
  const client = await getOwnerClient(id);
  if (!client) notFound();
  const errorMsg = clientErrorMessage((await searchParams).error);

  return (
    <main style={{ padding: '1.5rem', maxWidth: 640 }}>
      <p style={{ margin: '0 0 1rem' }}>
        <Link href="/clients">&larr; Clients</Link>
      </p>
      <h1 style={{ fontSize: '1.25rem', margin: '0 0 1rem' }}>
        Edit {client.name}
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
      <ClientForm action={saveClient} client={client} submitLabel="Save changes" />
    </main>
  );
}
