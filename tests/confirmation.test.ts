// Story 2.4 — booking-confirmation message. The first real caller of the messaging
// spine: after capacity.commitBooking (1.4) succeeds, createBooking produces a
// booking-confirmation DRAFT (2.2 compose + 2.3 drafted_at) off the committed Job's
// own client/date/price — never re-derived (AC3), never auto-sent (FR19). The send
// tap reuses the 2.3 recordDispatch path, idempotent per Job.
//
// next/cache is mocked: revalidatePath has no request context in a unit test.
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq, and, sql } from 'drizzle-orm';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { db } from '../lib/db/client';
import { operator, client, capacitySettings, job, messageLog } from '../lib/db/schema';
import { seedOperator } from '../lib/db/seed';
import { getOwnerId } from '../lib/db/queries';
import { confirmationDraftNonce } from '../lib/domain/compose';
import { formatDateKey } from '../lib/domain/clock';
import { createBooking, getConfirmationDraft } from '../app/(operator)/bookings/actions';
import { recordDispatch } from '../app/(operator)/draft/actions';

// A future working day (strictly after the real "now" so commitBooking's past-date
// guard passes). 2026-08-03 is a Monday.
const DATE = '2026-08-03';

function bookingForm(over: Record<string, string> = {}): FormData {
  const fd = new FormData();
  fd.set('clientId', over.clientId ?? '');
  fd.set('date', over.date ?? DATE);
  fd.set('idempotencyKey', over.idempotencyKey ?? randomUUID());
  if (over.override) fd.set('override', 'on');
  return fd;
}

describe('Story 2.4 — booking-confirmation draft off commit', () => {
  let ownerId: string;
  let clientId: string;

  beforeAll(async () => {
    await db.execute(sql`truncate table ${operator} restart identity cascade`);
    await seedOperator();
    ownerId = await getOwnerId();
    await db.insert(capacitySettings).values({
      ownerId,
      workingDays: [1, 2, 3, 4, 5, 6, 7],
      perDayCap: 3,
      weeklyCeiling: 14,
      defaultJobPriceCents: 20000,
      timezone: 'America/Chicago',
    });
    const [c] = await db
      .insert(client)
      .values({ ownerId, name: 'Ada Test', phone: '555-0100', cadence: 'weekly' })
      .returning();
    clientId = c.id;
  });

  beforeEach(async () => {
    await db.delete(messageLog);
    await db.delete(job);
  });

  it('AC1/AC3: commit produces a booking-confirmation drafted row off the Job (no re-fetch)', async () => {
    const res = await createBooking(bookingForm({ clientId }));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const committed = res.data;
    expect(committed.clientId).toBe(clientId);
    expect(committed.date).toBe(DATE);
    expect(committed.priceCents).toBe(20000);

    const [row] = await db
      .select()
      .from(messageLog)
      .where(
        and(
          eq(messageLog.ownerId, ownerId),
          eq(messageLog.draftNonce, confirmationDraftNonce(committed.id)),
        ),
      );
    expect(row).toBeTruthy();
    expect(row.messageType).toBe('booking_confirmation');
    expect(row.clientId).toBe(clientId);
    expect(row.resultingJobRef).toBe(committed.id); // FR13 attribution
    expect(row.draftedAt).toBeTruthy();
    // AC1 / no autonomous send (FR19): drafted, NOT dispatched.
    expect(row.dispatchedAt).toBeNull();
  });

  it('AD-12: idempotent repeat commit → same Job → exactly one confirmation draft', async () => {
    const key = randomUUID();
    const r1 = await createBooking(bookingForm({ clientId, idempotencyKey: key }));
    const r2 = await createBooking(bookingForm({ clientId, idempotencyKey: key }));
    expect(r1.ok && r2.ok).toBe(true);
    if (r1.ok && r2.ok) expect(r2.data.id).toBe(r1.data.id); // same Job

    const rows = await db
      .select()
      .from(messageLog)
      .where(eq(messageLog.ownerId, ownerId));
    expect(rows).toHaveLength(1);
  });

  it('AC1/AC3: getConfirmationDraft composes from the Job’s own client/date/price', async () => {
    const res = await createBooking(bookingForm({ clientId }));
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const draftRes = await getConfirmationDraft(res.data.id);
    expect(draftRes.ok).toBe(true);
    if (!draftRes.ok) return;
    expect(draftRes.data.draft.type).toBe('booking_confirmation');
    expect(draftRes.data.draft.recipient).toBe('555-0100'); // the Job's client phone
    expect(draftRes.data.draft.body).toContain('Ada Test'); // {client} resolved
    // P4 (code-review): {slot} is a friendly display date, not the raw ISO key.
    expect(draftRes.data.slot).toBe(formatDateKey(DATE));
    expect(draftRes.data.slot).not.toBe(DATE);
    expect(draftRes.data.nonce).toBe(confirmationDraftNonce(res.data.id));
  });

  it('getConfirmationDraft: unknown job → typed failure, never throws', async () => {
    const bad = await getConfirmationDraft(randomUUID());
    expect(bad).toEqual({ ok: false, reason: 'job-not-found' });
  });

  it('AC2: tap dispatches once via the 2.3 path; a re-tap does not double-log', async () => {
    const res = await createBooking(bookingForm({ clientId }));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const nonce = confirmationDraftNonce(res.data.id);

    const tap1 = await recordDispatch(clientId, 'booking_confirmation', nonce);
    expect(tap1.ok).toBe(true);
    const tap2 = await recordDispatch(clientId, 'booking_confirmation', nonce);
    expect(tap2.ok).toBe(true);
    if (tap1.ok && tap2.ok) {
      expect(tap2.data.dispatchedAt).toBe(tap1.data.dispatchedAt); // same stamp
    }

    // Still exactly one row, now dispatched — the confirmation the commit drafted.
    const rows = await db
      .select()
      .from(messageLog)
      .where(eq(messageLog.ownerId, ownerId));
    expect(rows).toHaveLength(1);
    expect(rows[0].dispatchedAt).toBeTruthy();
  });

  it('commit durability: the committed Job persists independently of the confirmation', async () => {
    // The confirmation draft-write is best-effort (try/catch, outside the txn). The
    // committed Job must exist regardless — a messaging failure never rolls it back.
    const res = await createBooking(bookingForm({ clientId }));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const [persisted] = await db
      .select()
      .from(job)
      .where(and(eq(job.ownerId, ownerId), eq(job.id, res.data.id)));
    expect(persisted).toBeTruthy();
    expect(persisted.completion).toBe('booked');
  });
});
