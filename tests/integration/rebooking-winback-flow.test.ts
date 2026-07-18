// INTEGRATION FLOW — the win-back → rebooking loop, end to end across MANY modules.
//
// Sequence: a completed job leaves a lapse basis → the client goes gone-cold → the operator
// composes a win_back draft (win-back derive + compose) → taps send (ONE dispatched
// MessageLog row, idempotent) → the client rebooks via their per-client token (book/[token]
// → the sole capacity insert) → a NEW booked Job appears → the future booking closes the
// lapse (derive re-fires: no longer cold) → lifecycle completes the rebooked job. This spans
// lifecycle → gone-cold derive → compose/dispatch → token booking → derive again, which no
// single unit test does.
//
// Spans: lifecycle basis → derive.goneCold/expectedNextDate (via clients/actions.getWinBackDraft)
//   → compose + draft/actions.recordDispatch (via clients/actions.sendWinBack) →
//   booking.ensureClientToken → app/book/[token]/confirm.confirmBookingResult (→ commitBooking)
//   → lifecycle.markCompleted.
//
// NOTE (basis): commitBooking legitimately refuses past dates, so the HISTORICAL completed
// job that establishes the lapse basis is inserted directly (a real past fact) — the same
// approach tests/win-back.test.ts uses. sendWinBack redirects on success (throws
// NEXT_REDIRECT); we catch the digest rather than mocking next/navigation, so the real
// deep-link redirect is exercised.
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { db } from '../../lib/db/client';
import { client, job, capacitySettings, pendingRequest, inquiry, messageLog, token } from '../../lib/db/schema';
import { seedOperator } from '../../lib/db/seed';
import { getOwnerId, listJobsForMetrics } from '../../lib/db/queries';
import { getWinBackDraft, sendWinBack } from '../../app/(operator)/clients/actions';
import { ensureClientToken } from '../../lib/domain/booking';
import { confirmBookingResult } from '../../app/book/[token]/confirm';
import { markCompleted } from '../../lib/domain/lifecycle';
import { roomLeft, type DeriveJob } from '../../lib/domain/derive';
import type { CapacityConfig } from '../../lib/domain/capacityConfig';

const FIXED_MONDAY = new Date('2026-07-20T12:00:00.000Z'); // → 2026-07-20 in America/Chicago
const TODAY = '2026-07-20';
const OPEN_CONFIG: CapacityConfig = {
  workingDays: [1, 2, 3, 4, 5, 6, 7],
  perDayCap: 3,
  weeklyCeiling: 14,
  defaultJobPriceCents: 20000,
  timezone: 'America/Chicago',
};

let ownerId: string;

function futureDate(daysAhead: number): string {
  const d = new Date(FIXED_MONDAY);
  d.setUTCDate(d.getUTCDate() + daysAhead);
  return d.toISOString().slice(0, 10);
}

async function insertClient(name: string, phone: string, cadence = 'weekly'): Promise<string> {
  const [row] = await db
    .insert(client)
    .values({ ownerId, name, phone, cadence: cadence as 'weekly' })
    .returning();
  return row.id;
}

/** A COMPLETED job in the past — the lapse basis (commitBooking can't create past dates). */
async function insertCompletedJob(clientId: string, date: string): Promise<void> {
  await db.insert(job).values({
    ownerId,
    clientId,
    date,
    completion: 'completed',
    completedAt: `${date}T18:00:00.000Z`,
    priceCents: 20000,
    idempotencyKey: `done-${clientId}-${date}`,
  });
}

/** Dispatched win_back MessageLog rows for a client (per-cold-spell nonce; match by type). */
async function winBackLogs(clientId: string) {
  return db
    .select()
    .from(messageLog)
    .where(
      and(
        eq(messageLog.ownerId, ownerId),
        eq(messageLog.clientId, clientId),
        eq(messageLog.messageType, 'win_back'),
      ),
    );
}

/** Drive the redirecting sendWinBack action and return the NEXT_REDIRECT digest string. */
async function callSend(clientId: string, channel = 'whatsapp'): Promise<string> {
  const fd = new FormData();
  fd.set('client', clientId);
  fd.set('channel', channel);
  try {
    await sendWinBack(fd);
  } catch (e) {
    const digest = (e as { digest?: string })?.digest;
    if (typeof digest === 'string' && digest.startsWith('NEXT_REDIRECT')) return digest;
    throw e;
  }
  throw new Error('sendWinBack did not redirect');
}

