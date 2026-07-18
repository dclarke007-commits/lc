// INTEGRATION FLOW — public self-booking, end to end across MANY server actions.
//
// Sequence: a stranger submits a public booking REQUEST → it lands in the operator's
// approval queue → the operator APPROVES it → that turns the provisional client + no-
// capacity request into a real booked Job (capacity now consumed) → the operator marks
// the outcome (completed) and payment (paid). This exercises the boundary transitions
// that span modules — provisional→active, pending→approved, request(no slot)→Job(slot),
// booked→completed→paid — NOT the single-action logic each unit test already pins.
//
// Spans: app/book/[token]/request.submitPublicRequestResult → queries.listPendingRequests
//   → requests/actions.approveRequest (→ capacity.commitBooking) → lifecycle.markCompleted
//   → ledger.markPaid, with derive.roomLeft observing the capacity delta on read.
//
// Harness: DB-backed Vitest against the Docker Postgres (serial, singleFork). Fake ONLY
// Date (real timers → pg driver untouched), pinned to a Monday so the seeded all-7-day
// week is fully open and every offered slot is a genuine future working day.
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '../../lib/db/client';
import {
  client,
  token,
  job,
  capacitySettings,
  pendingRequest,
  inquiry,
  messageLog,
} from '../../lib/db/schema';
import { seedOperator } from '../../lib/db/seed';
import {
  getOwnerId,
  listPendingRequests,
  listJobsForMetrics,
} from '../../lib/db/queries';
import {
  ensurePublicToken,
  resolvePublicBookingView,
} from '../../lib/domain/publicToken';
import { generateTokenNonce } from '../../lib/auth/clientToken';
import { submitPublicRequestResult } from '../../app/book/[token]/request';
import { approveRequest } from '../../app/(operator)/requests/actions';
import { markCompleted } from '../../lib/domain/lifecycle';
import { markPaid } from '../../lib/domain/ledger';
import { roomLeft, type DeriveJob } from '../../lib/domain/derive';
import type { CapacityConfig } from '../../lib/domain/capacityConfig';

// approveRequest calls revalidatePath from next/cache, which throws outside a Next
// request store (a bare Vitest run). Inert-mock it — we drive the AR15 result directly.
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

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

function submitForm(fields: {
  name?: string;
  phone?: string;
  address?: string;
  date: string;
  visit?: string;
}): FormData {
  const fd = new FormData();
  fd.set('name', fields.name ?? 'Sam Stranger');
  fd.set('phone', fields.phone ?? '555-0100');
  if (fields.address !== undefined) fd.set('address', fields.address);
  fd.set('date', fields.date);
  fd.set('visit', fields.visit ?? generateTokenNonce());
  return fd;
}

function idForm(id: string): FormData {
  const fd = new FormData();
  fd.set('id', id);
  return fd;
}

async function anOpenDate(tokenValue: string): Promise<string> {
  const view = await resolvePublicBookingView(tokenValue);
  if (!view.ok || view.view.openSlots.length === 0) {
    throw new Error('test setup: expected open slots');
  }
  return view.view.openSlots[0].date;
}

/** Current jobs projected for the capacity derives (date + completion only). */
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

// FK-safe clean slate (dependents before parents; message_log.client_id is ON DELETE
// restrict, so it precedes client). Then reset a known-good capacity config — prior test
// files intentionally leave an INVALID timezone on the shared owner, which would make the
// happy-path public view resolve null.
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

