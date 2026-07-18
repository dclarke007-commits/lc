// Epic 6 hardening (retro action item 1) — owner-scoping db-integration tests for the
// dashboard/export data paths. Runs against the Docker Postgres (see vitest.config;
// serial/singleFork), mirroring tests/ledger-mark-paid.test.ts.
//
// The schema enforces a SINGLE operator (operator_singleton unique index on `(true)`),
// so a second real tenant cannot be inserted — cross-tenant leakage between two live
// operators is physically impossible to construct here. What these tests LOCK instead is
// that every dashboard/export read applies the owner_id FILTER on the VALUE (AD-8/AR9):
// the seeded owner's rows come back for that owner, and a DIFFERENT (bogus) owner_id
// returns NOTHING. That is the exact property that keeps the future multi-tenant seam
// safe — the queries never return rows the passed owner_id does not own.

import { describe, it, expect, beforeAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { db } from '../lib/db/client';
import { operator, client, capacitySettings, job, inquiry } from '../lib/db/schema';
import { seedOperator } from '../lib/db/seed';
import {
  getOwnerId,
  listJobsForMetrics,
  listJobsForExport,
  listInquiries,
} from '../lib/db/queries';

const DATE = '2026-07-20';
let ownerId: string;
let clientId: string;

describe('dashboard/export owner-scoping (Epic 6 hardening, AR9/AD-8)', () => {
  beforeAll(async () => {
    await db.execute(
      sql`truncate table ${inquiry}, ${job}, ${capacitySettings}, ${client}, ${operator} restart identity cascade`,
    );
    await seedOperator();
    ownerId = await getOwnerId();
    const [c] = await db
      .insert(client)
      .values({ ownerId, name: 'Ada, "Boss" Test', phone: '555-0100', cadence: 'weekly' })
      .returning();
    clientId = c.id;
    await db.insert(job).values({
      ownerId,
      clientId,
      date: DATE,
      completion: 'completed',
      payment: 'owed',
      priceCents: 20000,
      idempotencyKey: randomUUID(),
      completedAt: new Date().toISOString(),
    });
    await db.insert(inquiry).values({ ownerId, clientId, source: 'phone', sessionNonce: null });
  });

  it('listJobsForMetrics: seeded owner sees its row; a bogus owner sees none', async () => {
    const mine = await listJobsForMetrics(ownerId);
    expect(mine).toHaveLength(1);
    expect(mine[0].clientId).toBe(clientId);

    const other = await listJobsForMetrics(randomUUID());
    expect(other).toHaveLength(0);
  });

  it('listJobsForExport: seeded owner sees its row (with client name); a bogus owner sees none', async () => {
    const mine = await listJobsForExport(ownerId);
    expect(mine).toHaveLength(1);
    expect(mine[0].clientName).toBe('Ada, "Boss" Test');
    expect(mine[0].priceCents).toBe(20000);

    const other = await listJobsForExport(randomUUID());
    expect(other).toHaveLength(0);
  });

  it('listInquiries: seeded owner sees its row; a bogus owner sees none', async () => {
    expect(await listInquiries(ownerId)).toHaveLength(1);
    expect(await listInquiries(randomUUID())).toHaveLength(0);
  });
});
