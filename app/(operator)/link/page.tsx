// Public self-serve link + QR surface (Story 4.1, FR4/FR5). Auth-gated by proxy.ts.
// Dynamic — never `use cache` (AD-13). Calls ACTIONS only (surfaces → actions →
// domain → db). Shows the ONE shareable public link and its QR (print for van/flyer/
// card), plus a Rotate control (D1 durable reissue). Phone-first, zero client JS (NFR1):
// the rotate control is a native <form> posting to a redirecting server action.

import Link from 'next/link';
import { getPublicBookingLink, rotatePublicLink } from './actions';

export const dynamic = 'force-dynamic';

// Guard the ?error lookup with Object.hasOwn: a tampered ?error=__proto__/constructor
// would otherwise resolve to a truthy inherited value and crash the render (the
// prototype-pollution class flagged in prior reviews). Only the known keys map.
const ERROR_MESSAGES: Record<string, string> = {
  'owner-unresolved': 'Could not load your account. Please try again.',
  'rotate-failed': 'Could not refresh the link. Please try again.',
};
function errorMessage(code?: string): string | undefined {
  if (!code) return undefined;
  return Object.hasOwn(ERROR_MESSAGES, code)
    ? ERROR_MESSAGES[code]
    : 'Something went wrong.';
}

const banner: React.CSSProperties = {
  padding: '0.6rem 0.8rem',
  borderRadius: 4,
  margin: '0 0 1rem',
};

export default async function PublicLinkPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; rotated?: string }>;
}) {
  const sp = await searchParams;
  const errMsg = errorMessage(sp.error);
  const result = await getPublicBookingLink();

  return (
    <main style={{ padding: '1.5rem', maxWidth: 640 }}>
      <p style={{ margin: '0 0 1rem' }}>
        <Link href="/">&larr; Dashboard</Link>
      </p>
      <h1 style={{ fontSize: '1.25rem', margin: '0 0 0.5rem' }}>
        Public booking link
      </h1>
      <p style={{ margin: '0 0 1rem', color: '#555' }}>
        Share this one link, or print the QR on your van, a flyer, or a card. Anyone
        can scan it to see your open days — no app, no account.
      </p>

      {errMsg && (
        <p role="alert" style={{ ...banner, color: '#b00020', background: '#fde8e8' }}>
          {errMsg}
        </p>
      )}

      {sp.rotated && !errMsg && (
        <p role="status" style={{ ...banner, color: '#0a5c2b', background: '#e6f4ea' }}>
          New link created — the old link and QR no longer work.
        </p>
      )}

      {!result.ok ? (
        <p role="alert" style={{ ...banner, color: '#b00020', background: '#fde8e8' }}>
          {result.reason === 'base-url-unset'
            ? 'The public link can’t be built yet — set APP_BASE_URL, then reload.'
            : result.reason === 'qr-failed'
              ? 'The link is ready but the QR code failed to render. Please reload.'
              : 'The public link isn’t available. Check PUBLIC_TOKEN_SECRET is set, then reload.'}
        </p>
      ) : (
        <>
          <label style={{ display: 'block', marginBottom: '1rem' }}>
            <span style={{ fontWeight: 600 }}>Your link</span>
            <input
              readOnly
              value={result.data.url}
              style={{
                display: 'block',
                width: '100%',
                padding: '0.6rem',
                marginTop: '0.25rem',
                fontSize: '1rem',
                boxSizing: 'border-box',
              }}
            />
          </label>

          <div
            aria-label="QR code for the public booking link"
            style={{ width: 220, marginBottom: '1rem' }}
            // Server-rendered SVG string (FR5). Trusted: produced by the qrcode lib
            // from our own URL, never user input.
            dangerouslySetInnerHTML={{ __html: result.data.qrSvg }}
          />

          <form action={rotatePublicLink}>
            <button
              type="submit"
              style={{ padding: '0.6rem 1.2rem', fontSize: '1rem' }}
            >
              Create a new link
            </button>
            <span
              style={{ display: 'block', marginTop: '0.4rem', color: '#888', fontSize: '0.85rem' }}
            >
              Use this if the link may have leaked — the current link and QR stop
              working immediately.
            </span>
          </form>
        </>
      )}
    </main>
  );
}
