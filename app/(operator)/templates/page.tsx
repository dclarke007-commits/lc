// Message templates surface (RSC). Auth-gated by proxy.ts (Story 1.1). Operator
// surfaces stay dynamic — never `use cache` (AD-13). This surface calls ACTIONS
// only — it never imports lib/db (surfaces → actions → domain → db). Phone-first,
// minimal styling matching the settings/clients pages, zero client JS (NFR1):
// each template is its own <form> posting to a thin server-action wrapper that
// redirects with ?error / ?saved.

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getOwnerTemplates, saveMessageTemplate } from './actions';
import { templateErrorMessage } from '@/lib/domain/templateErrors';
import { MESSAGE_TEMPLATE_LABELS } from '@/lib/domain/messageTemplateConfig';

export const dynamic = 'force-dynamic';

const textarea: React.CSSProperties = {
  display: 'block',
  width: '100%',
  minHeight: '5rem',
  padding: '0.6rem',
  fontSize: '1rem',
  marginTop: '0.25rem',
  boxSizing: 'border-box',
  fontFamily: 'inherit',
  resize: 'vertical',
};

// Thin server-action wrapper so the native <form action> gets a void return. The
// typed { ok, data } | { ok:false, reason } contract lives in the action. On
// failure redirect to ?error=<reason>; on success ?saved=<type> so the banner can
// name which template saved (zero client JS, NFR1).
async function save(formData: FormData): Promise<void> {
  'use server';
  const result = await saveMessageTemplate(formData);
  if (!result.ok) redirect(`/templates?error=${result.reason}`);
  redirect(`/templates?saved=${result.data.type}`);
}

export default async function TemplatesPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  const templates = await getOwnerTemplates();
  const sp = await searchParams;
  const errorMsg = templateErrorMessage(sp.error);
  const savedLabel = sp.saved
    ? MESSAGE_TEMPLATE_LABELS[sp.saved as keyof typeof MESSAGE_TEMPLATE_LABELS]
    : undefined;

  return (
    <main style={{ padding: '1.5rem', maxWidth: 640 }}>
      <p style={{ margin: '0 0 1rem' }}>
        <Link href="/clients">&larr; Clients</Link>
      </p>
      <h1 style={{ fontSize: '1.25rem', margin: '0 0 0.5rem' }}>
        Message templates
      </h1>
      <p style={{ margin: '0 0 1rem', color: '#555' }}>
        Edit the outbound texts. Use{' '}
        <code>{'{client}'}</code>, <code>{'{slot}'}</code>, and{' '}
        <code>{'{amount}'}</code> — anything without a value is left blank, never
        shown as a raw tag.
      </p>

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

      {savedLabel && !errorMsg && (
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
          Saved {savedLabel}.
        </p>
      )}

      {templates.map((t) => (
        <form
          key={t.type}
          action={save}
          style={{
            maxWidth: 480,
            marginBottom: '1.5rem',
            paddingBottom: '1.5rem',
            borderBottom: '1px solid #eee',
          }}
        >
          <input type="hidden" name="type" value={t.type} />
          <label style={{ display: 'block' }}>
            <span style={{ fontWeight: 600 }}>{t.label}</span>
            <textarea
              style={textarea}
              name="body"
              defaultValue={t.body}
              required
            />
          </label>
          <button
            type="submit"
            style={{ marginTop: '0.5rem', padding: '0.6rem 1.2rem', fontSize: '1rem' }}
          >
            Save
          </button>
        </form>
      ))}
    </main>
  );
}
