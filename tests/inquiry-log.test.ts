// Story 4.4 — the MANUAL inquiry log (logInquiry) + the distinct-inquiry dedup seam,
// exercised against the Docker Postgres (serial, singleFork — see vitest.config.ts).
// This pins AC1 (each manual source logs a row with that source + a NULL session_nonce,
// owner-scoped; `link` and unknown sources are rejected with nothing written — AR12
// security, `link` is server-only), and AC2's integration half (a 4.2 auto-`link`
// inquiry + a manual log for the SAME client → two rows but distinctInquiryCount = 1).
// Do NOT end the shared pool here.
//
// revalidatePath needs a request store that does not exist in a unit test, so next/cache
// is mocked to a no-op — it is orthogonal to the DB contract here (mirrors client.test).
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { eq } from 'drizzle-orm';
import { db } from '../lib/db/client';
import {
  client,
  job,
  inquiry,
  pendingRequest,
  messageLog,
  capacitySettings,
} from '../lib/db/schema';
import { seedOperator } from '../lib/db/seed';
import {
  getOwnerId,
  listInquiries,
  insertPublicBookingRequest,
} from '../lib/db/queries';
import { distinctInquiryCount } from '../lib/domain/derive';
import { logInquiry } from '../app/(operator)/inquiries/actions';

let ownerId: string;

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

beforeAll(async () => {
  await seedOperator();
  ownerId = await getOwnerId();
});

// FK-safe delete order: dependents before the client rows they reference. inquiry
// (client_id ON DELETE set null) + pendingRequest/messageLog/job (restrict) go before
// client; capacity_settings is independent.
beforeEach(async () => {
  await db.delete(inquiry);
  await db.delete(pendingRequest);
  await db.delete(messageLog);
  await db.delete(job);
  await db.delete(client);
  await db.delete(capacitySettings);
});

describe('Story 4.4 AC1 — logInquiry writes a manual inquiry with its source', () => {
  const MANUAL_SOURCES = ['phone', 'walk-in', 'referral', 'other'] as const;

  for (const source of MANUAL_SOURCES) {
    it(`source=${source} → one inquiry row (source=${source}, session_nonce null, owner-scoped)`, async () => {
      const res = await logInquiry(form({ source }));
      expect(res.ok).toBe(true);
      if (!res.ok) return;

      expect(res.data.source).toBe(source);
      expect(res.data.ownerId).toBe(ownerId);
      expect(res.data.sessionNonce).toBeNull();
      expect(res.data.clientId).toBeNull(); // no client provided → anonymous

      const rows = await db.select().from(inquiry).where(eq(inquiry.ownerId, ownerId));
      expect(rows).toHaveLength(1);
      expect(rows[0].source).toBe(source);
      expect(rows[0].sessionNonce).toBeNull();
    });
  }

  it('source=link → rejected (source-invalid), nothing written (AR12 server-only)', async () => {
    const res = await logInquiry(form({ source: 'link' }));
    expect(res).toEqual({ ok: false, reason: 'source-invalid' });
    const rows = await db.select().from(inquiry).where(eq(inquiry.ownerId, ownerId));
    expect(rows).toHaveLength(0);
  });

  it('an unknown source → rejected (source-invalid), nothing written', async () => {
    // Note: `source` is trimmed (like clients readFields), so 'phone ' is legitimately
    // accepted — these are genuinely-unknown values, plus the case-sensitive 'LINK'.
    for (const bad of ['', 'email', 'sms', 'LINK', 'walkin']) {
      const res = await logInquiry(form({ source: bad }));
      expect(res.ok).toBe(false);
    }
    const rows = await db.select().from(inquiry).where(eq(inquiry.ownerId, ownerId));
    expect(rows).toHaveLength(0);
  });

  it('a provided clientId is attached; an unknown clientId fails closed (nothing written)', async () => {
    const [c] = await db
      .insert(client)
      .values({ ownerId, name: 'Known', phone: '555-0001', cadence: 'weekly' })
      .returning();

    const good = await logInquiry(form({ source: 'phone', clientId: c.id }));
    expect(good.ok).toBe(true);
    if (good.ok) expect(good.data.clientId).toBe(c.id);

    // A non-existent / non-UUID clientId → client-not-found, no row written.
    const bad = await logInquiry(form({ source: 'phone', clientId: crypto.randomUUID() }));
    expect(bad).toEqual({ ok: false, reason: 'client-not-found' });
    const badShape = await logInquiry(form({ source: 'phone', clientId: 'not-a-uuid' }));
    expect(badShape).toEqual({ ok: false, reason: 'client-not-found' });

    const rows = await db.select().from(inquiry).where(eq(inquiry.ownerId, ownerId));
    expect(rows).toHaveLength(1); // only the good one
  });
});

describe('Story 4.4 AC2 — distinct-inquiry dedup over real rows (AR12)', () => {
  it('a 4.2 auto-`link` inquiry + a manual log for the SAME client → 2 rows, distinctInquiryCount = 1', async () => {
    // Auto-log a `link` inquiry via the 4.2 path (provisional client + request + link
    // inquiry, all carrying the same clientId).
    const req = await insertPublicBookingRequest({
      ownerId,
      name: 'Ada Lovelace',
      phone: '555-0101',
      address: null,
      requestedDate: '2999-01-01',
      sessionNonce: 'visit-nonce-1',
    });
    expect(req.created).toBe(true);
    if (!req.created) return;
    const clientId = req.client.id;
    expect(req.inquiry?.source).toBe('link');

    // The operator ALSO logs a manual phone inquiry attached to that same client.
    const manual = await logInquiry(form({ source: 'phone', clientId }));
    expect(manual.ok).toBe(true);

    const rows = await listInquiries(ownerId);
    expect(rows).toHaveLength(2); // two real rows: one link, one phone
    const sources = rows.map((r) => r.source).sort();
    expect(sources).toEqual(['link', 'phone']);

    // AR12: the denominator dedupes the same contact to ONE distinct inquiry.
    expect(distinctInquiryCount(rows)).toBe(1);
  });

  it('two manual logs for DIFFERENT clients → distinctInquiryCount = 2', async () => {
    const [c1] = await db
      .insert(client)
      .values({ ownerId, name: 'C1', phone: '555-1', cadence: 'weekly' })
      .returning();
    const [c2] = await db
      .insert(client)
      .values({ ownerId, name: 'C2', phone: '555-2', cadence: 'weekly' })
      .returning();

    await logInquiry(form({ source: 'phone', clientId: c1.id }));
    await logInquiry(form({ source: 'walk-in', clientId: c2.id }));

    const rows = await listInquiries(ownerId);
    expect(rows).toHaveLength(2);
    expect(distinctInquiryCount(rows)).toBe(2);
  });

  it('two anonymous (no-client) manual logs → distinctInquiryCount = 2', async () => {
    await logInquiry(form({ source: 'phone' }));
    await logInquiry(form({ source: 'referral' }));

    const rows = await listInquiries(ownerId);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.clientId === null)).toBe(true);
    expect(distinctInquiryCount(rows)).toBe(2);
  });
});
