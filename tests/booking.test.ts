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

let ownerId: string;
let clientId: string;

async function setCaps(perDayCap: number, weeklyCeiling: number): Promise<void> {
  await db.delete(capacitySettings);
  await db.insert(capacitySettings).values({
    ownerId,
    workingDays: [1, 2, 3, 4, 5, 6, 7],
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
});
