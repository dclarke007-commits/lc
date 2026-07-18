// Story 4.3 — the operator APPROVAL QUEUE, against the Docker Postgres (serial,
// singleFork — see vitest.config.ts). Pins:
//   AC1 — listPendingRequests returns ONLY this owner's `pending` rows with the
//         provisional client's name/phone/address; excludes approved/declined + other owners.
//   AC2 — approve routes through the ONE commitBooking (AD-2): one `booked` Job on the
//         request's client/date, request → approved, client → active.
//   AC2 one-winner (AR4) — a day at cap-1, two pending requests: approve #1 commits;
//         approve #2 → no-availability, NO second Job, request #2 stays pending.
//   AC2 idempotency (AD-12) — the deterministic `approve:<id>` key replays the SAME Job.
//   AC3 — decline flips to declined with NO Job / NO capacity change; a non-pending
//         request (or one already declined) is a stale no-op; a declined request never
//         resurrects on a later approve.
//   Owner isolation (AD-8) — another owner's id cannot list/read/transition the row.
//
// Clock: commitBooking reads the wall clock for the past-date gate. We fake ONLY Date
// (real timers, so the pg driver is untouched) pinned to a Monday, so the target dates
// are genuinely-future working days under the all-7-day seeded config.
import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  vi,
} from 'vitest';
import { eq, and } from 'drizzle-orm';
import { db } from '../lib/db/client';
import {
  client,
  capacitySettings,
  job,
  pendingRequest,
  inquiry,
  messageLog,
} from '../lib/db/schema';
import { seedOperator } from '../lib/db/seed';
import {
  getOwnerId,
  listPendingRequests,
  getPendingRequest,
  setPendingRequestStatus,
} from '../lib/db/queries';
import { approveRequest, declineRequest } from '../app/(operator)/requests/actions';

// The actions call revalidatePath, which throws outside a Next request/static-generation
// store (as in a bare Vitest run). Mock it inert — we drive the AR15 result directly, so
// cache revalidation is not under test here (mirrors tests/client.test.ts).
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

// A fixed Monday noon UTC — inside the operator week Mon 2026-07-20 .. Sun 2026-07-26,
// so futureDate(1..6) lands on genuinely-future, in-week working days.
const FIXED_MONDAY = new Date('2026-07-20T12:00:00.000Z');
// A stand-in "other owner" id (the operator table is a hard singleton — a real second
// operator row cannot exist — so cross-owner scoping is exercised at the query-argument
// level: a different owner_id VALUE must make the real owner's rows unreachable, AD-8).
const OTHER_OWNER = '00000000-0000-4000-8000-000000000000';

let ownerId: string;

/** N days after the frozen Monday (UTC) → 'YYYY-MM-DD'. N in 1..6 stays in-week. */
function futureDate(daysAhead: number): string {
  const d = new Date(FIXED_MONDAY);
  d.setUTCDate(d.getUTCDate() + daysAhead);
  return d.toISOString().slice(0, 10);
}

let nonceCounter = 0;

/** Insert a provisional client + a pending request on `date` (mirrors the 4.2 write). */
async function makePending(
  date: string,
  fields?: { name?: string; phone?: string; address?: string | null },
): Promise<{ clientId: string; requestId: string }> {
  const [c] = await db
    .insert(client)
    .values({
      ownerId,
      name: fields?.name ?? 'Sam Stranger',
      phone: fields?.phone ?? '555-0100',
      address: fields?.address ?? null,
      cadence: 'one-time',
      status: 'provisional',
    })
    .returning();
  const [req] = await db
    .insert(pendingRequest)
    .values({
      ownerId,
      clientId: c.id,
      date,
      sessionNonce: `nonce-${nonceCounter++}`,
    })
    .returning();
  return { clientId: c.id, requestId: req.id };
}

