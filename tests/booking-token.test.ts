// Story 3.1 — the per-client booking token SURFACE (mint → resolve → open slots),
// exercised against the Docker Postgres (serial, singleFork — see vitest.config.ts).
// The token is the ENTIRE authorization (AD-6), so this pins: idempotent minting,
// genuinely-open-slot rendering via Story 1.7 derive, and a fail-closed resolve chain
// (signature → revocation row → owner/client scope). Do NOT end the shared pool here.
import { describe, it, expect, beforeAll } from 'vitest';
import { sql, eq } from 'drizzle-orm';
import { db } from '../lib/db/client';
import { operator, client, job, token } from '../lib/db/schema';
import { seedOperator } from '../lib/db/seed';
import {
  getOwnerId,
  getCapacitySettings,
  listJobsFrom,
  upsertClientToken,
  findTokenByValue,
} from '../lib/db/queries';
import { ensureClientToken, resolveBookingView } from '../lib/domain/booking';
import { signClientToken, getClientTokenSecret } from '../lib/auth/clientToken';
import { DEFAULT_CAPACITY, type CapacityConfig } from '../lib/domain/capacityConfig';
import { localDateKey, weekRangeOfDate } from '../lib/domain/clock';
import { weekCapacity } from '../lib/domain/derive';

let ownerId: string;
let clientA: string;
let clientB: string;

async function insertClient(name: string, phone: string): Promise<string> {
  const [row] = await db
    .insert(client)
    .values({ ownerId, name, phone, cadence: 'weekly' })
    .returning();
  return row.id;
}

/** The owner's effective config — settings row or the domain default (as the resolver does). */
async function ownerConfig(): Promise<CapacityConfig> {
  const s = await getCapacitySettings(ownerId);
  return s
    ? {
        workingDays: s.workingDays,
        perDayCap: s.perDayCap,
        weeklyCeiling: s.weeklyCeiling,
        defaultJobPriceCents: s.defaultJobPriceCents,
        timezone: s.timezone,
      }
    : DEFAULT_CAPACITY;
}

