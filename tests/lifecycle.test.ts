// Story 1.5 — lib/domain/lifecycle against the Docker Postgres (serial, singleFork
// — see vitest.config). lifecycle is the SOLE writer of Job.completion (AD-10);
// these tests exercise the domain functions directly (no next/cache), since that
// is where the state-machine logic lives. The Server Action wrapper is a thin
// passthrough.
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '../lib/db/client';
import { operator, client, capacitySettings, job } from '../lib/db/schema';
import type { Job } from '../lib/db/schema';
import { seedOperator } from '../lib/db/seed';
import { getOwnerId } from '../lib/db/queries';
import { consumesSlot } from '../lib/domain/capacity';
import {
  markCompleted,
  markNoShow,
  correctOutcome,
} from '../lib/domain/lifecycle';

const DATE = '2026-07-20';

let ownerId: string;
let clientId: string;

/** Insert a Job directly in a given completion state, returning its row. */
async function insertJob(
  completion: 'booked' | 'completed' | 'no-show' | 'cancelled' = 'booked',
): Promise<Job> {
  const [row] = await db
    .insert(job)
    .values({
      ownerId,
      clientId,
      date: DATE,
      completion,
      priceCents: 20000,
      idempotencyKey: randomUUID(),
      completedAt: completion === 'completed' ? new Date().toISOString() : null,
    })
    .returning();
  return row;
}

/** Re-read a job by id (owner-scoped) for assertions. */
async function readJob(id: string): Promise<Job | undefined> {
  const [row] = await db
    .select()
    .from(job)
    .where(and(eq(job.ownerId, ownerId), eq(job.id, id)))
    .limit(1);
  return row;
}

describe('lifecycle state machine (Story 1.5)', () => {
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

  // --- AC1: booked → completed sets completion + a non-null completed_at ---
  it('booked→completed sets completion and a non-null completed_at (AC1)', async () => {
    const j = await insertJob('booked');
    const result = await markCompleted(ownerId, j.id);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.completion).toBe('completed');
    expect(result.data.completedAt).not.toBeNull();
    const row = await readJob(j.id);
    expect(row?.completion).toBe('completed');
    expect(row?.completedAt).not.toBeNull();
  });

  // --- AC2: booked → no-show sets completion, completed_at null, still consumes ---
  it('booked→no-show sets completion, keeps completed_at null, still consumes a slot (AC2)', async () => {
    const j = await insertJob('booked');
    const result = await markNoShow(ownerId, j.id);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.completion).toBe('no-show');
    expect(result.data.completedAt).toBeNull();
    // no-show STILL consumes the slot — it must never release capacity (FR40).
    expect(consumesSlot(result.data)).toBe(true);
  });

  // --- AC3: illegal NORMAL marks on a terminal state → rejected, row unchanged ---
  it('markCompleted on a no-show → illegal-transition, row unchanged (AC3)', async () => {
    const j = await insertJob('no-show');
    const result = await markCompleted(ownerId, j.id);
    expect(result).toEqual({ ok: false, reason: 'illegal-transition' });
    const row = await readJob(j.id);
    expect(row?.completion).toBe('no-show'); // untouched
    expect(row?.completedAt).toBeNull();
  });

  it('markNoShow on a completed → illegal-transition, row unchanged (AC3)', async () => {
    const j = await insertJob('completed');
    const before = await readJob(j.id);
    const result = await markNoShow(ownerId, j.id);
    expect(result).toEqual({ ok: false, reason: 'illegal-transition' });
    const row = await readJob(j.id);
    expect(row?.completion).toBe('completed'); // untouched
    expect(row?.completedAt).toBe(before?.completedAt); // timestamp untouched
  });

  // --- AC3 correction: completed → cancelled frees the slot (consumesSlot false) ---
  it('correction completed→cancelled frees the slot and clears completed_at (AC3)', async () => {
    const j = await insertJob('completed');
    const result = await correctOutcome(ownerId, j.id, 'cancelled');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.completion).toBe('cancelled');
    // cancelled does NOT consume — the slot is freed automatically (AD-2/AD-10).
    expect(consumesSlot(result.data)).toBe(false);
    // Leaving completed clears its timestamp.
    expect(result.data.completedAt).toBeNull();
  });

  // --- AC3 correction: resurrecting a terminal state back to booked is legal ---
  it('correction no-show→booked is legal (AC3)', async () => {
    const j = await insertJob('no-show');
    const result = await correctOutcome(ownerId, j.id, 'booked');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.completion).toBe('booked');
    expect(result.data.completedAt).toBeNull();
  });

  it('correction cancelled→booked is legal (AC3)', async () => {
    const j = await insertJob('cancelled');
    const result = await correctOutcome(ownerId, j.id, 'booked');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.completion).toBe('booked');
  });

  // --- AC3: an illegal correction target is rejected, nothing written ---
  it('an illegal correction target (no-show→completed) is rejected (AC3)', async () => {
    const j = await insertJob('no-show');
    const result = await correctOutcome(ownerId, j.id, 'completed');
    expect(result).toEqual({ ok: false, reason: 'illegal-transition' });
    const row = await readJob(j.id);
    expect(row?.completion).toBe('no-show'); // untouched
  });

  it('a nonsense correction target is rejected as illegal-transition', async () => {
    const j = await insertJob('completed');
    const result = await correctOutcome(ownerId, j.id, 'banana');
    expect(result).toEqual({ ok: false, reason: 'illegal-transition' });
    const row = await readJob(j.id);
    expect(row?.completion).toBe('completed'); // untouched
  });

  // --- job-not-found for a bogus (real-uuid) and a non-uuid id ---
  it('a well-formed but unknown job id → job-not-found', async () => {
    const result = await markCompleted(ownerId, randomUUID());
    expect(result).toEqual({ ok: false, reason: 'job-not-found' });
  });

  it('a non-UUID job id → job-not-found (never a Postgres uuid error)', async () => {
    const result = await markCompleted(ownerId, 'not-a-uuid');
    expect(result).toEqual({ ok: false, reason: 'job-not-found' });
  });

  it('a correction on a non-UUID job id → job-not-found', async () => {
    const result = await correctOutcome(ownerId, 'not-a-uuid', 'booked');
    expect(result).toEqual({ ok: false, reason: 'job-not-found' });
  });
});
