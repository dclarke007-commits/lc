// (FIX 2) Single-operator invariant + deterministic owner resolution against the
// Docker Postgres. The `operator_singleton` unique index (expression index on
// `(true)`) must reject a second operator row regardless of email, and
// getOwnerId must return the seeded owner deterministically.
import { describe, it, expect, beforeAll } from 'vitest';
import { sql } from 'drizzle-orm';
import { db } from '../lib/db/client';
import { operator } from '../lib/db/schema';
import { seedOperator } from '../lib/db/seed';
import { getOwnerId } from '../lib/db/queries';

// NOTE: the DB pool is a process-wide singleton shared by every test file under
// singleFork. Do NOT end it here (see seed.test.ts).
describe('single-operator invariant (operator_singleton index)', () => {
  let seededOwnerId: string;

  beforeAll(async () => {
    await db.execute(sql`truncate table ${operator} restart identity cascade`);
    const seed = await seedOperator();
    seededOwnerId = seed.ownerId;
  });

  it('getOwnerId returns the seeded owner deterministically', async () => {
    expect(await getOwnerId()).toBe(seededOwnerId);
    // Stable across repeated reads.
    expect(await getOwnerId()).toBe(seededOwnerId);
  });

  it('rejects a second operator row with a different email (unique violation)', async () => {
    await expect(
      db
        .insert(operator)
        .values({
          email: 'second-operator@lovescleaning.test',
          passphraseHash: 'scrypt$N=16384$00$00',
        }),
    ).rejects.toThrow();

    // Still exactly one owner, and getOwnerId is unchanged.
    const rows = await db.select({ id: operator.id }).from(operator);
    expect(rows).toHaveLength(1);
    expect(await getOwnerId()).toBe(seededOwnerId);
  });
});