describe('Client booking token surface (Story 3.1)', () => {
  beforeAll(async () => {
    await db.execute(
      sql`truncate table ${token}, ${job}, ${client}, ${operator} restart identity cascade`,
    );
    await seedOperator();
    ownerId = await getOwnerId();
    clientA = await insertClient('Alice A', '555-0101');
    clientB = await insertClient('Bob B', '555-0202');
  });

  it('AC2: mints a DETERMINISTIC per-client token bound to one client+owner (one live link)', async () => {
    const t1 = await ensureClientToken(ownerId, clientA);
    const t2 = await ensureClientToken(ownerId, clientA);
    expect(t1).toBe(t2); // idempotent re-mint — exactly one live link per client

    const rows = await db.select().from(token).where(eq(token.clientId, clientA));
    expect(rows).toHaveLength(1);
    expect(rows[0].ownerId).toBe(ownerId);
    expect(rows[0].capability).toBe('book-client');

    // A different client gets a different, non-enumerable token.
    const tb = await ensureClientToken(ownerId, clientB);
    expect(tb).not.toBe(t1);
  });

  it('AC1: a valid token renders ONLY genuinely-open slots (no login), matching derive', async () => {
    const tok = await ensureClientToken(ownerId, clientA);
    const res = await resolveBookingView(tok);
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    // Bound to THIS client — its name, nobody else's.
    expect(res.view.clientName).toBe('Alice A');

    // Independently derive the expected open days and compare — proves the surface
    // reuses Story 1.7 derive and never re-derives capacity (AD-2/AD-7).
    const cfg = await ownerConfig();
    const today = localDateKey(new Date(), cfg.timezone);
    const { monday } = weekRangeOfDate(today);
    const jobs = await listJobsFrom(ownerId, monday);
    const expectedOpen = weekCapacity(jobs, cfg, today)
      .days.filter((d) => d.open)
      .map((d) => d.date);
    expect(res.view.openSlots.map((s) => s.date)).toEqual(expectedOpen);

    // Every returned slot is a working day, today-or-future (never a past/elapsed day).
    for (const s of res.view.openSlots) {
      expect(cfg.workingDays).toContain(s.isoWeekday);
      expect(s.date >= today).toBe(true);
    }
  });

  it('AC1: a day at the per-day cap is EXCLUDED from open slots (day-cap gating via derive)', async () => {
    const tok = await ensureClientToken(ownerId, clientA);
    const before = await resolveBookingView(tok);
    expect(before.ok).toBe(true);
    if (!before.ok) return;

    if (before.view.openSlots.length === 0) {
      // Edge (e.g. run late on the last working day): no open day this week — assert
      // the fallback pointer instead, still a genuinely-open outcome.
      expect(before.view.nextOpen).not.toBeNull();
      return;
    }

    const target = before.view.openSlots[0].date;
    const cfg = await ownerConfig();
    // Fill the target day to its per-day cap with booked (consuming) jobs.
    for (let i = 0; i < cfg.perDayCap; i++) {
      await db.insert(job).values({
        ownerId,
        clientId: clientA,
        date: target,
        priceCents: 20000,
        idempotencyKey: `cap-${target}-${i}`,
      });
    }

    const after = await resolveBookingView(tok);
    expect(after.ok).toBe(true);
    if (!after.ok) return;
    expect(after.view.openSlots.map((s) => s.date)).not.toContain(target);
  });

  it('AC3: tampered / unknown / empty tokens fail closed to a generic invalid result', async () => {
    const tok = await ensureClientToken(ownerId, clientA);
    expect((await resolveBookingView(`${tok}x`)).ok).toBe(false); // tampered sig
    expect((await resolveBookingView('garbage.sig')).ok).toBe(false); // unknown
    expect((await resolveBookingView('')).ok).toBe(false); // empty
    expect((await resolveBookingView(undefined)).ok).toBe(false); // missing
  });

  it('AC2/AC3: a validly-signed token with NO persisted row (another owner) is rejected', async () => {
    // Sign for a DIFFERENT owner with the REAL secret — the HMAC is valid, but no row
    // exists for it, so the bearer reaches nothing (cannot self-mint into the DB nor
    // cross into another owner's rows).
    const secret = getClientTokenSecret();
    const foreign = await signClientToken(
      { clientId: clientA, ownerId: crypto.randomUUID(), capability: 'book-client' },
      secret,
    );
    expect((await resolveBookingView(foreign)).ok).toBe(false);
  });

  it('AC3: a non-per-client capability (book-public) cannot drive the per-client view', async () => {
    const secret = getClientTokenSecret();
    const publicish = await signClientToken(
      { clientId: clientA, ownerId, capability: 'book-public' },
      secret,
    );
    expect((await resolveBookingView(publicish)).ok).toBe(false);
  });

  it('AC2/AC3: revoking (deleting the row) invalidates a previously-valid token', async () => {
    const tok = await ensureClientToken(ownerId, clientB);
    expect((await resolveBookingView(tok)).ok).toBe(true);
    await db.delete(token).where(eq(token.tokenValue, tok));
    expect((await resolveBookingView(tok)).ok).toBe(false); // HMAC still valid, row gone
  });

  it('AC2: a second client’s token resolves to THAT client only (cross-client isolation)', async () => {
    // Positive isolation: Bob’s token yields Bob’s view, never Alice’s (claims carry
    // their own clientId; getClient is owner+id scoped). (code-review P3)
    const tokB = await ensureClientToken(ownerId, clientB);
    const res = await resolveBookingView(tokB);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.view.clientName).toBe('Bob B');
  });

  it('P1: re-minting with a changed signature REFRESHES the row (secret rotation heals, no stale token)', async () => {
    // Simulate a rotated CLIENT_TOKEN_SECRET: same (owner, client, capability) but a
    // different signed string. upsert must DO UPDATE (not DO NOTHING) so the stored
    // token_value becomes the new one — the old link stops resolving, and re-mint never
    // returns a stale token. Still exactly one live link.
    await ensureClientToken(ownerId, clientA);
    const rotated = `rotated.${'x'.repeat(24)}`;
    const row = await upsertClientToken(ownerId, clientA, rotated, 'book-client');
    expect(row.tokenValue).toBe(rotated);
    const rows = await db.select().from(token).where(eq(token.clientId, clientA));
    expect(rows).toHaveLength(1);
    expect(await findTokenByValue(rotated)).toBeDefined();
  });
});
