// INTEGRATION FLOW — the operator's own booking lifecycle, end to end across MANY modules.
//
// Sequence: authenticate (the owner-resolving decision the session establishes) → create a
// client → commit a booking (per-day cap enforced under the lock) → mark the lifecycle
// outcome (completed / cancelled) → verify the DASHBOARD-derived numbers (utilization,
// month revenue, outstanding balance) reflect each transition on read. This spans the
// write path (auth → client → capacity → lifecycle → ledger) AND the read path (derive),
// which no single unit test does — those pin one function in isolation.
//
// Spans: auth/operator.authenticateOperator → clients/actions.createClient →
//   capacity.commitBooking → lifecycle.markCompleted/markCancelled → ledger.markPaid →
//   derive.{weekCapacity,roomLeft,dayMaxed,monthlyRevenue,outstanding}.
//
// BOUNDARY NOTE: the sign-in Server Action's cookie half (signIn → cookies().set) cannot
// run outside a Next request, so it is NOT callable here. We drive its authentication CORE
// (authenticateOperator — the part that resolves WHO the operator is) and assert it agrees
// with the seeded owner; the cookie write is the only step this flow cannot exercise.
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '../../lib/db/client';
import { client, job, capacitySettings, pendingRequest, inquiry, messageLog, token } from '../../lib/db/schema';
import { seedOperator } from '../../lib/db/seed';
import { getOwnerId, listJobsForMetrics, listLedgerJobs } from '../../lib/db/queries';
import { authenticateOperator } from '../../lib/auth/operator';
import { createClient } from '../../app/(operator)/clients/actions';
import { commitBooking } from '../../lib/domain/capacity';
import { markCompleted, markCancelled } from '../../lib/domain/lifecycle';
import { markPaid } from '../../lib/domain/ledger';
import {
  weekCapacity,
  roomLeft,
  dayMaxed,
  monthlyRevenue,
  outstanding,
  type DeriveJob,
} from '../../lib/domain/derive';
import type { CapacityConfig } from '../../lib/domain/capacityConfig';

// createClient calls revalidatePath from next/cache — inert-mock it (no Next request store).
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const FIXED_MONDAY = new Date('2026-07-20T12:00:00.000Z'); // → 2026-07-20 in America/Chicago
const TODAY = '2026-07-20';
const TZ = 'America/Chicago';
const OPEN_CONFIG: CapacityConfig = {
  workingDays: [1, 2, 3, 4, 5, 6, 7],
  perDayCap: 3,
  weeklyCeiling: 14,
  defaultJobPriceCents: 20000,
  timezone: TZ,
};

let ownerId: string;

/** N days after the frozen Monday (UTC) → 'YYYY-MM-DD'; N in 1..6 stays in the open week. */
function futureDate(daysAhead: number): string {
  const d = new Date(FIXED_MONDAY);
  d.setUTCDate(d.getUTCDate() + daysAhead);
  return d.toISOString().slice(0, 10);
}

function dj(rows: { date: string; completion: string }[]): DeriveJob[] {
  return rows.map((j) => ({ date: j.date, completion: j.completion }));
}

async function createActiveClient(name: string, cadence = 'weekly'): Promise<string> {
  const fd = new FormData();
  fd.set('name', name);
  fd.set('phone', '555-0100');
  fd.set('cadence', cadence);
  const res = await createClient(fd);
  if (!res.ok) throw new Error(`createClient failed: ${res.reason}`);
  return res.data.id;
}

async function jobsOn(date: string) {
  return (await db.select().from(job).where(eq(job.ownerId, ownerId))).filter(
    (j) => j.date === date,
  );
}

beforeAll(async () => {
  await seedOperator();
  ownerId = await getOwnerId();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(FIXED_MONDAY);
});

afterAll(() => {
  vi.useRealTimers();
});

beforeEach(async () => {
  await db.delete(inquiry);
  await db.delete(pendingRequest);
  await db.delete(messageLog);
  await db.delete(job);
  await db.delete(token);
  await db.delete(client);
  await db.delete(capacitySettings);
  await db.insert(capacitySettings).values({ ownerId, ...OPEN_CONFIG });
});

