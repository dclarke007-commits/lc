// Story 2.3 — dispatch logging (drafted vs dispatched, idempotent) + nudge-fatigue.
//
// Two layers:
//   • PURE: nudgeFatigueForClient — derived on read (AD-7), no DB. Counts ONLY
//     dispatched_at, per client, per operator-local Mon–Sun week (AD-9).
//   • DB-backed (Docker Postgres): upsertMessageDraft / markMessageDispatched /
//     recordDispatch prove AC1 (draft sets drafted_at, never dispatched_at on the
//     draft write) and AC2 (dispatch stamped once; a re-tap on the same nonce does
//     NOT double-log — Option B). listDispatchedMessages excludes unsent drafts.
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { db } from '../lib/db/client';
import { operator, client, messageLog } from '../lib/db/schema';
import { seedOperator } from '../lib/db/seed';
import {
  getOwnerId,
  upsertMessageDraft,
  markMessageDispatched,
  getMessageLogByNonce,
  listDispatchedMessages,
} from '../lib/db/queries';
import { recordDispatch } from '../app/(operator)/draft/actions';
import {
  nudgeFatigueForClient,
  type NudgeMessage,
} from '../lib/domain/derive';

// --- PURE: nudge-fatigue derivation (AC3) ---

describe('derive.nudgeFatigueForClient (AC3, FR21) — pure, operator-local week', () => {
  const TZ = 'America/Chicago'; // CDT (UTC-5) in July 2026
  // Anchor mid-week in the Mon–Sun week [2026-07-13 .. 2026-07-20) operator-local.
  const anchor = new Date('2026-07-15T18:00:00Z');
  const A = 'client-a';
  const B = 'client-b';

  it('counts a client’s dispatched messages within the operator-local week', () => {
    const msgs: NudgeMessage[] = [
      { clientId: A, dispatchedAt: '2026-07-13T12:00:00Z' }, // Mon in-week
      { clientId: A, dispatchedAt: '2026-07-15T14:00:00Z' }, // Wed in-week
    ];
    expect(nudgeFatigueForClient(msgs, TZ, A, anchor)).toBe(2);
  });

  it('excludes other clients and other weeks', () => {
    const msgs: NudgeMessage[] = [
      { clientId: A, dispatchedAt: '2026-07-15T14:00:00Z' }, // A, in-week
      { clientId: B, dispatchedAt: '2026-07-15T14:00:00Z' }, // B, in-week (other client)
      { clientId: A, dispatchedAt: '2026-07-06T14:00:00Z' }, // A, previous week
      { clientId: A, dispatchedAt: '2026-07-21T14:00:00Z' }, // A, next week
    ];
    expect(nudgeFatigueForClient(msgs, TZ, A, anchor)).toBe(1);
  });

  it('groups by the OPERATOR-LOCAL week boundary, not the UTC day', () => {
    // Sun 2026-07-19 23:00 CDT == 2026-07-20 04:00 UTC. The UTC day is Monday, but
    // operator-local it is still Sunday of THIS week → it must count in-week.
    const sundayLateLocal: NudgeMessage = {
      clientId: A,
      dispatchedAt: '2026-07-20T04:00:00Z',
    };
    // Mon 2026-07-20 00:00 CDT == 2026-07-20 05:00 UTC is the NEXT week's start → out.
    const mondayStartLocal: NudgeMessage = {
      clientId: A,
      dispatchedAt: '2026-07-20T05:00:00Z',
    };
    expect(nudgeFatigueForClient([sundayLateLocal], TZ, A, anchor)).toBe(1);
    expect(nudgeFatigueForClient([mondayStartLocal], TZ, A, anchor)).toBe(0);
  });

  it('empty input → 0 (derived on read; nothing stored)', () => {
    expect(nudgeFatigueForClient([], TZ, A, anchor)).toBe(0);
  });
});

// --- DB-backed: drafted vs dispatched, idempotent (AC1, AC2) ---