describe('Public booking flow — request → queue → approve → book → complete → paid', () => {
  it('crosses every boundary: provisional→active, request(no slot)→Job(slot), booked→completed→paid', async () => {
    const tok = await ensurePublicToken(ownerId);
    const date = await anOpenDate(tok);

    // Baseline: no jobs → the week is fully open.
    expect(roomLeft(await deriveJobs(), OPEN_CONFIG, TODAY)).toBe(14);

    // 1) Stranger submits a public request.
    const submit = await submitPublicRequestResult(
      tok,
      submitForm({ name: 'Ada Lovelace', phone: '555-0101', address: '1 Byron St', date }),
    );
    expect(submit.ok).toBe(true);
    if (submit.ok) expect(submit.data.created).toBe(true);

    // A provisional client + pending request exist, and AR5 holds: NO capacity consumed.
    const [prov] = await db.select().from(client).where(eq(client.ownerId, ownerId));
    expect(prov.status).toBe('provisional');
    expect(roomLeft(await deriveJobs(), OPEN_CONFIG, TODAY)).toBe(14);

    // 2) The operator sees it in the pending queue (joined to the provisional client).
    const queue = await listPendingRequests(ownerId);
    expect(queue).toHaveLength(1);
    expect(queue[0].clientName).toBe('Ada Lovelace');
    expect(queue[0].date).toBe(date);
    const requestId = queue[0].id;

    // 3) Approve — the boundary crossing: request→approved, client→active, ONE booked Job,
    // capacity now consumed.
    const approve = await approveRequest(idForm(requestId));
    expect(approve.ok).toBe(true);

    const [req] = await db
      .select()
      .from(pendingRequest)
      .where(eq(pendingRequest.id, requestId));
    expect(req.status).toBe('approved');

    const [nowClient] = await db.select().from(client).where(eq(client.id, prov.id));
    expect(nowClient.status).toBe('active');

    const jobs = await db.select().from(job).where(eq(job.ownerId, ownerId));
    expect(jobs).toHaveLength(1);
    expect(jobs[0].completion).toBe('booked');
    expect(jobs[0].date).toBe(date);
    expect(jobs[0].clientId).toBe(prov.id);
    // The capacity delta: one slot consumed since the request held none.
    expect(roomLeft(await deriveJobs(), OPEN_CONFIG, TODAY)).toBe(13);

    // 4) Outcome + payment lifecycle on the resulting Job.
    const jobId = jobs[0].id;
    expect((await markCompleted(ownerId, jobId)).ok).toBe(true);
    expect((await markPaid(ownerId, jobId)).ok).toBe(true);

    const [final] = await db.select().from(job).where(eq(job.id, jobId));
    expect(final.completion).toBe('completed');
    expect(final.payment).toBe('paid');
    expect(final.completedAt).not.toBeNull();
  });

  it('two strangers request the same day at cap-1: the first approval wins, the second gets no-availability', async () => {
    // A single slot on the target day. Requests hold no capacity, so BOTH strangers are
    // offered the (empty) day and both submissions succeed; the cap only bites at approve.
    await db
      .update(capacitySettings)
      .set({ perDayCap: 1 })
      .where(eq(capacitySettings.ownerId, ownerId));

    const tok = await ensurePublicToken(ownerId);
    const date = await anOpenDate(tok);

    const a = await submitPublicRequestResult(
      tok,
      submitForm({ name: 'First', date, visit: generateTokenNonce() }),
    );
    const b = await submitPublicRequestResult(
      tok,
      submitForm({ name: 'Second', date, visit: generateTokenNonce() }),
    );
    expect(a.ok && b.ok).toBe(true);

    const queue = await listPendingRequests(ownerId);
    expect(queue).toHaveLength(2);
    const first = queue.find((r) => r.clientName === 'First')!;
    const second = queue.find((r) => r.clientName === 'Second')!;

    // First approval commits the lone slot.
    const r1 = await approveRequest(idForm(first.id));
    expect(r1.ok).toBe(true);

    // Second approval loses the last slot → no-availability, and it self-heals: the request
    // is rolled back to pending (still actionable), the client stays provisional, no 2nd Job.
    const r2 = await approveRequest(idForm(second.id));
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.reason).toBe('no-availability');

    expect(await db.select().from(job).where(eq(job.ownerId, ownerId))).toHaveLength(1);
    const [secReq] = await db
      .select()
      .from(pendingRequest)
      .where(eq(pendingRequest.id, second.id));
    expect(secReq.status).toBe('pending');
    const [secClient] = await db.select().from(client).where(eq(client.id, second.clientId));
    expect(secClient.status).toBe('provisional');
  });
});
