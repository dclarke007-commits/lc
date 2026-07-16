// Story 1.4 — capacity.commitBooking + consumesSlot against the Docker Postgres
// (serial, singleFork — see vitest.config). The keystone: cap re-check inside one
// transaction, the day-scoped advisory lock proving exactly-one-winner under
// concurrency (AD-3), typed reasons, override, and idempotency (AD-12).
//
// Tests the DOMAIN function directly (no next/cache), since that is where the
// AD-2/AD-3/AD-12 logic lives; the Server Action wrapper is a thin passthrough.
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { db } from '../lib/db/client';
import { operator, client, capacitySettings, job } from '../lib/db/schema';
import { seedOperator } from '../lib/db/seed';
import { getOwnerId } from '../lib/db/queries';
import {
  commitBooking,
  consumesSlot,
  type CommitBookingInput,
} from '../lib/domain/capacity';

// A fixed operator-local Monday and its week: [2026-07-20, 2026-07-27).
const MON = '2026-07-20';
const TUE = '2026-07-21';
const WED = '2026-07-22';
const THU = '2026-07-23';
// Injected "now" so the past-date guard is deterministic (before MON). All test
// dates above are strictly after this instant in America/Chicago.
const NOW = new Date('2026-07-15T12:00:00Z');

let ownerId: string;
let clientId: string;

