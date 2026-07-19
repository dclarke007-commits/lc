// Standalone self-serve request surface (also linked from the homepage CTA). Public
// (opened in the route guard). Renders the form + a masked banner from the redirect state.
// Styling reuses the client-temperament CSS variables already defined in app/globals.css
// (the same tokens app/book/[token]/page.tsx uses) — no hard-coded colors here.
import { RequestForm } from './RequestForm';

export const dynamic = 'force-dynamic';

const mainStyle: React.CSSProperties = { padding: '1.5rem', maxWidth: 480 };

const bannerBase: React.CSSProperties = {
  padding: '0.75rem 1rem',
  borderRadius: 'var(--radius-sm)',
  margin: '1rem 0',
  border: '1px solid var(--line)',
};

export default async function RequestPage({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string; error?: string }>;
}) {
  const sp = await searchParams;
  const banner =
    sp.sent === '1'
      ? {
          text: "Thanks — we've got your request and will be in touch to confirm a time.",
          style: { ...bannerBase, background: 'var(--success-bg)', color: 'var(--success)' },
        }
      : sp.error === 'too-many'
        ? {
            text: 'That was a lot of requests just now — please try again in a minute.',
            style: { ...bannerBase, background: 'var(--amber-bg)', color: 'var(--amber)' },
          }
        : sp.error === 'invalid'
          ? {
              text: "We couldn't submit that — please check your details and try again.",
              style: { ...bannerBase, background: 'var(--amber-bg)', color: 'var(--amber)' },
            }
          : null;

  return (
    <main style={mainStyle}>
      <h1>Request a clean</h1>
      {banner && (
        <p role="status" style={banner.style}>
          {banner.text}
        </p>
      )}
      {sp.sent === '1' ? null : <RequestForm />}
    </main>
  );
}
