// INTEGRATION FLOW — the ledger → data-export path, end to end across MANY modules.
//
// Sequence: bookings are committed across payment/completion states → the operator marks
// one paid → the CSV export (owner-scoped read → RFC-4180 serialization) reflects paid vs
// unpaid correctly AND the CWE-1236 formula-injection guard neutralizes stranger-controlled
// client names that begin with =/+/-/@ before they can execute as spreadsheet formulas.
// This spans capacity → lifecycle → ledger → the queries + csv serialization the export
// action composes — the whole "the operator owns their data" pipe, not one function.
//
// Spans: capacity.commitBooking → lifecycle.markCompleted → ledger.markPaid →
//   export/actions.exportJobsCsv & exportClientsCsv (→ queries.listJobsForExport/listClients
//   → domain/csv.toCsv).
//
// Harness: fake ONLY Date pinned to a Monday so commitBooking's target dates are genuine
// future working days under the seeded all-7-day config.
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { db } from '../../lib/db/client';
import { client, job, capacitySettings, pendingRequest, inquiry, messageLog, token } from '../../lib/db/schema';
import { seedOperator } from '../../lib/db/seed';
import { getOwnerId } from '../../lib/db/queries';
import { commitBooking } from '../../lib/domain/capacity';
import { markCompleted } from '../../lib/domain/lifecycle';
import { markPaid } from '../../lib/domain/ledger';
import { exportJobsCsv, exportClientsCsv } from '../../app/(operator)/export/actions';
import type { CapacityConfig } from '../../lib/domain/capacityConfig';

const FIXED_MONDAY = new Date('2026-07-20T12:00:00.000Z'); // → 2026-07-20 in America/Chicago
const OPEN_CONFIG: CapacityConfig = {
  workingDays: [1, 2, 3, 4, 5, 6, 7],
  perDayCap: 3,
  weeklyCeiling: 14,
  defaultJobPriceCents: 20000,
  timezone: 'America/Chicago',
};

let ownerId: string;

function futureDate(daysAhead: number): string {
  const d = new Date(FIXED_MONDAY);
  d.setUTCDate(d.getUTCDate() + daysAhead);
  return d.toISOString().slice(0, 10);
}

async function insertClient(
  name: string,
  status: 'active' | 'provisional' = 'active',
  cadence = 'weekly',
): Promise<string> {
  const [row] = await db
    .insert(client)
    .values({ ownerId, name, phone: '555-0100', cadence: cadence as 'weekly', status })
    .returning();
  return row.id;
}

beforeAll(async () => {
  await seedOperator();
  ownerId = await getOwnerId();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(FIXED_MONDAY);
});

afterAll(() => {
  vi.useRealTimers();
});

beforeEach(async () => {
  await db.delete(inquiry);
  await db.delete(pendingRequest);
  await db.delete(messageLog);
  await db.delete(job);
  await db.delete(token);
  await db.delete(client);
  await db.delete(capacitySettings);
  await db.insert(capacitySettings).values({ ownerId, ...OPEN_CONFIG });
});

describe('Ledger → CSV export flow — states → mark paid → export reflects paid/unpaid', () => {
  it('the jobs export reflects each job’s real completion+payment state after the lifecycle/ledger writes', async () => {
    const clientId = await insertClient('Nina Normal');

    const jPaid = await commitBooking({ ownerId, clientId, date: futureDate(2), override: false, idempotencyKey: 'p' });
    const jOwed = await commitBooking({ ownerId, clientId, date: futureDate(3), override: false, idempotencyKey: 'o' });
    const jBooked = await commitBooking({ ownerId, clientId, date: futureDate(4), override: false, idempotencyKey: 'b' });
    expect(jPaid.ok && jOwed.ok && jBooked.ok).toBe(true);
    if (!jPaid.ok || !jOwed.ok || !jBooked.ok) return;

    // Drive the states: one completed+paid, one completed+owed, one left booked+owed.
    expect((await markCompleted(ownerId, jPaid.data.id)).ok).toBe(true);
    expect((await markPaid(ownerId, jPaid.data.id)).ok).toBe(true);
    expect((await markCompleted(ownerId, jOwed.data.id)).ok).toBe(true);

    const res = await exportJobsCsv();
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const lines = res.data.content.split('\r\n');
    expect(lines[0]).toBe(
      'id,client_name,date,completion,payment,price_cents,completed_at,created_at',
    );
    const rowFor = (id: string) => lines.find((l) => l.startsWith(`${id},`))!;

    // completion + payment columns are contiguous — assert the exact pair per job.
    expect(rowFor(jPaid.data.id)).toContain(',completed,paid,20000,');
    expect(rowFor(jOwed.data.id)).toContain(',completed,owed,20000,');
    expect(rowFor(jBooked.data.id)).toContain(',booked,owed,20000,');
  });

  it('CWE-1236: a client name starting with a formula trigger is neutralized in BOTH exports', async () => {
    // A provisional (public-self-booking-style) client whose name would execute as a
    // spreadsheet formula, and which also carries a comma (RFC-4180 quoting must compose).
    const evil = '=cmd,inject';
    const clientId = await insertClient(evil, 'provisional', 'one-time');
    const commit = await commitBooking({
      ownerId,
      clientId,
      date: futureDate(2),
      override: false,
      idempotencyKey: 'evil',
    });
    expect(commit.ok).toBe(true);

    const jobs = await exportJobsCsv();
    expect(jobs.ok).toBe(true);
    if (jobs.ok) {
      // Leading '=' → prefixed with a single quote (neutralized), then quote-wrapped for the
      // embedded comma → the two layers compose to "'=cmd,inject".
      expect(jobs.data.content).toContain(`"'=cmd,inject"`);
      // The raw name never appears as a bare, comma-split cell (which would execute on open).
      expect(jobs.data.content).not.toContain(`,=cmd,inject,`);
    }

    const clients = await exportClientsCsv();
    expect(clients.ok).toBe(true);
    if (clients.ok) {
      expect(clients.data.content).toContain(`"'=cmd,inject"`);
      expect(clients.data.content).not.toContain(`,=cmd,inject,`);
    }
  });
});
