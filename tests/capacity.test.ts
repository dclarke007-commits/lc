// Story 1.3 — capacity settings: getOwnerCapacity / saveCapacitySettings Server
// Actions against the Docker Postgres (serial, singleFork — see vitest.config).
// Do NOT end the shared pool here (see seed.test.ts).
//
// revalidatePath needs a request store absent in a unit test, so next/cache is
// mocked to a no-op — orthogonal to the DB contract here.
import { describe, it, expect, beforeAll, vi } from 'vitest';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { sql } from 'drizzle-orm';
import { db } from '../lib/db/client';
import { operator, client, capacitySettings } from '../lib/db/schema';
import { seedOperator } from '../lib/db/seed';
import { getOwnerId, getCapacitySettings } from '../lib/db/queries';
import { DEFAULT_CAPACITY } from '../lib/domain/capacityConfig';
import {
  getOwnerCapacity,
  saveCapacitySettings,
} from '../app/(operator)/settings/actions';

function form(fields: Record<string, string | string[]>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) {
    if (Array.isArray(v)) for (const item of v) fd.append(k, item);
    else fd.set(k, v);
  }
  return fd;
}

// A valid full edit: Mon–Fri, cap 4, ceiling 20, $250, Eastern.
const VALID = {
  workingDays: ['1', '2', '3', '4', '5'],
  perDayCap: '4',
  weeklyCeiling: '20',
  defaultJobPrice: '250',
  timezone: 'America/New_York',
};

let ownerId: string;

describe('Capacity settings actions (Story 1.3)', () => {
  beforeAll(async () => {
    // Clean slate: cascade clears dependent rows too (FK). Then re-seed the owner.
    await db.execute(
      sql`truncate table ${capacitySettings}, ${client}, ${operator} restart identity cascade`,
    );
    await seedOperator();
    ownerId = await getOwnerId();
  });

  it('getOwnerCapacity returns DEFAULT_CAPACITY when no row exists (AC1)', async () => {
    const config = await getOwnerCapacity();
    expect(config).toEqual(DEFAULT_CAPACITY);
    // Sanity: the literal FR1/AC1 defaults.
    expect(config.workingDays).toEqual([1, 2, 3, 4, 5, 6]);
    expect(config.perDayCap).toBe(3);
    expect(config.weeklyCeiling).toBe(14);
    expect(config.defaultJobPriceCents).toBe(20000);
    expect(config.timezone).toBe('America/Chicago');
    // No row was materialised by a read.
    expect(await getCapacitySettings(ownerId)).toBeUndefined();
  });

  it('saveCapacitySettings persists an edit; getOwnerCapacity reflects it (AC2)', async () => {
    const result = await saveCapacitySettings(form(VALID));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Typed { ok:true, data } with dollars→cents conversion (AR16).
    expect(result.data.workingDays).toEqual([1, 2, 3, 4, 5]);
    expect(result.data.perDayCap).toBe(4);
    expect(result.data.weeklyCeiling).toBe(20);
    expect(result.data.defaultJobPriceCents).toBe(25000);
    expect(result.data.timezone).toBe('America/New_York');

    // Reload reflects it.
    const reloaded = await getOwnerCapacity();
    expect(reloaded).toEqual({
      workingDays: [1, 2, 3, 4, 5],
      perDayCap: 4,
      weeklyCeiling: 20,
      defaultJobPriceCents: 25000,
      timezone: 'America/New_York',
    });

    // Persisted as a single owner-scoped row.
    const row = await getCapacitySettings(ownerId);
    expect(row?.ownerId).toBe(ownerId);
    expect(row?.defaultJobPriceCents).toBe(25000);
  });

  it('a second save UPSERTs the same single row (no duplicate)', async () => {
    const first = await saveCapacitySettings(form({ ...VALID, perDayCap: '2' }));
    expect(first.ok).toBe(true);
    const rows = await db
      .select()
      .from(capacitySettings);
    expect(rows).toHaveLength(1);
    expect(rows[0].perDayCap).toBe(2);
  });

  it('ceiling < per-day → ceiling-below-per-day, nothing changes (AC2)', async () => {
    const before = await getCapacitySettings(ownerId);
    const result = await saveCapacitySettings(
      form({ ...VALID, perDayCap: '10', weeklyCeiling: '5' }),
    );
    expect(result).toEqual({ ok: false, reason: 'ceiling-below-per-day' });
    const after = await getCapacitySettings(ownerId);
    expect(after).toEqual(before);
  });

  it('per-day cap 0 → per-day-cap-invalid, nothing written', async () => {
    const before = await getCapacitySettings(ownerId);
    const result = await saveCapacitySettings(
      form({ ...VALID, perDayCap: '0' }),
    );
    expect(result).toEqual({ ok: false, reason: 'per-day-cap-invalid' });
    expect(await getCapacitySettings(ownerId)).toEqual(before);
  });

  it('empty workingDays → working-days-required, nothing written', async () => {
    const before = await getCapacitySettings(ownerId);
    const result = await saveCapacitySettings(
      form({
        perDayCap: '4',
        weeklyCeiling: '20',
        defaultJobPrice: '250',
        timezone: 'America/New_York',
        // no workingDays key at all
      }),
    );
    expect(result).toEqual({ ok: false, reason: 'working-days-required' });
    expect(await getCapacitySettings(ownerId)).toEqual(before);
  });

  it('bad timezone → timezone-invalid, nothing written', async () => {
    const before = await getCapacitySettings(ownerId);
    const result = await saveCapacitySettings(
      form({ ...VALID, timezone: 'Mars/Phobos' }),
    );
    expect(result).toEqual({ ok: false, reason: 'timezone-invalid' });
    expect(await getCapacitySettings(ownerId)).toEqual(before);
  });
});