describe('Operator booking lifecycle — auth → create → book → outcome → dashboard', () => {
  it('auth resolves the owner, then a booking flows completed → paid with dashboard numbers tracking each step', async () => {
    // Auth core resolves the SAME owner the seed created (the cookie write is the only
    // non-callable part of the sign-in action).
    const authed = await authenticateOperator(
      process.env.OPERATOR_EMAIL!,
      process.env.OPERATOR_PASSPHRASE!,
    );
    expect(authed.ok).toBe(true);
    if (authed.ok) expect(authed.data.operatorId).toBe(ownerId);

    const clientId = await createActiveClient('Rhea Regular');
    const date = futureDate(2);

    const commit = await commitBooking({
      ownerId,
      clientId,
      date,
      override: false,
      idempotencyKey: 'flow2-a',
    });
    expect(commit.ok).toBe(true);
    if (!commit.ok) return;
    const jobId = commit.data.id;

    // Booked (not yet completed): it CONSUMES a slot, earns NO revenue, owes NOTHING
    // (a booked job is not ledger-eligible even though its payment defaults to owed).
    let mjobs = await listJobsForMetrics(ownerId);
    expect(weekCapacity(dj(mjobs), OPEN_CONFIG, TODAY).consuming).toBe(1);
    expect(roomLeft(dj(mjobs), OPEN_CONFIG, TODAY)).toBe(13);
    expect(monthlyRevenue(mjobs, new Date(), TZ).thisMonthCents).toBe(0);
    expect(outstanding(await listLedgerJobs(ownerId)).totalCents).toBe(0);

    // Complete → revenue lands in this local month AND the completed+owed job becomes an
    // outstanding balance attributed to this client.
    expect((await markCompleted(ownerId, jobId)).ok).toBe(true);
    mjobs = await listJobsForMetrics(ownerId);
    expect(monthlyRevenue(mjobs, new Date(), TZ).thisMonthCents).toBe(20000);
    const owed = outstanding(await listLedgerJobs(ownerId));
    expect(owed.totalCents).toBe(20000);
    expect(owed.clients[0].clientId).toBe(clientId);

    // Pay → outstanding clears; revenue is unchanged (revenue counts completion, not payment).
    expect((await markPaid(ownerId, jobId)).ok).toBe(true);
    expect(outstanding(await listLedgerJobs(ownerId)).totalCents).toBe(0);
    expect(monthlyRevenue(await listJobsForMetrics(ownerId), new Date(), TZ).thisMonthCents).toBe(
      20000,
    );
  });

  it('per-day cap is enforced across commits; an explicit override books past a full day and flags it', async () => {
    await db
      .update(capacitySettings)
      .set({ perDayCap: 2 })
      .where(eq(capacitySettings.ownerId, ownerId));
    const cfg: CapacityConfig = { ...OPEN_CONFIG, perDayCap: 2 };
    const clientId = await createActiveClient('Cappy Cap');
    const date = futureDate(3);

    expect((await commitBooking({ ownerId, clientId, date, override: false, idempotencyKey: 'b1' })).ok).toBe(true);
    expect((await commitBooking({ ownerId, clientId, date, override: false, idempotencyKey: 'b2' })).ok).toBe(true);

    // The third booking on the same day is rejected — the cap held, nothing was written.
    const third = await commitBooking({ ownerId, clientId, date, override: false, idempotencyKey: 'b3' });
    expect(third.ok).toBe(false);
    if (!third.ok) expect(third.reason).toBe('day-maxed');
    expect(await jobsOn(date)).toHaveLength(2);

    // The override books it (reusing the freed key) and stamps overridden=true — the FR39
    // overbooking counter-metric — and the day now reads as maxed on the dashboard.
    const forced = await commitBooking({ ownerId, clientId, date, override: true, idempotencyKey: 'b3' });
    expect(forced.ok).toBe(true);
    if (forced.ok) expect(forced.data.overridden).toBe(true);
    expect(await jobsOn(date)).toHaveLength(3);
    expect(dayMaxed(dj(await listJobsForMetrics(ownerId)), cfg, date)).toBe(true);
  });

  it('cancelling a booked job frees the slot on the very next derive — no stored counter to decrement', async () => {
    const clientId = await createActiveClient('Wanda Wobble');
    const date = futureDate(4);
    const commit = await commitBooking({
      ownerId,
      clientId,
      date,
      override: false,
      idempotencyKey: 'c1',
    });
    expect(commit.ok).toBe(true);
    if (!commit.ok) return;
    expect(roomLeft(dj(await listJobsForMetrics(ownerId)), OPEN_CONFIG, TODAY)).toBe(13);

    // cancelled does not consume → the slot is released; the next read shows full room.
    expect((await markCancelled(ownerId, commit.data.id)).ok).toBe(true);
    const mjobs = await listJobsForMetrics(ownerId);
    expect(roomLeft(dj(mjobs), OPEN_CONFIG, TODAY)).toBe(14);
    expect(weekCapacity(dj(mjobs), OPEN_CONFIG, TODAY).consuming).toBe(0);
  });
});