async function setCaps(
  perDayCap: number,
  weeklyCeiling: number,
  workingDays: number[] = [1, 2, 3, 4, 5, 6, 7],
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

function input(over: Partial<CommitBookingInput> = {}): CommitBookingInput {
  return {
    ownerId,
    clientId,
    date: MON,
    override: false,
    idempotencyKey: randomUUID(),
    now: NOW,
    ...over,
  };
}

async function jobCount(): Promise<number> {
  const rows = await db.select().from(job);
  return rows.length;
}

describe('capacity.commitBooking + consumesSlot (Story 1.4)', () => {
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
    // Fresh slate per test: clear jobs + caps, keep operator + client.
    await db.delete(job);
    await db.delete(capacitySettings);
  });

  // --- AC5: consumesSlot predicate table (pure) ---
  it('consumesSlot: booked/completed/no-show consume, cancelled does not (AC5)', () => {
    expect(consumesSlot({ completion: 'booked' })).toBe(true);
    expect(consumesSlot({ completion: 'completed' })).toBe(true);
    expect(consumesSlot({ completion: 'no-show' })).toBe(true);
    expect(consumesSlot({ completion: 'cancelled' })).toBe(false);
  });

  // --- AC1: room → inserts a booked Job in the transaction ---
  it('books a Job when there is room; defaults price from config, overridden=false (AC1)', async () => {
    await setCaps(3, 14);
    const result = await commitBooking(input());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.completion).toBe('booked');
    expect(result.data.overridden).toBe(false);
    expect(result.data.priceCents).toBe(20000); // config default (AR16)
    expect(result.data.date).toBe(MON);
    expect(await jobCount()).toBe(1);
  });

  // --- AC2: per-day cap rejected with a machine reason, nothing written ---
  it('rejects with day-maxed when the per-day cap is full; writes nothing (AC2)', async () => {
    await setCaps(2, 14);
    expect((await commitBooking(input())).ok).toBe(true);
    expect((await commitBooking(input())).ok).toBe(true);
    const before = await jobCount();
    const result = await commitBooking(input());
    expect(result).toEqual({ ok: false, reason: 'day-maxed' });
    expect(await jobCount()).toBe(before); // no silent overbook
  });

  // --- AC2: weekly-14 ceiling rejected with week-full (day not maxed) ---
  it('rejects with week-full when the weekly ceiling is hit; writes nothing (AC2)', async () => {
    // per-day 5 (roomy), week ceiling 3 → the week fills before any day maxes.
    await setCaps(5, 3);
    expect((await commitBooking(input({ date: MON }))).ok).toBe(true);
    expect((await commitBooking(input({ date: TUE }))).ok).toBe(true);
    expect((await commitBooking(input({ date: WED }))).ok).toBe(true);
    const before = await jobCount();
    const result = await commitBooking(input({ date: THU }));
    expect(result).toEqual({ ok: false, reason: 'week-full' });
    expect(await jobCount()).toBe(before);
  });

  // --- AC3: override commits past a full cap with overridden=true ---
  it('override books past a full day and records overridden=true (AC3)', async () => {
    await setCaps(1, 14);
    expect((await commitBooking(input())).ok).toBe(true);
    // Without override this would be day-maxed; with override it commits.
    const result = await commitBooking(input({ override: true }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.overridden).toBe(true);
    expect(await jobCount()).toBe(2);
  });

  it('override on a booking that was NOT over cap does not flag overridden', async () => {
    await setCaps(3, 14);
    const result = await commitBooking(input({ override: true }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Room existed → the flag did not bypass anything → not counted as override.
    expect(result.data.overridden).toBe(false);
  });

  // --- AD-12: idempotent per booking attempt ---
  it('a repeat submit with the same idempotency key returns the same Job (AD-12)', async () => {
    await setCaps(3, 14);
    const key = randomUUID();
    const first = await commitBooking(input({ idempotencyKey: key }));
    const second = await commitBooking(input({ idempotencyKey: key }));
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.data.id).toBe(first.data.id); // same Job, never a second
    expect(await jobCount()).toBe(1);
  });

  it('rejects a booking for a client that is not the owner’s', async () => {
    await setCaps(3, 14);
    const result = await commitBooking(input({ clientId: randomUUID() }));
    expect(result).toEqual({ ok: false, reason: 'client-not-found' });
    expect(await jobCount()).toBe(0);
  });

  // --- AC4: exactly-one-winner concurrency (the whole point of AD-3) ---
  it('two concurrent claims on the last slot → exactly one wins (AC4)', async () => {
    await setCaps(1, 14); // one slot on MON
    const [a, b] = await Promise.all([
      commitBooking(input()),
      commitBooking(input()),
    ]);
    const wins = [a, b].filter((r) => r.ok).length;
    const losses = [a, b].filter((r) => !r.ok).length;
    expect(wins).toBe(1);
    expect(losses).toBe(1);
    // The loser got a capacity reason, not a crash.
    const loser = [a, b].find((r) => !r.ok);
    expect(loser && !loser.ok && loser.reason).toBe('day-maxed');
    expect(await jobCount()).toBe(1); // never two rows for one slot
  });

  it('a 5-way burst on a single slot yields exactly one winner (AC4)', async () => {
    await setCaps(1, 14);
    const results = await Promise.all(
      Array.from({ length: 5 }, () => commitBooking(input())),
    );
    expect(results.filter((r) => r.ok).length).toBe(1);
    expect(results.filter((r) => !r.ok).length).toBe(4);
    expect(await jobCount()).toBe(1);
  });

  // --- AC4 regression: the WEEKLY ceiling must serialize across DIFFERENT days
  // of the same week. With a per-day lock this raced (two different-day claims
  // took different locks); the week-monday lock fixes it. Roomy per-day (5) so
  // only the weekly ceiling (1) can bite. ---
  it('two concurrent claims on the last WEEK slot (different days) → exactly one wins (AC4)', async () => {
    await setCaps(5, 1); // one slot in the whole Mon–Sun week
    const [a, b] = await Promise.all([
      commitBooking(input({ date: TUE })),
      commitBooking(input({ date: WED })),
    ]);
    expect([a, b].filter((r) => r.ok).length).toBe(1);
    const loser = [a, b].find((r) => !r.ok);
    expect(loser && !loser.ok && loser.reason).toBe('week-full');
    expect(await jobCount()).toBe(1); // never two rows past the weekly ceiling
  });

  // --- New validation gates (code review) ---
  it('rejects a well-formed-but-invalid date with date-invalid (not booking-failed)', async () => {
    await setCaps(3, 14);
    const result = await commitBooking(input({ date: '2026-02-30' }));
    expect(result).toEqual({ ok: false, reason: 'date-invalid' });
    expect(await jobCount()).toBe(0);
  });

  it('rejects a booking on a non-working day', async () => {
    // Working days Mon–Fri only; MON is 2026-07-20 (Mon) is fine, so use a
    // Saturday (2026-07-25) which is excluded.
    await setCaps(3, 14, [1, 2, 3, 4, 5]);
    const result = await commitBooking(input({ date: '2026-07-25' }));
    expect(result).toEqual({ ok: false, reason: 'non-working-day' });
    expect(await jobCount()).toBe(0);
  });

  it('rejects a date already past in the operator timezone', async () => {
    await setCaps(3, 14);
    // NOW is 2026-07-15 local; 2026-07-10 is strictly earlier.
    const result = await commitBooking(input({ date: '2026-07-10' }));
    expect(result).toEqual({ ok: false, reason: 'date-past' });
    expect(await jobCount()).toBe(0);
  });

  it('replaying an idempotency key with a different date is a conflict, not a stale Job', async () => {
    await setCaps(3, 14);
    const key = randomUUID();
    const first = await commitBooking(input({ date: MON, idempotencyKey: key }));
    expect(first.ok).toBe(true);
    // Same key, different date → must NOT silently return the MON job.
    const second = await commitBooking(input({ date: TUE, idempotencyKey: key }));
    expect(second).toEqual({ ok: false, reason: 'booking-conflict' });
    expect(await jobCount()).toBe(1);
  });

  it('a non-UUID clientId is rejected as client-not-found (not booking-failed)', async () => {
    await setCaps(3, 14);
    const result = await commitBooking(input({ clientId: 'not-a-uuid' }));
    expect(result).toEqual({ ok: false, reason: 'client-not-found' });
    expect(await jobCount()).toBe(0);
  });
});
