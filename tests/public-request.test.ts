// Story 4.2 — the NEW-CLIENT public booking REQUEST (submit → provisional client +
// PendingRequest + one `link` Inquiry), exercised against the Docker Postgres (serial,
// singleFork — see vitest.config.ts). This pins the AR5 invariant (a request holds NO
// capacity: no Job, no cap change), the AR12 invariant (at most one `link` inquiry per
// token-visit session, whole-submission idempotent on the visit nonce), the fail-closed
// token chain (invalid / tampered / cross-capability / weak-secret), and the
// re-derive-the-offered-set guard (a date the view never offered → no-availability).
// Do NOT end the shared pool here.
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { eq, and } from 'drizzle-orm';
import { db } from '../lib/db/client';
import {
  client,
  token,
  job,
  capacitySettings,
  pendingRequest,
  inquiry,
  messageLog,
} from '../lib/db/schema';
import { seedOperator } from '../lib/db/seed';
import { getOwnerId } from '../lib/db/queries';
import {
  ensurePublicToken,
  resolvePublicBookingView,
} from '../lib/domain/publicToken';
import { ensureClientToken } from '../lib/domain/booking';
import { generateTokenNonce } from '../lib/auth/clientToken';
import { submitPublicRequestResult } from '../app/book/[token]/request';

let ownerId: string;

