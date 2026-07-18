// Story 5.4 — lib/domain/ledger.markPaid against the Docker Postgres (serial,
// singleFork — see vitest.config). ledger is the SOLE writer of Job.payment
// (AR11); these tests exercise the domain function directly (the Server Action
// wrapper is a thin passthrough). The invariant under test: payment flips
// owed→paid, completion is NEVER touched, and only a completed job is eligible.

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '../lib/db/client';
import { operator, client, capacitySettings, job } from '../lib/db/schema';
import type { Job } from '../lib/db/schema';
import { seedOperator } from '../lib/db/seed';
import { getOwnerId } from '../lib/db/queries';
import { markPaid } from '../lib/domain/ledger';

const DATE = '2026-07-20';

let ownerId: string;
let clientId: string;

/** Insert a Job in a given completion+payment state, returning its row. */
async function insertJob(
  completion: 'booked' | 'completed' | 'no-show' | 'cancelled' = 'completed',
  payment: 'owed' | 'paid' = 'owed',
): Promise<Job> {
  const [row] = await db
    .insert(job)
    .values({
      ownerId,
      clientId,
      date: DATE,
      completion,
      payment,
      priceCents: 20000,
      idempotencyKey: randomUUID(),
      completedAt: completion === 'completed' ? new Date().toISOString() : null,
    })
    .returning();
  return row;
}

async function readJob(id: string): Promise<Job | undefined> {
  const [row] = await db
    .select()
    .from(job)
    .where(and(eq(job.ownerId, ownerId), eq(job.id, id)))
    .limit(1);
  return row;
}

describe('ledger.markPaid (Story 5.4, FR32/AR11)', () => {
  beforeAll(async () => {
    await db.execute(
      sql`truncate table ${job}, ${capacitySettings}, ${client}, ${operator} restart identity cascade`,
    );
    await seedOperator();
    ownerId = await getOwnerId();
    const [c] = await db
      .insert(client)
      .values({ ownerId, name: 'Ada Test', phone: '555-0100', cadence: 'weekly' })
      .returning();
    clientId = c.id;
  });

  beforeEach(async () => {
    await db.delete(job);
  });

  it('completed+owed → paid; completion is NEVER altered (AC1, AC2)', async () => {
    const j = await insertJob('completed', 'owed');
    const res = await markPaid(ownerId, j.id);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.payment).toBe('paid');
    expect(res.data.completion).toBe('completed'); // untouched
    const row = await readJob(j.id);
    expect(row?.payment).toBe('paid');
    expect(row?.completion).toBe('completed');
    expect(row?.completedAt).not.toBeNull();
  });

  it('already paid → idempotent no-op, returns the row (AC4)', async () => {
    const j = await insertJob('completed', 'paid');
    const res = await markPaid(ownerId, j.id);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.payment).toBe('paid');
    const row = await readJob(j.id);
    expect(row?.payment).toBe('paid');
  });

  it('booked job → not-ledger-eligible, payment unchanged (AC3)', async () => {
    const j = await insertJob('booked', 'owed');
    const res = await markPaid(ownerId, j.id);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe('not-ledger-eligible');
    const row = await readJob(j.id);
    expect(row?.payment).toBe('owed'); // nothing written
    expect(row?.completion).toBe('booked');
  });

  it('no-show job → not-ledger-eligible (AC3)', async () => {
    const j = await insertJob('no-show', 'owed');
    const res = await markPaid(ownerId, j.id);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe('not-ledger-eligible');
    expect((await readJob(j.id))?.payment).toBe('owed');
  });

  it('non-uuid id → job-not-found (no 22P02 leak)', async () => {
    const res = await markPaid(ownerId, 'not-a-uuid');
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe('job-not-found');
  });

  it('a different owner cannot pay this job (owner scoping, AD-8)', async () => {
    const j = await insertJob('completed', 'owed');
    const res = await markPaid(randomUUID(), j.id); // some other owner id
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe('job-not-found');
    expect((await readJob(j.id))?.payment).toBe('owed'); // untouched
  });
});
