// Story 3.3 — one-tap rebooking PROPOSAL + message, against the Docker Postgres
// (serial, singleFork — see vitest.config.ts). Two seams under test:
//
//   • derive.proposeRebookSlot — PURE (no db): cadence interval past the anchor for a
//     cadenced client, soonest-open for a one-time client, and the AC3 nearest-open
//     ALTERNATIVE when the ideal cadence day is full. Must NEVER throw; an empty window
//     returns { slot: null }.
//   • getRebookProposal(jobId) — the owner-scoped read-action that composes the
//     rebooking_nudge draft and APPENDS the per-client /book/<token> link (FR11),
//     without sending, logging, or touching MessageLog (AD-5: compose ≠ deliver).
//
// Clock: getRebookProposal reads the wall clock to anchor "today". We fake ONLY Date
// (real timers, so the pg driver is untouched) pinned to a Monday, so open-slot
// derivation is deterministic (mirrors tests/confirm-booking.test.ts).
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { sql, eq } from 'drizzle-orm';
import { db } from '../lib/db/client';
import {
  operator,
  client,
  capacitySettings,
  job,
  messageTemplate,
  messageLog,
  token,
} from '../lib/db/schema';
import { seedOperator } from '../lib/db/seed';
import { getOwnerId } from '../lib/db/queries';
import { ensureClientToken } from '../lib/domain/booking';
import {
  proposeRebookSlot,
  CADENCE_INTERVAL_DAYS,
  type DeriveJob,
} from '../lib/domain/derive';
import { formatDateKey } from '../lib/domain/clock';
import { type CapacityConfig } from '../lib/domain/capacityConfig';
import { getRebookProposal } from '../app/(operator)/jobs/actions';

// A fixed Monday noon UTC — inside the operator week Mon 2026-07-20 .. Sun 2026-07-26.
const FIXED_MONDAY = new Date('2026-07-20T12:00:00.000Z');
const TODAY = '2026-07-20';

// All-7-working-days config so cadence targets and forward scans are deterministic.
const OPEN_CONFIG: CapacityConfig = {
  workingDays: [1, 2, 3, 4, 5, 6, 7],
  perDayCap: 3,
  weeklyCeiling: 14,
  defaultJobPriceCents: 20000,
  timezone: 'America/Chicago',
};

let ownerId: string;

type Cadence = 'weekly' | 'biweekly' | 'monthly' | 'one-time';

async function insertClient(
  name: string,
  phone: string,
  cadence: Cadence,
): Promise<string> {
  const [row] = await db
    .insert(client)
    .values({ ownerId, name, phone, cadence })
    .returning();
  return row.id;
}

async function insertJob(clientId: string, date: string): Promise<string> {
  const [row] = await db
    .insert(job)
    .values({
      ownerId,
      clientId,
      date,
      priceCents: 20000,
      idempotencyKey: `seed-${clientId}-${date}`,
    })
    .returning();
  return row.id;
}

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

