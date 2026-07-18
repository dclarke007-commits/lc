// E2E global setup — runs ONCE before any spec. Establishes a known-good, idempotent
// DB state against the Docker Postgres, mirroring the FK-safe delete order and the
// known-good capacity row from tests/public-request.test.ts (prior suites intentionally
// leave an INVALID timezone on the shared owner, which would otherwise make the public
// booking view resolve null). Seeds the fixtures the browser flows need:
//   - a known ACTIVE weekly client (bookable in /bookings; rebookable in /jobs)
//   - one COMPLETED + PAID job for that client (drives rebooking + ledger export)
// then mints the ONE public self-serve token and writes token + ids + a bookable date
// to tests/e2e/.state/e2e-state.json for the specs to read.
//
// Runs in a plain Node context (like the Vitest suite), so importing lib/domain + lib/db
// directly is fine — `server-only` is a no-op outside a React Server bundle.

import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { db, pool } from '@/lib/db/client';
import {
  client,
  token,
  job,
  capacitySettings,
  pendingRequest,
  inquiry,
  messageLog,
} from '@/lib/db/schema';
import { seedOperator } from '@/lib/db/seed';
import { getOwnerId } from '@/lib/db/queries';
import { ensurePublicToken } from '@/lib/domain/publicToken';

const STATE_DIR = join(dirname(fileURLToPath(import.meta.url)), '.state');

/** 'YYYY-MM-DD' for `now + days` (calendar-day arithmetic; tz drift is immaterial here). */
function isoDay(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

export default async function globalSetup(): Promise<void> {
  await seedOperator(); // idempotent — keeps the existing single owner (never deleted).
  const ownerId = await getOwnerId();

  // FK-safe clean slate: dependents before the client rows they reference.
  // message_log.client_id is ON DELETE restrict, so it must precede `client`.
  await db.delete(inquiry);
  await db.delete(pendingRequest);
  await db.delete(messageLog);
  await db.delete(job);
  await db.delete(token);
  await db.delete(client);
  await db.delete(capacitySettings);

  // Known-good capacity: every weekday worked, valid tz → "today" is always an open day.
  await db.insert(capacitySettings).values({
    ownerId,
    workingDays: [1, 2, 3, 4, 5, 6, 7],
    perDayCap: 3,
    weeklyCeiling: 14,
    defaultJobPriceCents: 20000,
    timezone: 'America/Chicago',
  });

  // A known ACTIVE, weekly client — bookable in /bookings and rebookable in /jobs.
  const [activeClient] = await db
    .insert(client)
    .values({
      ownerId,
      name: 'Regular Regina',
      phone: '555-0142',
      address: '42 Repeat Row',
      cadence: 'weekly',
      status: 'active',
    })
    .returning();

  // One COMPLETED + PAID job (last week) for that client: gives /jobs a rebookable row
  // and gives the CSV export a real jobs row to serialize.
  const [completedJob] = await db
    .insert(job)
    .values({
      ownerId,
      clientId: activeClient.id,
      date: isoDay(-7),
      completion: 'completed',
      payment: 'paid',
      priceCents: 20000,
      idempotencyKey: `e2e-seed-completed-${Date.now()}`,
      completedAt: new Date().toISOString(),
    })
    .returning();

  // A second COMPLETED job left OWED (payment defaults to 'owed'): the drivable row for
  // the mark-paid E2E (Story 5.4). Distinct date from the paid job so the two never
  // collide. At mark-paid time this is the only completed+owed job in the DB, so the
  // spec can click "Mark paid".first() deterministically.
  const [owedJob] = await db
    .insert(job)
    .values({
      ownerId,
      clientId: activeClient.id,
      date: isoDay(-6),
      completion: 'completed',
      priceCents: 20000,
      idempotencyKey: `e2e-seed-owed-${Date.now()}`,
      completedAt: new Date().toISOString(),
    })
    .returning();

  // The ONE public self-serve booking token (distinct PUBLIC_TOKEN_SECRET capability).
  const publicToken = await ensurePublicToken(ownerId);

  mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(
    join(STATE_DIR, 'e2e-state.json'),
    JSON.stringify(
      {
        ownerId,
        publicToken,
        activeClientId: activeClient.id,
        activeClientName: activeClient.name,
        completedJobId: completedJob.id,
        completedOwedJobId: owedJob.id,
        // A near-future open day for the operator booking flow (all weekdays worked).
        bookingDate: isoDay(2),
      },
      null,
      2,
    ),
  );

  await pool.end();
}