/** Build the stranger's submission FormData. `visit` defaults to a fresh nonce. */
function buildForm(fields: {
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
  if (fields.visit !== undefined) fd.set('visit', fields.visit);
  return fd;
}

async function countRows() {
  const [clients, requests, inquiries, jobs] = await Promise.all([
    db.select().from(client).where(eq(client.ownerId, ownerId)),
    db.select().from(pendingRequest).where(eq(pendingRequest.ownerId, ownerId)),
    db.select().from(inquiry).where(eq(inquiry.ownerId, ownerId)),
    db.select().from(job).where(eq(job.ownerId, ownerId)),
  ]);
  return {
    clients: clients.length,
    requests: requests.length,
    inquiries: inquiries.length,
    jobs: jobs.length,
  };
}

/** An open day the public view actually offers (deterministic under the seeded config). */
async function anOpenDate(): Promise<string> {
  const tokenValue = await ensurePublicToken(ownerId);
  const view = await resolvePublicBookingView(tokenValue);
  if (!view.ok || view.view.openSlots.length === 0) {
    throw new Error('test setup: expected open slots');
  }
  return view.view.openSlots[0].date;
}

beforeAll(async () => {
  await seedOperator();
  ownerId = await getOwnerId();
});

// Clean slate each test: no jobs/tokens/requests/inquiries, and a KNOWN-GOOD capacity
// settings row (all-week working, valid tz) so "today" is always an offered open day —
// prior test files intentionally leave an INVALID timezone on the shared owner (serial
// DB), which would otherwise make the happy-path view resolve null.
beforeEach(async () => {
  // FK-safe delete order: dependents before the client rows they reference. `client`
  // is cleared too (unlike public-token.test) because AC1/AC2 assert exact owner client
  // counts, and provisional clients from earlier tests/files would otherwise accumulate.
  // message_log.client_id is ON DELETE restrict, so it must go before client.
  await db.delete(inquiry);
  await db.delete(pendingRequest);
  await db.delete(messageLog);
  await db.delete(job);
  await db.delete(token);
  await db.delete(client);
  await db.delete(capacitySettings);
  await db.insert(capacitySettings).values({
    ownerId,
    workingDays: [1, 2, 3, 4, 5, 6, 7],
    perDayCap: 3,
    weeklyCeiling: 14,
    defaultJobPriceCents: 20000,
    timezone: 'America/Chicago',
  });
});

describe('Story 4.2 AC1 — provisional client + non-capacity pending request', () => {
  it('creates a provisional client + one pending request and consumes NO capacity', async () => {
    const tokenValue = await ensurePublicToken(ownerId);
    const date = await anOpenDate();

    const res = await submitPublicRequestResult(
      tokenValue,
      buildForm({ name: 'Ada Lovelace', phone: '555-0101', address: '1 Byron St', date }),
    );
    expect(res.ok).toBe(true);

    const clients = await db.select().from(client).where(eq(client.ownerId, ownerId));
    expect(clients).toHaveLength(1);
    expect(clients[0].status).toBe('provisional');
    expect(clients[0].cadence).toBe('one-time');
    expect(clients[0].name).toBe('Ada Lovelace');
    expect(clients[0].address).toBe('1 Byron St');

    const requests = await db
      .select()
      .from(pendingRequest)
      .where(eq(pendingRequest.ownerId, ownerId));
    expect(requests).toHaveLength(1);
    expect(requests[0].clientId).toBe(clients[0].id);
    expect(requests[0].date).toBe(date);
    expect(requests[0].status).toBe('pending');

    // AR5: a request holds NO capacity — not a single Job row was written.
    const jobs = await db.select().from(job).where(eq(job.ownerId, ownerId));
    expect(jobs).toHaveLength(0);
  });

  it('stores a null address when omitted', async () => {
    const tokenValue = await ensurePublicToken(ownerId);
    const date = await anOpenDate();
    await submitPublicRequestResult(tokenValue, buildForm({ date }));
    const clients = await db.select().from(client).where(eq(client.ownerId, ownerId));
    expect(clients[0].address).toBeNull();
  });

  it('rejects a submission missing name or phone, writing nothing', async () => {
    const tokenValue = await ensurePublicToken(ownerId);
    const date = await anOpenDate();

    const noName = await submitPublicRequestResult(
      tokenValue,
      buildForm({ name: '   ', date }),
    );
    expect(noName.ok).toBe(false);

    const noPhone = await submitPublicRequestResult(
      tokenValue,
      buildForm({ phone: '', date }),
    );
    expect(noPhone.ok).toBe(false);

    expect(await countRows()).toMatchObject({ clients: 0, requests: 0, inquiries: 0 });
  });
});

describe('Story 4.2 AC2 — at most one `link` inquiry per token-visit session', () => {
  it('logs exactly one `link` inquiry and is fully idempotent on the same visit nonce', async () => {
    const tokenValue = await ensurePublicToken(ownerId);
    const date = await anOpenDate();
    const visit = generateTokenNonce();

    const first = await submitPublicRequestResult(tokenValue, buildForm({ date, visit }));
    const second = await submitPublicRequestResult(tokenValue, buildForm({ date, visit }));

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (first.ok) expect(first.data.created).toBe(true);
    if (second.ok) expect(second.data.created).toBe(false); // idempotent no-op

    // The whole submission is idempotent: one client, one request, one inquiry.
    const counts = await countRows();
    expect(counts).toMatchObject({ clients: 1, requests: 1, inquiries: 1 });

    const inquiries = await db.select().from(inquiry).where(eq(inquiry.ownerId, ownerId));
    expect(inquiries[0].source).toBe('link');
    expect(inquiries[0].sessionNonce).toBe(visit);
  });

  it('a DIFFERENT visit session logs a second inquiry (distinct sessions)', async () => {
    const tokenValue = await ensurePublicToken(ownerId);
    const date = await anOpenDate();

    await submitPublicRequestResult(tokenValue, buildForm({ date, visit: generateTokenNonce() }));
    await submitPublicRequestResult(tokenValue, buildForm({ date, visit: generateTokenNonce() }));

    expect(await countRows()).toMatchObject({ clients: 2, requests: 2, inquiries: 2 });
  });
});

describe('Story 4.2 — fail-closed token chain', () => {
  it('rejects invalid / tampered / unknown / empty tokens, writing nothing', async () => {
    const date = '2999-01-01';
    for (const bad of ['', 'not-a-token', 'a.b', `${'x'.repeat(20)}.deadbeef`]) {
      const res = await submitPublicRequestResult(bad, buildForm({ date }));
      expect(res.ok).toBe(false);
    }
    expect(await countRows()).toMatchObject({ clients: 0, requests: 0, inquiries: 0 });
  });

  it('a per-client token NEVER resolves on the public request path (cross-capability)', async () => {
    const [c] = await db
      .insert(client)
      .values({ ownerId, name: 'Known', phone: '555-0001', cadence: 'weekly' })
      .returning();
    const clientToken = await ensureClientToken(ownerId, c.id);
    const date = await anOpenDate();

    const res = await submitPublicRequestResult(clientToken, buildForm({ date }));
    expect(res.ok).toBe(false);

    // No NEW provisional client / request / inquiry (the known client above is the only row).
    const provisional = await db
      .select()
      .from(client)
      .where(and(eq(client.ownerId, ownerId), eq(client.status, 'provisional')));
    expect(provisional).toHaveLength(0);
    expect(await countRows()).toMatchObject({ requests: 0, inquiries: 0 });
  });

  it('fails closed when PUBLIC_TOKEN_SECRET is missing or weak, writing nothing', async () => {
    const tokenValue = await ensurePublicToken(ownerId);
    const date = await anOpenDate();
    const original = process.env.PUBLIC_TOKEN_SECRET;
    try {
      process.env.PUBLIC_TOKEN_SECRET = '';
      expect((await submitPublicRequestResult(tokenValue, buildForm({ date }))).ok).toBe(false);
      process.env.PUBLIC_TOKEN_SECRET = 'too-short';
      expect((await submitPublicRequestResult(tokenValue, buildForm({ date }))).ok).toBe(false);
    } finally {
      process.env.PUBLIC_TOKEN_SECRET = original;
    }
    expect(await countRows()).toMatchObject({ clients: 0, requests: 0, inquiries: 0 });
  });
});

describe('Story 4.2 — offered-set + corrupt-config guards', () => {
  it('rejects a date the public view never offered (no-availability), writing nothing', async () => {
    const tokenValue = await ensurePublicToken(ownerId);
    // A date in the far past is genuinely NOT in the current-week open set.
    const res = await submitPublicRequestResult(tokenValue, buildForm({ date: '2000-01-01' }));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('no-availability');
    expect(await countRows()).toMatchObject({ clients: 0, requests: 0, inquiries: 0 });
  });

  it('fails closed (no 500) when the owner timezone is corrupt', async () => {
    const tokenValue = await ensurePublicToken(ownerId);
    await db
      .update(capacitySettings)
      .set({ timezone: 'Not/ARealZone' })
      .where(eq(capacitySettings.ownerId, ownerId));

    const res = await submitPublicRequestResult(tokenValue, buildForm({ date: '2999-01-01' }));
    expect(res.ok).toBe(false);
    expect(await countRows()).toMatchObject({ clients: 0, requests: 0, inquiries: 0 });
  });
});