describe('MessageLog drafted vs dispatched (AC1/AC2) — Docker Postgres', () => {
  let ownerId: string;
  let clientId: string;

  beforeAll(async () => {
    await db.execute(sql`truncate table ${operator} restart identity cascade`);
    await seedOperator();
    ownerId = await getOwnerId();
    const [c] = await db
      .insert(client)
      .values({ ownerId, name: 'Ada Test', phone: '555-0100', cadence: 'weekly' })
      .returning();
    clientId = c.id;
  });

  beforeEach(async () => {
    await db.delete(messageLog);
  });

  it('AC1: the drafted write sets drafted_at and leaves dispatched_at null', async () => {
    const nonce = randomUUID();
    const row = await upsertMessageDraft(ownerId, clientId, 'booking_confirmation', nonce);
    expect(row.draftedAt).toBeTruthy();
    expect(row.dispatchedAt).toBeNull();
  });

  it('AC1: re-drafting the same nonce does NOT insert a second row', async () => {
    const nonce = randomUUID();
    await upsertMessageDraft(ownerId, clientId, 'booking_confirmation', nonce);
    await upsertMessageDraft(ownerId, clientId, 'booking_confirmation', nonce);
    const rows = await db
      .select()
      .from(messageLog)
      .where(eq(messageLog.ownerId, ownerId));
    expect(rows).toHaveLength(1);
  });

  it('AC2: dispatch is stamped once; a re-tap (same nonce) does not double-log', async () => {
    const nonce = randomUUID();
    await upsertMessageDraft(ownerId, clientId, 'rebooking_nudge', nonce);

    const first = await markMessageDispatched(ownerId, nonce);
    expect(first?.dispatchedAt).toBeTruthy();

    // Re-tap: guard on dispatched_at IS NULL matches zero rows → no-op (undefined).
    const second = await markMessageDispatched(ownerId, nonce);
    expect(second).toBeUndefined();

    // The stored timestamp is unchanged — no second dispatch was written.
    const stored = await getMessageLogByNonce(ownerId, nonce);
    expect(stored?.dispatchedAt).toBe(first?.dispatchedAt);
  });

  it('recordDispatch: drafts then dispatches once; idempotent per nonce (AR15)', async () => {
    const nonce = randomUUID();
    const r1 = await recordDispatch(clientId, 'win_back', nonce);
    expect(r1.ok).toBe(true);

    const r2 = await recordDispatch(clientId, 'win_back', nonce);
    expect(r2.ok).toBe(true);
    // Same draft → same dispatched_at returned (no second dispatch).
    if (r1.ok && r2.ok) expect(r2.data.dispatchedAt).toBe(r1.data.dispatchedAt);

    const rows = await db
      .select()
      .from(messageLog)
      .where(eq(messageLog.ownerId, ownerId));
    expect(rows).toHaveLength(1);
    expect(rows[0].dispatchedAt).toBeTruthy();
  });

  it('recordDispatch: typed failures, never throws (invalid type / no nonce / bad client)', async () => {
    const bad1 = await recordDispatch(clientId, 'not-a-type', randomUUID());
    expect(bad1).toEqual({ ok: false, reason: 'template-type-invalid' });

    const bad2 = await recordDispatch(clientId, 'booking_confirmation', '');
    expect(bad2).toEqual({ ok: false, reason: 'draft-nonce-missing' });

    const bad3 = await recordDispatch(randomUUID(), 'booking_confirmation', randomUUID());
    expect(bad3).toEqual({ ok: false, reason: 'client-not-found' });
  });

  it('AC3 source: listDispatchedMessages returns ONLY dispatched rows (unsent draft excluded)', async () => {
    // One drafted-only (never dispatched) + one dispatched.
    const draftedOnly = randomUUID();
    await upsertMessageDraft(ownerId, clientId, 'payment_reminder', draftedOnly);

    const dispatched = randomUUID();
    await recordDispatch(clientId, 'booking_confirmation', dispatched);

    const rows = await listDispatchedMessages(ownerId);
    expect(rows).toHaveLength(1);
    expect(rows[0].clientId).toBe(clientId);
    expect(rows[0].dispatchedAt).toBeTruthy();
  });
});
