// Story 3.2 — known-client DIRECT-CONFIRM booking, against the Docker Postgres
// (serial, singleFork — see vitest.config.ts). The token IS the authorization (AD-6):
// the confirm action takes ONLY (token, date), derives client_id + owner_id from the
// token, and routes through the ONE commitBooking (AD-2) with override=false. This pins:
//   AC1 — confirming an open slot inserts a `booked` Job on the token's client (no second
//         booking mechanism, no approval, correct owner).
//   AC2 — a double-tap on the same slot returns the SAME Job (server-derived idempotency
//         key `book:<clientId>:<date>`, AD-12) — never a second row.
//   AC3 — a slot filled between view and confirm yields no-availability (day-maxed |
//         week-full), ZERO new Jobs for the loser (reuses Story 1.4's one-winner proof).
//
// We drive the inner, unit-testable confirmBookingResult (typed AR15) directly — the
// thin confirmBooking(formData) wrapper only adds the zero-JS redirect on top.
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { sql, eq, and } from 'drizzle-orm';
import { db } from '../lib/db/client';
import { operator, client, capacitySettings, job, token } from '../lib/db/schema';
import { seedOperator } from '../lib/db/seed';
import { getOwnerId } from '../lib/db/queries';
import { ensureClientToken } from '../lib/domain/booking';
import { confirmBookingResult } from '../app/book/[token]/actions';

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
// (all 7 days working) regardless of the real wall-clock the action reads.
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

// A date safely in the future (>= today in any tz) — confirmBookingResult reads the
// real clock, so we pick +N days UTC which always clears the operator-local "today".
function futureDate(daysAhead: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + daysAhead);
  return d.toISOString().slice(0, 10);
}

async function jobCount(): Promise<number> {
  const rows = await db.select().from(job);
  return rows.length;
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
    const date = futureDate(4);

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
    const date = futureDate(5);

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
    const d1 = futureDate(4);
    const d2 = futureDate(6);

    const r1 = await confirmBookingResult(tokA, d1);
    const r2 = await confirmBookingResult(tokA, d2);
    expect(r1.ok && r2.ok).toBe(true);
    if (!r1.ok || !r2.ok) return;

    expect(r2.data.id).not.toBe(r1.data.id);
    expect(await jobCount()).toBe(2);
  });

  // --- AC3: slot filled between view and confirm → no-availability, ZERO new Jobs for
  // the loser (Story 1.4 one-winner proof, on the token-confirm entrypoint). ---
  it('AC3: a slot that filled after view yields no-availability and writes nothing', async () => {
    await setCaps(1, 14); // one slot on the target day
    const date = futureDate(4);

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

    // The machine reason is a capacity reason (mapped to one client-facing message).
    expect(['day-maxed', 'week-full']).toContain(result.reason);
    // No silent overbook — the loser wrote nothing.
    expect(await jobCount()).toBe(before);
  });

  // --- Fail-closed: a tampered/invalid token never books and never leaks a reason. ---
  it('a tampered token fails closed to a generic invalid, no Job written', async () => {
    await setCaps(3, 14);
    const result = await confirmBookingResult(`${tokA}x`, futureDate(4));
    expect(result).toEqual({ ok: false, reason: 'invalid' });
    expect(await jobCount()).toBe(0);
  });
});
