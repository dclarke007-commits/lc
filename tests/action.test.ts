// (c) A Server Action returns the typed { ok, data } | { ok: false, reason } shape
// and never throws across the boundary. Exercises the real `signIn` action with
// next/headers cookies mocked (no request context in a unit test).
import { describe, it, expect, beforeAll, vi } from 'vitest';

const cookieStore = { set: vi.fn() };
vi.mock('next/headers', () => ({
  cookies: async () => cookieStore,
}));

import { db } from '../lib/db/client';
import { operator } from '../lib/db/schema';
import { sql } from 'drizzle-orm';
import { seedOperator } from '../lib/db/seed';
import { signIn } from '../app/(operator)/sign-in/actions';

const EMAIL = process.env.OPERATOR_EMAIL!;
const PASSPHRASE = process.env.OPERATOR_PASSPHRASE!;

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

describe('signIn Server Action contract (AR15)', () => {
  beforeAll(async () => {
    await db.execute(sql`truncate table ${operator} restart identity cascade`);
    await seedOperator();
  });

  it('returns { ok: true, data } on valid credentials and sets a cookie', async () => {
    const result = await signIn(form({ email: EMAIL, passphrase: PASSPHRASE }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(typeof result.data.operatorId).toBe('string');
    expect(cookieStore.set).toHaveBeenCalledOnce();
  });

  it('returns { ok: false, reason } on bad credentials — never throws', async () => {
    const result = await signIn(form({ email: EMAIL, passphrase: 'wrong' }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('invalid-credentials');
  });

  it('returns { ok: false, reason } on missing fields — never throws', async () => {
    const result = await signIn(form({}));
    expect(result).toEqual({ ok: false, reason: 'missing-credentials' });
  });
});
