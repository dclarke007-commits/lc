// Story 3.4 — post-job nudge + rebooking tracking, against the Docker Postgres
// (serial, singleFork — see vitest.config.ts). This is a WIRING story: it joins the
// already-built seams (1.5 completion, 3.3 rebook proposal, 2.3 dispatch logging, 3.2
// commitBooking) and adds only two PURE derives + one best-effort attribution. The tests
// pin the four facts the story records/derives:
//   AC1 — needsRebookNudge is TRUE for a `completed` job with no rebooking nudge yet
//         dispatched for the client; FALSE for no-show/cancelled/booked, and FALSE once a
//         rebooking_nudge is dispatched (dispatched_at ≥ completed_at) — view-time, no flag.
//   AC2 — the "nudge sent" fact is the Story 2.3 dispatched_at on ONE rebooking_nudge row
//         (idempotent per per-job nonce — a re-tap never double-logs); a commitBooking on
//         the per-client link within 30d sets resulting_job_ref (and NOT outside the window
//         / when already attributed); rebookingConversion recomputes sent/booked/ratio on
//         read from those two facts, no persisted counter.
//
// Clock: confirmBookingResult + resolveBookingView read the wall clock (openSlots are the
// CURRENT operator week). We fake ONLY Date (real timers → pg driver untouched), pinned to
// a Monday, so a full Mon–Sun open week exists and futureDate(2..6) is a genuinely-offered
// slot. NOTE: Postgres now() (drafted_at/dispatched_at) is REAL wall-clock, unaffected by
// the JS fake timer — so completed_at fixtures use a clearly-past instant.
import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  vi,
} from 'vitest';
import { sql, eq, and } from 'drizzle-orm';
import { db } from '../lib/db/client';
import {
  operator,
  client,
  capacitySettings,
  job,
  token,
  messageLog,
} from '../lib/db/schema';
import { seedOperator } from '../lib/db/seed';
import { getOwnerId, listDispatchedMessages } from '../lib/db/queries';
import { ensureClientToken } from '../lib/domain/booking';
import {
  needsRebookNudge,
  rebookingConversion,
  type NudgeLog,
} from '../lib/domain/derive';
import { recordDispatch } from '../app/(operator)/draft/actions';
import { rebookingDispatchNonce } from '../lib/domain/compose';
import { confirmBookingResult } from '../app/book/[token]/confirm';

// A fixed Monday noon UTC — inside the operator week Mon 2026-07-20 .. Sun 2026-07-26,
// so with all 7 days working the whole week is open and futureDate(2..6) is in-week.
const FIXED_MONDAY = new Date('2026-07-20T12:00:00.000Z');

// A clearly-past completion instant: Postgres now() (a real-clock dispatched_at) is always
// AFTER this, so a dispatched nudge suppresses the prompt (dispatched_at ≥ completed_at).
const PAST_COMPLETED_AT = '2020-01-01T00:00:00.000Z';

let ownerId: string;
let clientA: string;
let tokA: string;

async function insertClient(name: string, phone: string): Promise<string> {
  const [row] = await db
    .insert(client)
    .values({ ownerId, name, phone, cadence: 'weekly' })
    .returning();
  return row.id;
}

// Full control over caps + working days so the target date is always bookable
// (all 7 days working) regardless of the frozen wall-clock the action reads.
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

// N days after the frozen Monday (UTC). N in 2..6 stays inside the current operator week.
function futureDate(daysAhead: number): string {
  const d = new Date(FIXED_MONDAY);
  d.setUTCDate(d.getUTCDate() + daysAhead);
  return d.toISOString().slice(0, 10);
}

async function nudgeRowsFor(nonce: string) {
  return db
    .select()
    .from(messageLog)
    .where(and(eq(messageLog.ownerId, ownerId), eq(messageLog.draftNonce, nonce)));
}