async function jobCount(): Promise<number> {
  return (await db.select().from(job).where(eq(job.ownerId, ownerId))).length;
}

async function deriveJobs(): Promise<DeriveJob[]> {
  return (await listJobsForMetrics(ownerId)).map((j) => ({
    date: j.date,
    completion: j.completion,
  }));
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

describe('Rebooking / win-back flow — cold → draft → dispatch → token rebook → warm', () => {
  it('gone-cold client: win-back draft → ONE dispatch → rebooks via token → new Job → no longer cold → completed', async () => {
    // weekly, last completed 2026-07-01 → expected 07-08 → today 07-20 → gone-cold.
    const clientId = await insertClient('Cold Clara', '+15551230001', 'weekly');
    await insertCompletedJob(clientId, '2026-07-01');

    // 1) Win-back derive + compose. Composing dispatches NOTHING (compose ≠ deliver).
    const draft = await getWinBackDraft(clientId);
    expect(draft.ok).toBe(true);
    if (draft.ok) {
      expect(draft.data.type).toBe('win_back');
      expect(draft.data.body).toContain('Clara'); // {client} resolved
      expect(draft.data.body).not.toMatch(/[{}]/); // no unresolved placeholder / {token} leak
    }
    expect(await winBackLogs(clientId)).toHaveLength(0);

    // 2) Send tap: ONE dispatched win_back row, and NO Job — a nudge is not a booking.
    const digest = await callSend(clientId);
    expect(digest).toContain('wa.me');
    expect(await winBackLogs(clientId)).toHaveLength(1);
    expect(await jobCount()).toBe(1); // still only the historical completed job

    // A re-tap within the same cold spell is idempotent — still exactly one dispatch row.
    await callSend(clientId);
    expect(await winBackLogs(clientId)).toHaveLength(1);

    // 3) The client rebooks via their per-client booking token → the SECOND (real) Job.
    const tok = await ensureClientToken(ownerId, clientId);
    const date = futureDate(2);
    const rebook = await confirmBookingResult(tok, date);
    expect(rebook.ok).toBe(true);
    if (!rebook.ok) return;
    expect(rebook.data.completion).toBe('booked');
    expect(rebook.data.date).toBe(date);
    expect(await jobCount()).toBe(2);

    // 4) The future booking closes the lapse — the SAME derive now refuses the win-back.
    const after = await getWinBackDraft(clientId);
    expect(after.ok).toBe(false);
    if (!after.ok) expect(after.reason).toBe('not-gone-cold');

    // 5) Lifecycle completes the rebooked job — the loop's next basis.
    expect((await markCompleted(ownerId, rebook.data.id)).ok).toBe(true);
    const [done] = await db.select().from(job).where(eq(job.id, rebook.data.id));
    expect(done.completion).toBe('completed');
  });

  it('a win-back dispatch neither books nor holds capacity — a slot is consumed only when the client uses the token', async () => {
    const clientId = await insertClient('Cold Cody', '+15551230006', 'weekly');
    await insertCompletedJob(clientId, '2026-07-01'); // basis is outside the current week

    const before = roomLeft(await deriveJobs(), OPEN_CONFIG, TODAY);
    expect(before).toBe(14); // the past completed job is not in this week's count

    await callSend(clientId);
    // Dispatch logged, but capacity is untouched (a nudge holds no slot) and no request/Job.
    expect(await winBackLogs(clientId)).toHaveLength(1);
    expect(roomLeft(await deriveJobs(), OPEN_CONFIG, TODAY)).toBe(before);
    expect(await jobCount()).toBe(1);

    // Acting on the link is the ONLY thing that consumes a slot.
    const tok = await ensureClientToken(ownerId, clientId);
    const date = futureDate(3);
    expect((await confirmBookingResult(tok, date)).ok).toBe(true);
    expect(roomLeft(await deriveJobs(), OPEN_CONFIG, TODAY)).toBe(before - 1);
    expect(await jobCount()).toBe(2);
  });
});
