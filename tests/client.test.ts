// Story 1.2 — createClient / editClient Server Actions + owner_id-filtered reads.
// Exercises the REAL actions against the Docker Postgres (serial, singleFork —
// see vitest.config.ts). Do NOT end the shared pool here (see seed.test.ts).
//
// revalidatePath needs a request store that does not exist in a unit test, so
// next/cache is mocked to a no-op — it is orthogonal to the DB contract here.
import { describe, it, expect, beforeAll, vi } from 'vitest';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { sql, eq } from 'drizzle-orm';
import { db } from '../lib/db/client';
import { operator, client } from '../lib/db/schema';
import { seedOperator } from '../lib/db/seed';
import { getOwnerId, listClients, getClient } from '../lib/db/queries';
import {
  createClient,
  editClient,
} from '../app/(operator)/clients/actions';

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

const VALID = {
  name: 'Jane Regular',
  phone: '555-0100',
  address: '12 Oak St',
  cadence: 'weekly',
};

let ownerId: string;

describe('Client actions + owner-scoped reads (Story 1.2)', () => {
  beforeAll(async () => {
    // Clean slate: cascade clears client rows too (FK). Then re-seed the owner.
    await db.execute(
      sql`truncate table ${client}, ${operator} restart identity cascade`,
    );
    await seedOperator();
    ownerId = await getOwnerId();
  });

  it('createClient writes a Client with the owner_id and status=active (AC1)', async () => {
    const result = await createClient(form(VALID));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Typed data shape.
    expect(typeof result.data.id).toBe('string');
    expect(result.data.ownerId).toBe(ownerId);
    expect(result.data.status).toBe('active');
    expect(result.data.cadence).toBe('weekly');

    // Persisted with owner_id (read back directly).
    const [row] = await db
      .select()
      .from(client)
      .where(eq(client.id, result.data.id));
    expect(row.ownerId).toBe(ownerId);
    expect(row.name).toBe('Jane Regular');
    expect(row.status).toBe('active');
  });

  it('editClient updates the record (AC2)', async () => {
    const created = await createClient(
      form({ ...VALID, name: 'Before', phone: '555-0001', cadence: 'monthly' }),
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const edited = await editClient(
      form({
        id: created.data.id,
        name: 'After',
        phone: '555-0002',
        address: 'New Addr',
        cadence: 'biweekly',
      }),
    );
    expect(edited.ok).toBe(true);
    if (!edited.ok) return;
    expect(edited.data.name).toBe('After');
    expect(edited.data.phone).toBe('555-0002');
    expect(edited.data.cadence).toBe('biweekly');
    expect(edited.data.ownerId).toBe(ownerId);
  });

  it('missing name → { ok:false, reason } and nothing is written (AC3)', async () => {
    const before = (await listClients(ownerId)).length;
    const result = await createClient(
      form({ phone: '555-9999', cadence: 'weekly' }),
    );
    expect(result).toEqual({ ok: false, reason: 'name-required' });
    const after = (await listClients(ownerId)).length;
    expect(after).toBe(before);
  });

  it('missing phone → { ok:false, reason } and nothing is written (AC3)', async () => {
    const before = (await listClients(ownerId)).length;
    const result = await createClient(
      form({ name: 'No Phone', cadence: 'weekly' }),
    );
    expect(result).toEqual({ ok: false, reason: 'phone-required' });
    const after = (await listClients(ownerId)).length;
    expect(after).toBe(before);
  });

  it('editClient of a non-existent id → { ok:false } (owner-scoped UPDATE touches nothing)', async () => {
    const result = await editClient(
      form({ id: crypto.randomUUID(), ...VALID }),
    );
    expect(result).toEqual({ ok: false, reason: 'client-not-found' });
  });

  // AD-8 isolation. The `operator_singleton` index (Story 1.1) makes a second
  // real operator row impossible, so we prove the read is filtered by the
  // owner_id VALUE: a client that DOES exist is unreachable when queried under
  // any other owner_id. This is exactly "a row under a different owner_id is not
  // returned".
  it('reads are owner_id-filtered — an existing row is invisible to another owner (AC2)', async () => {
    const created = await createClient(
      form({ ...VALID, name: 'Owned Row', phone: '555-7777' }),
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const id = created.data.id;
    const otherOwner = crypto.randomUUID();

    // The real owner sees it...
    expect(await getClient(ownerId, id)).toBeDefined();
    expect((await listClients(ownerId)).some((c) => c.id === id)).toBe(true);

    // ...a different owner_id value does NOT — even knowing the exact id.
    expect(await getClient(otherOwner, id)).toBeUndefined();
    expect(await listClients(otherOwner)).toHaveLength(0);
  });
});
