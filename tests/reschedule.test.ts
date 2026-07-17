// Story 1.6 — capacity.reschedule against the Docker Postgres (serial, singleFork
// — see vitest.config). Reschedule MOVES a booked job's date atomically under the
// destination-week cap check (AD-12/AD-2/AD-3): the original slot frees, the new
// one commits, capacity is never transiently double-held or lost, and the Job
// keeps its identity. Tests the DOMAIN function directly (no next/cache).
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { and, eq, gte, lt, inArray, sql } from 'drizzle-orm';
import { db } from '../lib/db/client';
import { operator, client, capacitySettings, job } from '../lib/db/schema';
import type { Job } from '../lib/db/schema';
import { seedOperator } from '../lib/db/seed';
import { getOwnerId } from '../lib/db/queries';
import {
  commitBooking,
  consumesSlot,
  reschedule,
  CONSUMING_COMPLETIONS,
  type CommitBookingInput,
} from '../lib/domain/capacity';

// A fixed operator-local Monday and its week: [2026-07-20, 2026-07-27).
const MON = '2026-07-20';
const TUE = '2026-07-21';
const WED = '2026-07-22';
const SUN = '2026-07-26'; // in-week Sunday (weekday 7)
const NEXT_MON = '2026-07-27'; // next week
// Injected "now" so the past-date guard is deterministic (before MON).
const NOW = new Date('2026-07-15T12:00:00Z');
const PAST = '2026-07-10'; // strictly before NOW in America/Chicago

const FOREIGN_OWNER = '00000000-0000-4000-8000-000000000000';

let ownerId: string;
let clientId: string;

/** Set the owner's caps. workingDays default Mon–Sat (1..6), so SUN is off. */
async function setCaps(
  perDayCap: number,
  weeklyCeiling: number,
  workingDays: number[] = [1, 2, 3, 4, 5, 6],
): Promise<void> {
  await db.delete(capacitySettings);
  await db.insert(capacitySettings).values({
    ownerId,
    workingDays,
    perDayCap,
    weeklyCeiling,
    defaultJobPriceCents: 20000,
    timezone: 'America/Chicago',
  });
}

/** Book a consuming job on a date (via the real commitBooking). Throws on setup failure. */
async function book(
  date: string,
  over: Partial<CommitBookingInput> = {},
): Promise<Job> {
  const res = await commitBooking({
    ownerId,
    clientId,
    date,
    override: false,
    idempotencyKey: randomUUID(),
    now: NOW,
    ...over,
  });
  if (!res.ok) throw new Error(`setup booking failed: ${res.reason}`);
  return res.data;
}

/** Consuming-job count for a single day (AD-2 rule). */
async function dayCount(date: string): Promise<number> {
  const [row] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(job)
    .where(
      and(
        eq(job.ownerId, ownerId),
        eq(job.date, date),
        inArray(job.completion, [...CONSUMING_COMPLETIONS]),
      ),
    );
  return row.c;
}

/** Consuming-job count for MON's week [MON, NEXT_MON). */
async function weekCount(): Promise<number> {
  const [row] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(job)
    .where(
      and(
        eq(job.ownerId, ownerId),
        gte(job.date, MON),
        lt(job.date, NEXT_MON),
        inArray(job.completion, [...CONSUMING_COMPLETIONS]),
      ),
    );
  return row.c;
}

async function readJob(id: string): Promise<Job | undefined> {
  const [row] = await db
    .select()
    .from(job)
    .where(and(eq(job.ownerId, ownerId), eq(job.id, id)))
    .limit(1);
  return row;
}

async function totalJobs(): Promise<number> {
  const rows = await db.select().from(job);
  return rows.length;
}

