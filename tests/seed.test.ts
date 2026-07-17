// (b) Seed idempotency against the Docker Postgres: running the seed twice yields
// EXACTLY ONE owner row (AD-8). Requires `docker compose up` + migrations applied.
import { describe, it, expect, beforeAll } from 'vitest';
import { sql } from 'drizzle-orm';
import { db } from '../lib/db/client';
import { operator } from '../lib/db/schema';
import { seedOperator } from '../lib/db/seed';

// NOTE: the DB pool is a process-wide singleton shared by every test file under
// singleFork. Do NOT end it here — vitest terminates the worker when the run
// finishes. Ending it per-file poisons whichever DB file runs next.
describe('operator seed idempotency', () => {
  beforeAll(async () => {
    // Start from a clean owner table so the count assertion is unambiguous.
    await db.execute(sql`truncate table ${operator} restart identity cascade`);
  });

  it('creates exactly one owner row and never a second on re-run', async () => {
    const first = await seedOperator();
    expect(first.created).toBe(true);

    const second = await seedOperator();
    expect(second.created).toBe(false);
    expect(second.ownerId).toBe(first.ownerId);

    const rows = await db.select({ id: operator.id }).from(operator);
    expect(rows).toHaveLength(1);
  });
});