function idForm(id: string): FormData {
  const fd = new FormData();
  fd.set('id', id);
  return fd;
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

async function jobsFor(clientId: string) {
  return db
    .select()
    .from(job)
    .where(and(eq(job.ownerId, ownerId), eq(job.clientId, clientId)));
}

async function statusOf(requestId: string): Promise<string | undefined> {
  const [row] = await db
    .select({ status: pendingRequest.status })
    .from(pendingRequest)
    .where(eq(pendingRequest.id, requestId));
  return row?.status;
}

async function clientStatusOf(clientId: string): Promise<string | undefined> {
  const [row] = await db
    .select({ status: client.status })
    .from(client)
    .where(eq(client.id, clientId));
  return row?.status;
}

beforeAll(async () => {
  await seedOperator();
  ownerId = await getOwnerId();
  // Freeze ONLY Date (real timers → pg driver unaffected) on a Monday.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(FIXED_MONDAY);
});

afterAll(() => {
  vi.useRealTimers();
});

// FK-safe clean slate each test (dependents before the client rows they reference),
// then reseed a known-good capacity config so target days are bookable.
beforeEach(async () => {
  await db.delete(inquiry);
  await db.delete(pendingRequest);
  await db.delete(job);
  await db.delete(messageLog);
  await db.delete(client);
  await setCaps(3, 14);
});

describe('Story 4.3 AC1 — the pending queue', () => {
  it('lists ONLY this owner’s pending rows with the client fields; excludes approved/declined', async () => {
    const p1 = await makePending(futureDate(1), {
      name: 'Ada Lovelace',
      phone: '555-0101',
      address: '1 Byron St',
    });
    const p2 = await makePending(futureDate(2), { name: 'Grace Hopper' });
    const approvedReq = await makePending(futureDate(3));
    const declinedReq = await makePending(futureDate(4));
    await setPendingRequestStatus(ownerId, approvedReq.requestId, 'pending', 'approved');
    await setPendingRequestStatus(ownerId, declinedReq.requestId, 'pending', 'declined');

    const rows = await listPendingRequests(ownerId);
    const ids = rows.map((r) => r.id).sort();
    expect(ids).toEqual([p1.requestId, p2.requestId].sort());

    const ada = rows.find((r) => r.id === p1.requestId)!;
    expect(ada.clientName).toBe('Ada Lovelace');
    expect(ada.clientPhone).toBe('555-0101');
    expect(ada.clientAddress).toBe('1 Byron St');
    expect(ada.date).toBe(futureDate(1));
    expect(ada.clientId).toBe(p1.clientId);
  });

  it('owner isolation — another owner cannot list/read/transition the row (AD-8)', async () => {
    const { requestId } = await makePending(futureDate(1));

    // The other owner sees an EMPTY queue and cannot read the row.
    expect(await listPendingRequests(OTHER_OWNER)).toHaveLength(0);
    expect(await getPendingRequest(OTHER_OWNER, requestId)).toBeUndefined();

    // A cross-owner transition matches zero rows (undefined) and leaves it pending.
    const moved = await setPendingRequestStatus(
      OTHER_OWNER,
      requestId,
      'pending',
      'approved',
    );
    expect(moved).toBeUndefined();
    expect(await statusOf(requestId)).toBe('pending');
  });
});

describe('Story 4.3 AC2 — approve → commit', () => {
  it('approves a pending request: ONE booked Job, status approved, client active', async () => {
    const date = futureDate(2);
    const { clientId, requestId } = await makePending(date);

    const res = await approveRequest(idForm(requestId));
    expect(res.ok).toBe(true);

    const jobs = await jobsFor(clientId);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].completion).toBe('booked');
    expect(jobs[0].date).toBe(date);
    expect(jobs[0].ownerId).toBe(ownerId);

    expect(await statusOf(requestId)).toBe('approved');
    expect(await clientStatusOf(clientId)).toBe('active');
  });

  it('one-winner (AR4): a day at cap-1, two requests → #1 commits, #2 no-availability, no 2nd Job, #2 stays pending', async () => {
    await setCaps(1, 14); // exactly one slot on the target day
    const date = futureDate(3);
    const first = await makePending(date, { name: 'First' });
    const second = await makePending(date, { name: 'Second' });

    const r1 = await approveRequest(idForm(first.requestId));
    expect(r1.ok).toBe(true);
    expect((await jobsFor(first.clientId))).toHaveLength(1);
    expect(await statusOf(first.requestId)).toBe('approved');

    // The day is now full — the second approval loses the last slot.
    const r2 = await approveRequest(idForm(second.requestId));
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.reason).toBe('no-availability');

    // No second Job was written, and the request stays PENDING (not auto-declined).
    expect(await jobsFor(second.clientId)).toHaveLength(0);
    expect(await statusOf(second.requestId)).toBe('pending');
    expect(await clientStatusOf(second.clientId)).toBe('provisional');
  });

  it('idempotency (AD-12): a re-approve RESUMES and replays the SAME Job (approve:<id> key)', async () => {
    const date = futureDate(4);
    const { clientId, requestId } = await makePending(date);

    const r1 = await approveRequest(idForm(requestId));
    expect(r1.ok).toBe(true);
    const afterFirst = await jobsFor(clientId);
    expect(afterFirst).toHaveLength(1);

    // Double-tap on the now-`approved` request → RESUME path (not a stale no-op): no flip
    // (only `pending` flips), commitBooking REPLAYS the same Job via the deterministic
    // key, client re-promoted. Still ok, still exactly one Job.
    const r2 = await approveRequest(idForm(requestId));
    expect(r2.ok).toBe(true);
    expect(await jobsFor(clientId)).toHaveLength(1);
    expect(await statusOf(requestId)).toBe('approved');

    // Force the request back to pending (simulating a status-flip that never landed after
    // a successful commit) and re-approve: commitBooking REPLAYS the same Job via the
    // deterministic `approve:<id>` key — still exactly one Job, same id.
    await db
      .update(pendingRequest)
      .set({ status: 'pending' })
      .where(eq(pendingRequest.id, requestId));
    const r3 = await approveRequest(idForm(requestId));
    expect(r3.ok).toBe(true);
    const afterReplay = await jobsFor(clientId);
    expect(afterReplay).toHaveLength(1);
    expect(afterReplay[0].id).toBe(afterFirst[0].id);
  });

  it('date-past: a request whose day is now in the PAST → no-availability, stays pending, no Job', async () => {
    // Frozen "today" is the fixed Monday; a request dated the prior day trips
    // commitBooking's `date-past` availability gate — which maps to no-availability
    // (a slot-no-longer-bookable reason), never a generic error. The winner-first flip
    // to `approved` is rolled back to `pending` on the failed commit, so it stays
    // actionable (the operator can decline).
    const pastDate = futureDate(-1); // the day before the frozen Monday
    const { clientId, requestId } = await makePending(pastDate);

    const res = await approveRequest(idForm(requestId));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('no-availability');

    expect(await jobsFor(clientId)).toHaveLength(0);
    expect(await statusOf(requestId)).toBe('pending');
    expect(await clientStatusOf(clientId)).toBe('provisional');
  });

  it('non-working-day: a request on a non-working weekday → no-availability, stays pending, no Job', async () => {
    // Restrict working days to Mon–Fri, then target the in-week Sunday (futureDate(6) =
    // Sun 2026-07-26). commitBooking's `non-working-day` gate fires → no-availability.
    await db.delete(capacitySettings);
    await db.insert(capacitySettings).values({
      ownerId,
      workingDays: [1, 2, 3, 4, 5],
      perDayCap: 3,
      weeklyCeiling: 14,
      defaultJobPriceCents: 20000,
      timezone: 'America/Chicago',
    });
    const sunday = futureDate(6);
    const { clientId, requestId } = await makePending(sunday);

    const res = await approveRequest(idForm(requestId));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('no-availability');

    expect(await jobsFor(clientId)).toHaveLength(0);
    expect(await statusOf(requestId)).toBe('pending');
    expect(await clientStatusOf(clientId)).toBe('provisional');
  });

  it('self-heal: a re-approve on an `approved` request with a still-provisional client re-promotes it → active, still one Job', async () => {
    const date = futureDate(5);
    const { clientId, requestId } = await makePending(date);

    const r1 = await approveRequest(idForm(requestId));
    expect(r1.ok).toBe(true);
    const afterFirst = await jobsFor(clientId);
    expect(afterFirst).toHaveLength(1);

    // Simulate the STRANDED state: the approve committed the Job and flipped status to
    // `approved`, but the client-promotion write never landed (a DB fault after commit).
    await db.update(client).set({ status: 'provisional' }).where(eq(client.id, clientId));
    expect(await clientStatusOf(clientId)).toBe('provisional');
    expect(await statusOf(requestId)).toBe('approved');

    // Re-approve drives the RESUME path: no flip (already `approved`), commitBooking
    // REPLAYS the SAME Job (idempotent), and the provisional client is re-promoted to
    // active. Self-healed — no stranded provisional client, no second Job.
    const r2 = await approveRequest(idForm(requestId));
    expect(r2.ok).toBe(true);
    const afterHeal = await jobsFor(clientId);
    expect(afterHeal).toHaveLength(1);
    expect(afterHeal[0].id).toBe(afterFirst[0].id);
    expect(await clientStatusOf(clientId)).toBe('active');
  });
});