describe('capacity.reschedule (Story 1.6)', () => {
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
    await setCaps(3, 14);
  });

  // --- AC2: success — original freed, new committed, net capacity conserved,
  // single row moved (identity preserved). ---
  it('moves a booked job to a new date: original freed, new committed, identity kept (AC2)', async () => {
    const j = await book(MON);
    expect(await dayCount(MON)).toBe(1);

    const res = await reschedule({ ownerId, jobId: j.id, newDate: WED, now: NOW });
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    // Same row (identity/history preserved), moved to WED, still booked.
    expect(res.data.id).toBe(j.id);
    expect(res.data.date).toBe(WED);
    expect(res.data.completion).toBe('booked');
    // Original slot freed, new slot claimed — net week capacity conserved.
    expect(await dayCount(MON)).toBe(0);
    expect(await dayCount(WED)).toBe(1);
    expect(await weekCount()).toBe(1);
    expect(await totalJobs()).toBe(1); // moved, not recreated
  });

  // --- AC2: reschedule into a FULL day → day-maxed, original untouched. ---
  it('rescheduling into a full day fails day-maxed; original slot untouched (AC2)', async () => {
    await setCaps(2, 14);
    await book(WED);
    await book(WED); // WED now at the per-day cap (2)
    const j = await book(MON);

    const res = await reschedule({ ownerId, jobId: j.id, newDate: WED, now: NOW });
    expect(res).toEqual({ ok: false, reason: 'day-maxed' });

    const row = await readJob(j.id);
    expect(row?.date).toBe(MON); // not moved
    expect(row?.completion).toBe('booked');
    expect(await dayCount(WED)).toBe(2); // no capacity gained
    expect(await dayCount(MON)).toBe(1); // no capacity lost
  });

  // --- AC2: reschedule into a FULL week → week-full, original untouched. ---
  it('rescheduling into a full week fails week-full; original untouched (AC2)', async () => {
    await setCaps(3, 2);
    await book(MON);
    await book(TUE); // MON-week now at the weekly ceiling (2)
    const j = await book(NEXT_MON); // a job in the NEXT week

    const res = await reschedule({ ownerId, jobId: j.id, newDate: WED, now: NOW });
    expect(res).toEqual({ ok: false, reason: 'week-full' });

    const row = await readJob(j.id);
    expect(row?.date).toBe(NEXT_MON); // not moved
    expect(await weekCount()).toBe(2); // MON-week unchanged
  });

  // --- Exclude-self: an intra-week move must NOT be blocked by the job's own
  // slot when the week is at the ceiling BECAUSE of that job. ---
  it('an intra-week move succeeds even when the week is at ceiling due to this job (exclude-self)', async () => {
    await setCaps(3, 1); // weekly ceiling = 1
    const j = await book(MON); // the ONLY job; week is now at ceiling

    const res = await reschedule({ ownerId, jobId: j.id, newDate: WED, now: NOW });
    expect(res.ok).toBe(true); // excluding self, week count = 0 < 1
    if (!res.ok) return;
    expect(res.data.date).toBe(WED);
    expect(await weekCount()).toBe(1); // still just the one job
  });

  // --- Idempotent no-op: moving to the date it already occupies. ---
  it('rescheduling to the same date is an idempotent no-op success', async () => {
    const j = await book(MON);
    const res = await reschedule({ ownerId, jobId: j.id, newDate: MON, now: NOW });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.id).toBe(j.id);
    expect(res.data.date).toBe(MON);
    expect(await totalJobs()).toBe(1);
  });

  // --- Availability gates apply to reschedule too. ---
  it('rescheduling onto a non-working day fails non-working-day; original untouched', async () => {
    const j = await book(MON);
    const res = await reschedule({ ownerId, jobId: j.id, newDate: SUN, now: NOW });
    expect(res).toEqual({ ok: false, reason: 'non-working-day' });
    expect((await readJob(j.id))?.date).toBe(MON);
  });

  it('rescheduling into the past fails date-past; original untouched', async () => {
    const j = await book(MON);
    const res = await reschedule({ ownerId, jobId: j.id, newDate: PAST, now: NOW });
    expect(res).toEqual({ ok: false, reason: 'date-past' });
    expect((await readJob(j.id))?.date).toBe(MON);
  });

  it('rescheduling a malformed date fails date-invalid', async () => {
    const j = await book(MON);
    const res = await reschedule({
      ownerId,
      jobId: j.id,
      newDate: '2026-02-30',
      now: NOW,
    });
    expect(res).toEqual({ ok: false, reason: 'date-invalid' });
  });

  // --- Only a BOOKED job can be moved. ---
  it('rescheduling a non-booked (cancelled) job fails not-reschedulable', async () => {
    const j = await book(MON);
    await db
      .update(job)
      .set({ completion: 'cancelled' })
      .where(eq(job.id, j.id));
    const res = await reschedule({ ownerId, jobId: j.id, newDate: WED, now: NOW });
    expect(res).toEqual({ ok: false, reason: 'not-reschedulable' });
    expect((await readJob(j.id))?.date).toBe(MON);
  });

  // --- job-not-found for bogus / non-uuid ids. ---
  it('a well-formed but unknown job id → job-not-found', async () => {
    const res = await reschedule({
      ownerId,
      jobId: randomUUID(),
      newDate: WED,
      now: NOW,
    });
    expect(res).toEqual({ ok: false, reason: 'job-not-found' });
  });

  it('a non-UUID job id → job-not-found (never a Postgres uuid error)', async () => {
    const res = await reschedule({
      ownerId,
      jobId: 'not-a-uuid',
      newDate: WED,
      now: NOW,
    });
    expect(res).toEqual({ ok: false, reason: 'job-not-found' });
  });

  // --- Cross-tenant isolation (AD-8): a foreign owner_id with a real jobId must
  // resolve to job-not-found and write nothing. ---
  it('reschedule with a foreign owner_id → job-not-found, row untouched (AD-8)', async () => {
    const j = await book(MON);
    const res = await reschedule({
      ownerId: FOREIGN_OWNER,
      jobId: j.id,
      newDate: WED,
      now: NOW,
    });
    expect(res).toEqual({ ok: false, reason: 'job-not-found' });
    const row = await readJob(j.id);
    expect(row?.date).toBe(MON); // unchanged — owner scoping held
    expect(consumesSlot(row!)).toBe(true);
  });

  // --- Review patch: an intra-week move must NOT be blocked by the weekly ceiling,
  // even when the week is OVER the ceiling (reachable via the FR39 override). ---
  it('an intra-week move succeeds inside an over-ceiling week (review patch)', async () => {
    await setCaps(3, 1); // weekly ceiling = 1
    const stay = await book(MON); // week at ceiling (1)
    await book(TUE, { override: true }); // override past the ceiling → week has 2
    expect(await weekCount()).toBe(2); // over the ceiling

    const res = await reschedule({ ownerId, jobId: stay.id, newDate: WED, now: NOW });
    expect(res.ok).toBe(true); // same-week move is capacity-neutral → allowed
    if (!res.ok) return;
    expect(res.data.date).toBe(WED);
    expect(await weekCount()).toBe(2); // membership unchanged
  });

  // --- Review patch: a successful reschedule clears a stale `overridden` flag. ---
  it('reschedule clears a stale overridden flag when moving to an under-cap slot (review patch)', async () => {
    await setCaps(3, 1); // ceiling 1
    await book(MON); // week at the ceiling
    const over = await book(TUE, { override: true }); // overridden=true (bypassed ceiling)
    expect(over.overridden).toBe(true);

    // Move the overridden job to the NEXT (empty) week — it no longer bypasses a cap.
    const res = await reschedule({
      ownerId,
      jobId: over.id,
      newDate: NEXT_MON,
      now: NOW,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.overridden).toBe(false); // stale override cleared
  });
});
