// Task 4 — the tokenless NEW-CLIENT public request core (homepage self-serve), exercised
// against the Docker Postgres (serial, singleFork — see vitest.config.ts). Mirrors
// tests/public-request.test.ts's invariants but WITHOUT a token: owner_id comes from the
// single-owner lookup getOwnerId() (never the form — AR7/AD-6), there is no per-client
// offered-slot set to re-derive (the date is a stated preference), and capacity is still
// NEVER consumed (AR5). The write reuses source='link' (the `web` enum value was dropped;
// dedup rides the existing inquiry_owner_session_link_uq partial index).
// Do NOT end the shared pool here.
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '../lib/db/client';
import {
  operator,
  client,
  pendingRequest,
  inquiry,
  job,
  messageLog,
  token,
  capacitySettings,
  messageTemplate,
} from '../lib/db/schema';
import { seedOperator } from '../lib/db/seed';
import { getOwnerId } from '../lib/db/queries';
import { submitPublicRequestNoToken } from '../app/request/request';

let ownerId: string;

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
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

beforeAll(async () => {
  await seedOperator();
  ownerId = await getOwnerId();
});

// Clean slate each test: clear only the CHILD tables this path touches (or that could
// hold FK-restrict references to `client`), in FK-safe order — never `db.delete(operator)`
// here (it is a DB-enforced singleton; see the dedicated fail-closed test below).
beforeEach(async () => {
  await db.delete(inquiry);
  await db.delete(pendingRequest);
  await db.delete(messageLog);
  await db.delete(job);
  await db.delete(token);
  await db.delete(client);
});

// Test-env isolation discipline: the "no operator seeded" test below deletes the
// singleton operator row. Restore it here so later serial test files are never poisoned.
afterEach(async () => {
  const existing = await db.select({ id: operator.id }).from(operator).limit(1);
  if (existing.length === 0) {
    const seeded = await seedOperator();
    ownerId = seeded.ownerId;
  }
});

describe('submitPublicRequestNoToken', () => {
  it('creates provisional client + pending request + link inquiry, no capacity', async () => {
    const res = await submitPublicRequestNoToken(
      fd({ name: 'Sam', phone: '555-1', address: '1 St', date: '2026-08-04', visit: 's1' }),
    );
    expect(res.ok).toBe(true);

    const clients = await db.select().from(client).where(eq(client.ownerId, ownerId));
    const reqs = await db.select().from(pendingRequest).where(eq(pendingRequest.ownerId, ownerId));
    const inqs = await db.select().from(inquiry).where(eq(inquiry.ownerId, ownerId));
    const jobs = await db.select().from(job).where(eq(job.ownerId, ownerId));

    expect(clients).toHaveLength(1);
    expect(clients[0].status).toBe('provisional');
    expect(reqs).toHaveLength(1);
    expect(inqs).toHaveLength(1);
    expect(inqs[0].source).toBe('link');
    expect(jobs).toHaveLength(0); // AR5 — never consumes capacity
  });

  it('is idempotent within one visit session (double-submit same day)', async () => {
    const same = { name: 'Sam', phone: '555-1', address: '1 St', date: '2026-08-04', visit: 'dup' };
    const a = await submitPublicRequestNoToken(fd(same));
    const b = await submitPublicRequestNoToken(fd(same));
    expect(a.ok && b.ok).toBe(true);
    const reqs = await db.select().from(pendingRequest);
    expect(reqs).toHaveLength(1); // one row, not two
  });

  it('rejects missing required fields with a masked-able reason', async () => {
    const res = await submitPublicRequestNoToken(fd({ name: '', phone: '', date: '' }));
    expect(res.ok).toBe(false);
    expect(await countRows()).toMatchObject({ clients: 0, requests: 0, inquiries: 0 });
  });

  it('fails closed when no operator is seeded', async () => {
    // operator.id is FK-restrict-referenced by every owner-scoped table (AD-8); clear the
    // ones this file's beforeEach does not touch (leftover from other serial test files'
    // seeding) so the delete below can actually succeed.
    await db.delete(capacitySettings);
    await db.delete(messageTemplate);
    await db.delete(operator);
    const res = await submitPublicRequestNoToken(
      fd({ name: 'Sam', phone: '555', date: '2026-08-04', visit: 'x' }),
    );
    expect(res.ok).toBe(false);
    // afterEach above restores the singleton operator for later serial test files.
  });
});
