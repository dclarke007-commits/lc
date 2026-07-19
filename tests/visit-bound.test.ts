// Security regression: the `visit` session-nonce field must be length-bounded like the
// other free-text public-write fields. On the tokenless /request path it is reachable
// without any token, so an unbounded value would let a scripted POST store ~1MB per row.
import { describe, it, expect } from 'vitest';
import { readPublicFields } from '../app/book/[token]/request';

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

describe('readPublicFields — visit bound', () => {
  it('rejects a visit nonce longer than MAX_FIELD (200)', () => {
    const res = readPublicFields(
      fd({ name: 'Sam', phone: '555', date: '2026-08-04', visit: 'x'.repeat(201) }),
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('visit-too-long');
  });

  it('accepts a normal-length visit nonce', () => {
    const res = readPublicFields(
      fd({ name: 'Sam', phone: '555', date: '2026-08-04', visit: 'a-normal-nonce' }),
    );
    expect(res.ok).toBe(true);
  });
});
