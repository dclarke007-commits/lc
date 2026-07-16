// Story 3.2 — known-client DIRECT-CONFIRM booking, against the Docker Postgres
// (serial, singleFork — see vitest.config.ts). The token IS the authorization (AD-6):
// the confirm action takes ONLY (token, date), derives client_id + owner_id from the
// token, and routes through the ONE commitBooking (AD-2) with override=false. This pins:
//   AC1 — confirming an open slot inserts a `booked` Job on the token's client (no second
//         booking mechanism, no approval, correct owner).
//   AC2 — a double-tap on the same slot returns the SAME Job (server-derived idempotency
//         key `book:<clientId>:<date>`, AD-12) — never a second row.
//   AC3 — a slot filled between view and confirm yields no-availability, ZERO new Jobs.
//
// Clock: the confirm path + resolveBookingView read the wall clock (openSlots are the
// CURRENT operator week). We fake ONLY Date (real timers, so the pg driver is untouched)
// pinned to a Monday, so a full Mon–Sun open week exists and `futureDate(2..6)` always
// lands on a genuinely-offered slot — the P2 membership gate is then deterministic.
//
// We drive the inner, unit-testable confirmBookingResult (typed AR15) directly; the thin
// confirmBooking(formData) wrapper only adds the zero-JS redirect on top.
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
import { operator, client, capacitySettings, job, token } from '../lib/db/schema';
import { seedOperator } from '../lib/db/seed';
import { getOwnerId } from '../lib/db/queries';
import { ensureClientToken } from '../lib/domain/booking';
import { confirmBookingResult } from '../app/book/[token]/confirm';
import { confirmBooking } from '../app/book/[token]/actions';

// The confirmBooking(formData) wrapper calls next/navigation redirect(), which in
// Next THROWS to abort the action. Mock it to (a) throw like the real thing and
// (b) capture the destination URL, so we can assert the reason→URL MASK (AD-3/AR4):
// booked → ?booked=1; day-maxed|week-full|slot-unavailable → ?error=no-availability;
// everything else (incl. a fail-closed invalid token) → ?error=invalid — the raw
// machine reason is NEVER leaked into the URL. Only confirmBooking uses redirect; the
// inner confirmBookingResult does not, so this mock is inert for the AR15 tests.
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    const e = new Error('NEXT_REDIRECT') as Error & { redirectUrl?: string };
    e.redirectUrl = url;
    throw e;
  },
}));

// A fixed Monday noon UTC — inside the operator week Mon 2026-07-20 .. Sun 2026-07-26,
// so with all 7 days working the whole week is open and futureDate(2..6) is in-week.
const FIXED_MONDAY = new Date('2026-07-20T12:00:00.000Z');

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

// N days after the frozen Monday (UTC). N in 2..6 stays inside the current operator
// week, so the date is a genuinely-offered open slot (P2 membership passes).
function futureDate(daysAhead: number): string {
  const d = new Date(FIXED_MONDAY);
  d.setUTCDate(d.getUTCDate() + daysAhead);
  return d.toISOString().slice(0, 10);
}

async function jobCount(): Promise<number> {
  const rows = await db.select().from(job);
  return rows.length;
}

// Drive the confirmBooking(formData) wrapper and return the URL it redirected to.
// The mocked redirect() throws with the URL attached (mirroring Next aborting the
// action), so a wrapper that fails to redirect fails the test loudly.
async function redirectUrlOf(fd: FormData): Promise<string> {
  try {
    await confirmBooking(fd);
  } catch (e) {
    const url = (e as { redirectUrl?: string }).redirectUrl;
    if (typeof url === 'string') return url;
    throw e;
  }
  throw new Error('confirmBooking did not redirect');
}

function formData(tokenValue: string, date: string): FormData {
  const fd = new FormData();
  fd.set('token', tokenValue);
  fd.set('date', date);
  return fd;
}

