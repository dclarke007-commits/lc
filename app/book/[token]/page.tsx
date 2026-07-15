// PUBLIC client booking surface — NO login (FR34, AD-6). Access is by signed,
// unguessable token only; the token itself is not resolved here in Story 1.1
// (placeholder — real booking flow arrives in Epic 3). proxy.ts leaves this open.

export const dynamic = 'force-dynamic';

export default async function BookPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return (
    <main style={{ padding: '1.5rem', maxWidth: 480 }}>
      <h1 style={{ fontSize: '1.25rem' }}>Book a cleaning</h1>
      <p style={{ color: '#555' }}>
        Public booking placeholder. Token: <code>{token}</code>
      </p>
    </main>
  );
}
