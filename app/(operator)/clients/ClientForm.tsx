// Shared create/edit form. Server component (RSC) — the server action is bound
// directly to <form action>, so there is no client-side JS bundle for this form.
// Phone-first: large tap targets, `type="tel"`, native required + select (NFR1).
// This is a SURFACE: it never imports lib/db — it only receives a bound action.

import type { Client } from '@/lib/db/schema';

const CADENCES = ['weekly', 'biweekly', 'monthly', 'one-time'] as const;

const field: React.CSSProperties = {
  display: 'block',
  marginBottom: '0.75rem',
};
const input: React.CSSProperties = {
  display: 'block',
  width: '100%',
  padding: '0.6rem',
  fontSize: '1rem',
  marginTop: '0.25rem',
  boxSizing: 'border-box',
};

export function ClientForm({
  action,
  client,
  submitLabel,
}: {
  // Native form action (a thin server-action wrapper around createClient /
  // editClient). The typed ActionResult is enforced inside those actions; the
  // form binding itself only needs void.
  action: (formData: FormData) => void | Promise<void>;
  client?: Client;
  submitLabel: string;
}) {
  return (
    <form action={action} style={{ maxWidth: 420 }}>
      {client ? <input type="hidden" name="id" value={client.id} /> : null}

      <label style={field}>
        Name
        <input
          style={input}
          name="name"
          type="text"
          autoComplete="name"
          defaultValue={client?.name ?? ''}
          required
        />
      </label>

      <label style={field}>
        Phone
        <input
          style={input}
          name="phone"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          defaultValue={client?.phone ?? ''}
          required
        />
      </label>

      <label style={field}>
        Address
        <input
          style={input}
          name="address"
          type="text"
          autoComplete="street-address"
          defaultValue={client?.address ?? ''}
        />
      </label>

      <label style={field}>
        Cadence
        <select
          style={input}
          name="cadence"
          defaultValue={client?.cadence ?? 'weekly'}
        >
          {CADENCES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </label>

      <button
        type="submit"
        style={{ padding: '0.7rem 1.2rem', fontSize: '1rem' }}
      >
        {submitLabel}
      </button>
    </form>
  );
}