describe('One-tap rebooking proposal (Story 3.3)', () => {
  beforeAll(async () => {
    await db.execute(
      sql`truncate table ${token}, ${messageLog}, ${messageTemplate}, ${job}, ${capacitySettings}, ${client}, ${operator} restart identity cascade`,
    );
    await seedOperator();
    ownerId = await getOwnerId();
    // The link assertion needs an absolute origin; pin it deterministically.
    process.env.APP_BASE_URL = 'http://localhost:3000';
    // Freeze ONLY Date (real timers → pg driver unaffected) on a Monday.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(FIXED_MONDAY);
  });

  afterAll(() => {
    vi.useRealTimers();
  });

  // --- derive.proposeRebookSlot: PURE cadence math (no db) --------------------------

  it('weekly cadence → slot exactly 7 days past the anchor', () => {
    const { slot } = proposeRebookSlot({
      cadence: 'weekly',
      anchorDate: TODAY,
      jobs: [],
      config: OPEN_CONFIG,
      today: TODAY,
    });
    expect(slot).toBe('2026-07-27'); // TODAY + 7
    expect(CADENCE_INTERVAL_DAYS.weekly).toBe(7);
  });

  it('biweekly cadence → slot 14 days past the anchor', () => {
    const { slot } = proposeRebookSlot({
      cadence: 'biweekly',
      anchorDate: TODAY,
      jobs: [],
      config: OPEN_CONFIG,
      today: TODAY,
    });
    expect(slot).toBe('2026-08-03'); // TODAY + 14
    expect(CADENCE_INTERVAL_DAYS.biweekly).toBe(14);
  });

  it('monthly cadence → slot 28 days past the anchor', () => {
    const { slot } = proposeRebookSlot({
      cadence: 'monthly',
      anchorDate: TODAY,
      jobs: [],
      config: OPEN_CONFIG,
      today: TODAY,
    });
    expect(slot).toBe('2026-08-17'); // TODAY + 28
    expect(CADENCE_INTERVAL_DAYS.monthly).toBe(28);
  });

  it('one-time client → soonest open slot at/after today', () => {
    const { slot } = proposeRebookSlot({
      cadence: 'one-time',
      anchorDate: '2026-01-01', // irrelevant for one-time (no interval)
      jobs: [],
      config: OPEN_CONFIG,
      today: TODAY,
    });
    // Today is a working, empty, non-past day → it is itself the soonest open slot.
    expect(slot).toBe(TODAY);
  });

  it('cadence target in the past clamps forward to today (never proposes a past day)', () => {
    const { slot } = proposeRebookSlot({
      cadence: 'weekly',
      anchorDate: '2026-06-01', // +7 = 2026-06-08, well before TODAY
      jobs: [],
      config: OPEN_CONFIG,
      today: TODAY,
    });
    expect(slot).toBe(TODAY); // start = max(target, today) = today, and today is open
  });

  it('AC3: a day-maxed cadence target yields the nearest open ALTERNATIVE, never a throw', () => {
    const target = '2026-07-27'; // TODAY + 7 (weekly)
    // Fill the target day to its per-day cap (perDayCap 1) so it is day-maxed.
    const jobs: DeriveJob[] = [{ date: target, completion: 'booked' }];
    const config: CapacityConfig = { ...OPEN_CONFIG, perDayCap: 1 };

    let result: { slot: string | null } | undefined;
    expect(() => {
      result = proposeRebookSlot({
        cadence: 'weekly',
        anchorDate: TODAY,
        jobs,
        config,
        today: TODAY,
      });
    }).not.toThrow();

    expect(result!.slot).not.toBeNull();
    expect(result!.slot).not.toBe(target); // a DIFFERENT, open alternative
    expect(result!.slot).toBe('2026-07-28'); // the next open working day
  });

  it('AC3: an empty scan window returns { slot: null } without throwing', () => {
    // No working days at all → weekCapacity has no days and nearestOpen finds none.
    const config: CapacityConfig = { ...OPEN_CONFIG, workingDays: [] };
    let result: { slot: string | null } | undefined;
    expect(() => {
      result = proposeRebookSlot({
        cadence: 'weekly',
        anchorDate: TODAY,
        jobs: [],
        config,
        today: TODAY,
      });
    }).not.toThrow();
    expect(result).toEqual({ slot: null });
  });

  // --- getRebookProposal: read-action composes the draft + link, sends nothing -------

  it('composes a rebooking_nudge draft with the slot + /book/<token> link, no dispatch', async () => {
    await setCaps(3, 14);
    // A distinctive rebooking_nudge template so we can prove THIS template was used.
    await db.insert(messageTemplate).values({
      ownerId,
      type: 'rebooking_nudge',
      body: 'REBOOK-COPY {client}: next clean {slot}?',
    });
    const clientId = await insertClient('Rita R', '555-0199', 'weekly');
    const anchorJobId = await insertJob(clientId, TODAY);
    const expectedToken = await ensureClientToken(ownerId, clientId);
    const expectedSlot = formatDateKey('2026-07-27'); // TODAY + 7

    const res = await getRebookProposal(anchorJobId);
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    expect(res.data.slot).toBe(expectedSlot);
    const draft = res.data.draft!;
    expect(draft).not.toBeNull();

    // Uses the rebooking_nudge template (type + distinctive copy + resolved slot/name).
    expect(draft.type).toBe('rebooking_nudge');
    expect(draft.body).toContain('REBOOK-COPY');
    expect(draft.body).toContain('Rita R');
    expect(draft.body).toContain(expectedSlot);

    // FR11: the per-client booking link is appended to the body.
    expect(draft.body).toContain(
      `http://localhost:3000/book/${encodeURIComponent(expectedToken)}`,
    );

    // AD-5: the draft is transport-agnostic — no wa.me/sms/url key on the object.
    expect(Object.keys(draft).sort()).toEqual(['body', 'recipient', 'type']);
    expect(draft.body).not.toContain('wa.me');
    expect(draft.body).not.toContain('sms:');

    // No dispatch, no draft row: MessageLog is untouched (this story ends at a draft).
    const logs = await db
      .select()
      .from(messageLog)
      .where(eq(messageLog.ownerId, ownerId));
    expect(logs).toHaveLength(0);
  });

  it('returns { slot: null, draft: null } (not an error) when no day is workable', async () => {
    // No working days at all → the whole forward scan window has no open day. The
    // action must render this as a graceful null, NEVER an error (AC3). Inserted
    // directly (validateCapacity would reject an empty set, but the DB column allows
    // it and the read path must degrade safely regardless).
    await db.delete(capacitySettings);
    await db.insert(capacitySettings).values({
      ownerId,
      workingDays: [],
      perDayCap: 3,
      weeklyCeiling: 14,
      defaultJobPriceCents: 20000,
      timezone: 'America/Chicago',
    });
    const clientId = await insertClient('Nora N', '555-0111', 'weekly');
    const anchorJobId = await insertJob(clientId, TODAY);

    const res = await getRebookProposal(anchorJobId);
    expect(res).toEqual({ ok: true, data: { slot: null, draft: null } });

    // Still no dispatch/draft logged on the null path.
    const logs = await db
      .select()
      .from(messageLog)
      .where(eq(messageLog.ownerId, ownerId));
    expect(logs).toHaveLength(0);
  });

  it('fails typed (not throw) for an unknown job id', async () => {
    const res = await getRebookProposal('00000000-0000-0000-0000-000000000000');
    expect(res).toEqual({ ok: false, reason: 'job-not-found' });
  });
});