describe('Post-job nudge + rebooking tracking (Story 3.4)', () => {
  beforeAll(async () => {
    await db.execute(
      sql`truncate table ${messageLog}, ${token}, ${job}, ${capacitySettings}, ${client}, ${operator} restart identity cascade`,
    );
    await seedOperator();
    ownerId = await getOwnerId();
    clientA = await insertClient('Alice A', '555-0101');
    tokA = await ensureClientToken(ownerId, clientA);
    // Freeze ONLY Date (real timers → pg driver unaffected) on a Monday.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(FIXED_MONDAY);
  });

  afterAll(() => {
    vi.useRealTimers();
  });

  beforeEach(async () => {
    // Fresh slate per test: clear message_log (FK set-null on job), jobs, caps. Keep
    // operator + client + token. Delete message_log before job to avoid dangling refs.
    await db.delete(messageLog);
    await db.delete(job);
    await db.delete(capacitySettings);
  });

  // --- AC1 (predicate, pure): completed → nudge wanted; no-show/cancelled/booked → not. ---
  it('AC1: needsRebookNudge is true for a completed job, false for no-show/cancelled/booked', () => {
    const completed = {
      clientId: clientA,
      completion: 'completed',
      completedAt: PAST_COMPLETED_AT,
    };
    expect(needsRebookNudge(completed, [])).toBe(true);

    // FR40: no-show / cancelled NEVER advance rebooking logic; booked is not yet done.
    expect(
      needsRebookNudge({ ...completed, completion: 'no-show' }, []),
    ).toBe(false);
    expect(
      needsRebookNudge({ ...completed, completion: 'cancelled' }, []),
    ).toBe(false);
    expect(
      needsRebookNudge(
        { clientId: clientA, completion: 'booked', completedAt: null },
        [],
      ),
    ).toBe(false);
  });

  // --- AC1: a nudge dispatched BEFORE completion does not suppress; AFTER does. ---
  it('AC1: only a rebooking_nudge dispatched at/after completed_at suppresses the prompt', () => {
    const jobView = {
      clientId: clientA,
      completion: 'completed',
      completedAt: '2026-07-10T00:00:00.000Z',
    };
    const before: NudgeLog = {
      clientId: clientA,
      messageType: 'rebooking_nudge',
      dispatchedAt: '2026-07-09T00:00:00.000Z', // < completed_at → stale, does not suppress
      resultingJobRef: null,
    };
    const after: NudgeLog = {
      clientId: clientA,
      messageType: 'rebooking_nudge',
      dispatchedAt: '2026-07-11T00:00:00.000Z', // ≥ completed_at → this completion's nudge
      resultingJobRef: null,
    };
    const otherClient: NudgeLog = { ...after, clientId: 'someone-else' };
    const otherType: NudgeLog = { ...after, messageType: 'booking_confirmation' };

    expect(needsRebookNudge(jobView, [before, otherClient, otherType])).toBe(true);
    expect(needsRebookNudge(jobView, [before, after])).toBe(false);
  });

  // --- AC2: sending a nudge writes ONE dispatched rebooking_nudge row; the prompt then
  // disappears; a re-tap (same per-job nonce) never double-logs (Story 2.3 idempotency). ---
  it('AC2: the send path logs exactly one dispatched nudge and is idempotent on re-tap', async () => {
    const anchorJobId = '11111111-1111-4111-8111-111111111111';
    const nonce = rebookingDispatchNonce(anchorJobId);
    const jobView = {
      clientId: clientA,
      completion: 'completed',
      completedAt: PAST_COMPLETED_AT,
    };

    // Prompt is wanted before any nudge is sent.
    expect(needsRebookNudge(jobView, await listDispatchedMessages(ownerId))).toBe(
      true,
    );

    // First send tap: records ONE dispatch (message_type = rebooking_nudge).
    const first = await recordDispatch(clientA, 'rebooking_nudge', nonce);
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    // Re-tap (browser back → resubmit): same nonce → same row → NO second dispatch.
    const second = await recordDispatch(clientA, 'rebooking_nudge', nonce);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.data.dispatchedAt).toBe(first.data.dispatchedAt); // stamped once

    const rows = await nudgeRowsFor(nonce);
    expect(rows).toHaveLength(1); // exactly one MessageLog row (no parallel log)
    expect(rows[0].messageType).toBe('rebooking_nudge');
    expect(rows[0].dispatchedAt).toBeTruthy();
    expect(rows[0].resultingJobRef).toBeNull(); // not yet booked

    // The predicate flips false — the prompt disappears with NO stored flag.
    expect(needsRebookNudge(jobView, await listDispatchedMessages(ownerId))).toBe(
      false,
    );
  });

  // --- AC2: a commitBooking on the per-client link within 30d attributes the new Job back
  // to the most-recent unattributed dispatched nudge (resulting_job_ref). ---
  it('AC2: a booking within the window sets resulting_job_ref on the dispatched nudge', async () => {
    await setCaps(3, 14);
    const nonce = rebookingDispatchNonce('anchor-A');
    const disp = await recordDispatch(clientA, 'rebooking_nudge', nonce);
    expect(disp.ok).toBe(true);

    // The client taps their per-client link and confirms an open slot (Story 3.2).
    const result = await confirmBookingResult(tokA, futureDate(2));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const [row] = await nudgeRowsFor(nonce);
    expect(row.resultingJobRef).toBe(result.data.id); // nudge → the Job it produced
  });

  // --- AC2: a booking OUTSIDE the 30d window does NOT attribute (best-effort, bounded). ---
  it('AC2: a booking outside the attribution window leaves the nudge unattributed', async () => {
    await setCaps(3, 14);
    const nonce = rebookingDispatchNonce('anchor-old');
    await recordDispatch(clientA, 'rebooking_nudge', nonce);
    // Push dispatched_at 40 days before the frozen "now" — beyond the 30d window the
    // confirm path computes (now − 30d).
    const stale = new Date(FIXED_MONDAY);
    stale.setUTCDate(stale.getUTCDate() - 40);
    await db
      .update(messageLog)
      .set({ dispatchedAt: stale.toISOString() })
      .where(and(eq(messageLog.ownerId, ownerId), eq(messageLog.draftNonce, nonce)));

    const result = await confirmBookingResult(tokA, futureDate(3));
    expect(result.ok).toBe(true);

    const [row] = await nudgeRowsFor(nonce);
    expect(row.resultingJobRef).toBeNull(); // out of window → not credited
  });

  // --- AC2: an already-attributed nudge is not stolen by a later booking (guard). ---
  it('AC2: a booking does not re-attribute a nudge that already has a resulting_job_ref', async () => {
    await setCaps(3, 14);
    const nonce = rebookingDispatchNonce('anchor-taken');
    await recordDispatch(clientA, 'rebooking_nudge', nonce);

    // First booking claims the nudge.
    const first = await confirmBookingResult(tokA, futureDate(2));
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const [afterFirst] = await nudgeRowsFor(nonce);
    expect(afterFirst.resultingJobRef).toBe(first.data.id);

    // A second, different booking must NOT overwrite the existing attribution.
    const second = await confirmBookingResult(tokA, futureDate(4));
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    const [afterSecond] = await nudgeRowsFor(nonce);
    expect(afterSecond.resultingJobRef).toBe(first.data.id); // unchanged, not stolen
  });

  // --- AC2 (metric, pure): the conversion ratio recomputes on read from the two facts —
  // dispatched rebooking_nudge rows (sent) and their resulting_job_ref (booked). ---
  it('AC2: rebookingConversion derives sent/booked/ratio from the two facts (2 sent, 1 booked → 0.5)', () => {
    const anchorIso = '2026-07-16T00:00:00.000Z';
    const logs: NudgeLog[] = [
      // In-window rebooking nudges: one produced a booking, one did not.
      {
        clientId: clientA,
        messageType: 'rebooking_nudge',
        dispatchedAt: '2026-07-10T00:00:00.000Z',
        resultingJobRef: 'job-1',
      },
      {
        clientId: clientA,
        messageType: 'rebooking_nudge',
        dispatchedAt: '2026-07-12T00:00:00.000Z',
        resultingJobRef: null,
      },
      // Ignored: a different message type in the window.
      {
        clientId: clientA,
        messageType: 'booking_confirmation',
        dispatchedAt: '2026-07-11T00:00:00.000Z',
        resultingJobRef: 'job-2',
      },
      // Ignored: a rebooking nudge OUTSIDE the 30-day window.
      {
        clientId: clientA,
        messageType: 'rebooking_nudge',
        dispatchedAt: '2026-05-01T00:00:00.000Z',
        resultingJobRef: 'job-3',
      },
    ];

    expect(rebookingConversion(logs, anchorIso)).toEqual({
      sent: 2,
      booked: 1,
      ratio: 0.5,
    });
    // No nudges → ratio 0 (never divide-by-zero, no stored counter).
    expect(rebookingConversion([], anchorIso)).toEqual({
      sent: 0,
      booked: 0,
      ratio: 0,
    });
  });
});
