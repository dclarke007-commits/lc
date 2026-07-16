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
  markCancelled,
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

  // --- Story 1.6 (D2): resurrection back to `booked` is now CLOSED. It used to
  // re-consume a slot with NO cap/ceiling recheck (keystone bug); both paths are
  // now illegal-transition and write nothing. ---
  it('no-show→booked resurrection is illegal (D2 closed, Story 1.6)', async () => {
    const j = await insertJob('no-show');
    const result = await correctOutcome(ownerId, j.id, 'booked');
    expect(result).toEqual({ ok: false, reason: 'illegal-transition' });
    expect((await readJob(j.id))?.completion).toBe('no-show'); // untouched
  });

  it('cancelled→booked resurrection is illegal (D2 closed, Story 1.6)', async () => {
    const j = await insertJob('cancelled');
    const result = await correctOutcome(ownerId, j.id, 'booked');
    expect(result).toEqual({ ok: false, reason: 'illegal-transition' });
    expect((await readJob(j.id))?.completion).toBe('cancelled'); // untouched
  });

  // --- Story 1.6 (D1): completed→booked is NOT AD-10-legal — rejected, unchanged. ---
  it('completed→booked correction is illegal (D1 closed, AD-10 quote-exact)', async () => {
    const j = await insertJob('completed');
    const before = await readJob(j.id);
    const result = await correctOutcome(ownerId, j.id, 'booked');
    expect(result).toEqual({ ok: false, reason: 'illegal-transition' });
    const row = await readJob(j.id);
    expect(row?.completion).toBe('completed'); // untouched
    expect(row?.completedAt).toBe(before?.completedAt);
  });

  // --- Story 1.6 (Task 1): cancel a booked job → cancelled, frees the slot. ---
  it('markCancelled booked→cancelled frees the slot, keeps completed_at null (Task 1)', async () => {
    const j = await insertJob('booked');
    const result = await markCancelled(ownerId, j.id);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.completion).toBe('cancelled');
    expect(result.data.completedAt).toBeNull();
    // cancelled does NOT consume — the slot frees automatically (AD-2/AD-7).
    expect(consumesSlot(result.data)).toBe(false);
  });

  it('markCancelled on a no-show → illegal-transition, row unchanged (Task 1)', async () => {
    const j = await insertJob('no-show');
    const result = await markCancelled(ownerId, j.id);
    expect(result).toEqual({ ok: false, reason: 'illegal-transition' });
    expect((await readJob(j.id))?.completion).toBe('no-show'); // untouched
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

  // --- Cross-tenant isolation (AD-8 tenancy seam). The `operator_singleton`
  // index physically forbids a real second operator, so we can't seed tenant B;
  // instead we assert the owner_id FILTER directly. FOREIGN_OWNER is a
  // well-formed UUID (passes the UUID guard) that is NOT the seeded owner, so the
  // owner-scoped WHERE — not the regex — is what must reject it. A leaked/guessed
  // jobId from tenant A must be invisible to a caller presenting a different
  // owner_id: job-not-found, and NOTHING written. ---
  const FOREIGN_OWNER = '00000000-0000-4000-8000-000000000000';

  it('markCompleted with a foreign owner_id → job-not-found, row untouched (AD-8)', async () => {
    const j = await insertJob('booked');
    const result = await markCompleted(FOREIGN_OWNER, j.id);
    expect(result).toEqual({ ok: false, reason: 'job-not-found' });
    const row = await readJob(j.id); // re-read as the REAL owner
    expect(row?.completion).toBe('booked'); // unchanged — owner scoping held
    expect(row?.completedAt).toBeNull();
  });

  it('correctOutcome with a foreign owner_id → job-not-found, row untouched (AD-8)', async () => {
    const j = await insertJob('completed');
    const before = await readJob(j.id);
    const result = await correctOutcome(FOREIGN_OWNER, j.id, 'cancelled');
    expect(result).toEqual({ ok: false, reason: 'job-not-found' });
    const row = await readJob(j.id);
    expect(row?.completion).toBe('completed'); // unchanged
    expect(row?.completedAt).toBe(before?.completedAt); // timestamp untouched
  });
});