describe('Story 4.3 AC3 — decline → slot untouched', () => {
  it('declines a pending request: status declined, no Job, no capacity change', async () => {
    const date = futureDate(2);
    const { clientId, requestId } = await makePending(date);

    const res = await declineRequest(idForm(requestId));
    expect(res.ok).toBe(true);
    expect(await statusOf(requestId)).toBe('declined');
    expect(await jobsFor(clientId)).toHaveLength(0);
    expect(await clientStatusOf(clientId)).toBe('provisional');
  });

  it('declining a non-pending request is a stale no-op; a declined request never resurrects on approve', async () => {
    const { clientId, requestId } = await makePending(futureDate(2));

    const first = await declineRequest(idForm(requestId));
    expect(first.ok).toBe(true);

    // Re-decline → stale no-op (already declined), still declined.
    const again = await declineRequest(idForm(requestId));
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.reason).toBe('not-pending');
    expect(await statusOf(requestId)).toBe('declined');

    // A later approve must NOT resurrect a declined request into a booking.
    const approve = await approveRequest(idForm(requestId));
    expect(approve.ok).toBe(false);
    if (!approve.ok) expect(approve.reason).toBe('not-pending');
    expect(await statusOf(requestId)).toBe('declined');
    expect(await jobsFor(clientId)).toHaveLength(0);
  });

  it('decline-after-flip: a request already flipped to `approved` cannot be declined — stays approved', async () => {
    const { requestId } = await makePending(futureDate(2));
    // Manually elect the request as `approved` (mirrors an approve that won the flip).
    await setPendingRequestStatus(ownerId, requestId, 'pending', 'approved');

    // declineRequest guards pending→declined, so on an `approved` row it matches zero
    // rows → stale no-op (not-pending). The row stays `approved`; no phantom decline can
    // strand a committed booking under a "declined" request.
    const res = await declineRequest(idForm(requestId));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('not-pending');
    expect(await statusOf(requestId)).toBe('approved');
  });
});
