// Epic 2 code-review regression tests (2026-07-16). Locks the four applied patches:
//   P1 — no phantom dispatch: sendDraft records dispatched_at ONLY when a deliverable
//        link exists (a phoneless tap logs nothing).
//   P2 — bookingErrorMessage own-property guard (no prototype-key React-child crash).
//   P3 — previewDraft accepts only a clean money string (no "$-50.00"/hex/exp leak).
//   P4 — formatDateKey renders a friendly {slot}, not a bare ISO date.
//
// next/navigation.redirect is mocked to a catchable throw (no request context here).
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';

vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));

import { db } from '../lib/db/client';
import { operator, client, messageLog } from '../lib/db/schema';
import { seedOperator } from '../lib/db/seed';
import { getOwnerId } from '../lib/db/queries';
import { previewDraft, sendDraft } from '../app/(operator)/draft/actions';
import { bookingErrorMessage } from '../lib/domain/bookingErrors';
import { formatDateKey } from '../lib/domain/clock';

// --- P2: prototype-key guard (pure) ---

describe('P2 — bookingErrorMessage never returns an inherited object/function', () => {
  it('known reason → its message', () => {
    expect(bookingErrorMessage('day-maxed')).toContain('full');
  });
  it('prototype keys → safe fallback string (not Object/function)', () => {
    for (const evil of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
      const out = bookingErrorMessage(evil);
      expect(typeof out).toBe('string');
      expect(out).toBe('Something went wrong — please try again.');
    }
  });
  it('undefined → null', () => {
    expect(bookingErrorMessage(undefined)).toBeNull();
  });
});

// --- P4: friendly {slot} (pure) ---

describe('P4 — formatDateKey renders a display date, not raw ISO', () => {
  it('formats a calendar day without a tz shift', () => {
    const out = formatDateKey('2026-08-03'); // a Monday
    expect(out).toContain('Aug');
    expect(out).toContain('3');
    expect(out).not.toBe('2026-08-03');
  });
});

// --- P1 + P3: DB-backed (draft actions) ---

describe('P1/P3 — draft send + amount validation', () => {
  let ownerId: string;
  let phoneClientId: string;
  let noPhoneClientId: string;

  beforeAll(async () => {
    await db.execute(sql`truncate table ${operator} restart identity cascade`);
    await seedOperator();
    ownerId = await getOwnerId();
    const [c1] = await db
      .insert(client)
      .values({ ownerId, name: 'Ada', phone: '555-0100', cadence: 'weekly' })
      .returning();
    phoneClientId = c1.id;
    const [c2] = await db
      .insert(client)
      .values({ ownerId, name: 'Bo', phone: '', cadence: 'weekly' })
      .returning();
    noPhoneClientId = c2.id;
  });

  beforeEach(async () => {
    await db.delete(messageLog);
  });

  // P3
  it('P3: tampered amounts (negative/hex/exponential) never reach the body', async () => {
    for (const bad of ['-50', '0x10', '1e9', '50.999', 'abc']) {
      const res = await previewDraft(phoneClientId, 'payment_reminder', '', bad);
      expect(res.ok).toBe(true);
      if (!res.ok) continue;
      // {amount} blanks → no bogus figure, no stray minus/dollar amount.
      expect(res.data.body).not.toContain('-50');
      expect(res.data.body).not.toContain('16'); // 0x10
      expect(res.data.body).not.toContain('1000000000'); // 1e9
      expect(res.data.body).not.toContain('$');
    }
  });

  it('P3: a clean money string still renders', async () => {
    const res = await previewDraft(phoneClientId, 'payment_reminder', '', '20');
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.body).toContain('$20.00');
  });

  // P1
  it('P1: sending to a phoneless client logs NO dispatch (redirects to no-phone)', async () => {
    const fd = new FormData();
    fd.set('client', noPhoneClientId);
    fd.set('type', 'booking_confirmation');
    fd.set('slot', 'Mon, Aug 3');
    fd.set('amount', '');
    fd.set('nonce', randomUUID());
    fd.set('channel', 'whatsapp');

    await expect(sendDraft(fd)).rejects.toThrow(/error=no-phone/);

    // The honesty-critical assertion: nothing was logged.
    const rows = await db
      .select()
      .from(messageLog)
      .where(eq(messageLog.ownerId, ownerId));
    expect(rows).toHaveLength(0);
  });

  it('P1: sending to a client WITH a phone records exactly one dispatch and opens the link', async () => {
    const fd = new FormData();
    fd.set('client', phoneClientId);
    fd.set('type', 'booking_confirmation');
    fd.set('slot', 'Mon, Aug 3');
    fd.set('amount', '');
    fd.set('nonce', randomUUID());
    fd.set('channel', 'whatsapp');

    await expect(sendDraft(fd)).rejects.toThrow(/REDIRECT:https:\/\/wa\.me\//);

    const rows = await db
      .select()
      .from(messageLog)
      .where(eq(messageLog.ownerId, ownerId));
    expect(rows).toHaveLength(1);
    expect(rows[0].dispatchedAt).toBeTruthy();
  });
});