describe('Known-client direct-confirm booking (Story 3.2)', () => {
  beforeAll(async () => {
    await db.execute(
      sql`truncate table ${token}, ${job}, ${capacitySettings}, ${client}, ${operator} restart identity cascade`,
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
    // Fresh slate per test: clear jobs + caps, keep operator + client + token.
    await db.delete(job);
    await db.delete(capacitySettings);
  });

  // --- AC1: confirm an open slot → a booked Job on the token's client, committed
  // directly (no approval, no second mechanism), correct owner. ---
  it('AC1: confirming an open slot books a Job on the token’s client, no second mechanism', async () => {
    await setCaps(3, 14);
    const date = futureDate(2);

    const result = await confirmBookingResult(tokA, date);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Attached to the TOKEN's client + owner — never a form-supplied id (AR7/AD-6).
    expect(result.data.clientId).toBe(clientA);
    expect(result.data.ownerId).toBe(ownerId);
    // Committed DIRECTLY as booked — no pending/approval state (AD-4/FR7).
    expect(result.data.completion).toBe('booked');
    expect(result.data.date).toBe(date);
    expect(result.data.overridden).toBe(false); // known client never overrides caps

    // Exactly ONE Job row exists — the single commitBooking insert, no parallel path.
    expect(await jobCount()).toBe(1);
    const rows = await db
      .select()
      .from(job)
      .where(and(eq(job.ownerId, ownerId), eq(job.clientId, clientA)));
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(result.data.id);
  });

  // --- AC2: double-tap on the SAME slot → SAME Job (server-derived idempotency key,
  // AD-12), never a second row. ---
  it('AC2: a double-tap on the same slot returns the same Job, never a second (AD-12)', async () => {
    await setCaps(3, 14);
    const date = futureDate(3);

    const first = await confirmBookingResult(tokA, date);
    const second = await confirmBookingResult(tokA, date);
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;

    expect(second.data.id).toBe(first.data.id); // same Job — idempotent replay
    expect(await jobCount()).toBe(1); // exactly one row in the job table
  });

  // --- AC2 corollary: a DIFFERENT date derives a DIFFERENT key → a new Job (the key
  // includes the slot, not just the client — Open-gap #1). ---
  it('AC2: confirming a different open date books a separate Job (key includes the slot)', async () => {
    await setCaps(3, 14);
    const d1 = futureDate(2);
    const d2 = futureDate(4);

    const r1 = await confirmBookingResult(tokA, d1);
    const r2 = await confirmBookingResult(tokA, d2);
    expect(r1.ok && r2.ok).toBe(true);
    if (!r1.ok || !r2.ok) return;

    expect(r2.data.id).not.toBe(r1.data.id);
    expect(await jobCount()).toBe(2);
  });

  // --- AC3: slot filled between view and confirm → no-availability, ZERO new Jobs for
  // the loser. A maxed day is no longer a genuinely-open slot, so the P2 membership
  // gate rejects it (slot-unavailable → no-availability) BEFORE commitBooking — an
  // even earlier no-overbook guarantee than the under-lock cap re-check. ---
  it('AC3: a slot that filled after view yields no-availability and writes nothing', async () => {
    await setCaps(1, 14); // one slot on the target day
    const date = futureDate(2);

    // The slot fills (someone else won it) after the client viewed it as open.
    await db.insert(job).values({
      ownerId,
      clientId: clientA,
      date,
      priceCents: 20000,
      idempotencyKey: `filler-${date}`,
    });
    const before = await jobCount();

    const result = await confirmBookingResult(tokA, date);
    expect(result.ok).toBe(false);
    if (result.ok) return;

    // A no-longer-offered slot → the client-facing no-availability outcome. The wrapper
    // maps day-maxed | week-full | slot-unavailable to the SAME message; the raw reason
    // is never shown to the client.
    expect(['day-maxed', 'week-full', 'slot-unavailable']).toContain(result.reason);
    // No silent overbook — the loser wrote nothing.
    expect(await jobCount()).toBe(before);
  });

  // --- Fail-closed: a tampered/invalid token never books and never leaks a reason. ---
  it('a tampered token fails closed to a generic invalid, no Job written', async () => {
    await setCaps(3, 14);
    const result = await confirmBookingResult(`${tokA}x`, futureDate(2));
    expect(result).toEqual({ ok: false, reason: 'invalid' });
    expect(await jobCount()).toBe(0);
  });

  // --- Code-review P0 (HIGH): a day the client CANCELLED must be re-bookable. The
  // idempotency key `book:<client>:<date>` is deterministic and persists on the
  // cancelled row; the replay lookup + unique index are now scoped to CONSUMING
  // completions, so the dead row neither replays as a false "booked" nor blocks a
  // fresh insert. This is the core Epic-3 rebooking flow. ---
  it('P0: re-books a day the client previously cancelled — new live Job, not a stale replay', async () => {
    await setCaps(3, 14);
    const date = futureDate(5);

    const first = await confirmBookingResult(tokA, date);
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    // Post-cancel state (Story 1.6): completion → cancelled; row + idempotency key persist.
    await db
      .update(job)
      .set({ completion: 'cancelled' })
      .where(eq(job.id, first.data.id));

    // The day is open again (cancelled does not consume). Re-tap the SAME slot.
    const second = await confirmBookingResult(tokA, date);
    expect(second.ok).toBe(true);
    if (!second.ok) return;

    // A genuinely NEW live booking — NOT the dead cancelled Job replayed.
    expect(second.data.id).not.toBe(first.data.id);
    expect(second.data.completion).toBe('booked');

    // Exactly one LIVE booking for that day; the cancelled row is still present.
    const live = await db
      .select()
      .from(job)
      .where(and(eq(job.clientId, clientA), eq(job.completion, 'booked')));
    expect(live).toHaveLength(1);
    expect(live[0].id).toBe(second.data.id);
    expect(await jobCount()).toBe(2); // cancelled + new booked
  });

  // --- Code-review P2: a bearer may only confirm a slot the surface OFFERED as a
  // bookable form (current-week openSlots). A working, under-cap, non-past day that
  // was never shown is rejected as no-availability — never committed. ---
  it('P2: a valid working day that was never offered (out of the shown week) is rejected', async () => {
    await setCaps(3, 14);
    // 8 days out = next operator week — a working, under-cap, non-past day that the
    // current-week view never rendered a form for.
    const unshown = futureDate(8);

    const result = await confirmBookingResult(tokA, unshown);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('slot-unavailable');
    expect(await jobCount()).toBe(0); // nothing committed outside the shown set
  });

  // --- Code-review P3: the reason→URL MASK lives entirely in the confirmBooking
  // wrapper (untested before this). Assert booked / no-availability / invalid
  // routing and that the raw machine reason NEVER leaks into the URL (AD-3/AR4). ---
  it('P3: wrapper redirects a successful booking to ?booked=1', async () => {
    await setCaps(3, 14);
    const date = futureDate(6);
    const url = await redirectUrlOf(formData(tokA, date));
    expect(url).toBe(`/book/${encodeURIComponent(tokA)}?booked=1`);
    expect(await jobCount()).toBe(1);
  });

  it('P3: wrapper maps a capacity reason to ?error=no-availability (raw reason not leaked)', async () => {
    await setCaps(1, 14); // one slot on the target day
    const date = futureDate(3);
    // Fill the day (consuming) so the slot is no longer offered.
    await db.insert(job).values({
      ownerId,
      clientId: clientA,
      date,
      priceCents: 20000,
      idempotencyKey: `filler-${date}`,
    });

    const url = await redirectUrlOf(formData(tokA, date));
    expect(url).toBe(`/book/${encodeURIComponent(tokA)}?error=no-availability`);
    // The raw machine reason is never exposed in the URL.
    expect(url).not.toContain('day-maxed');
    expect(url).not.toContain('week-full');
    expect(url).not.toContain('slot-unavailable');
  });

  it('P3: wrapper maps a fail-closed invalid token to ?error=invalid', async () => {
    await setCaps(3, 14);
    const url = await redirectUrlOf(formData(`${tokA}x`, futureDate(2)));
    expect(url).toBe(`/book/${encodeURIComponent(`${tokA}x`)}?error=invalid`);
    expect(await jobCount()).toBe(0);
  });
});
