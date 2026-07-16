// Story 1.7 — end-to-end capacity read through the action layer against the
// Docker Postgres. Proves derive-on-read (AD-7) over REAL rows: room-left,
// day-maxed, nearest-open, and that flipping a job to `cancelled` frees the slot
// on the very next read with no counter to adjust.
//
// Rows are inserted DIRECTLY (not via commitBooking) so the test can place them on
// this week's Monday regardless of the run date — a read path has no past-date
// guard. Dates are derived from the same clock the action uses, so assertions hold
// on any day of the week.
import { describe, it, expect, beforeAll, vi } from 'vitest';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { sql } from 'drizzle-orm';
import { db } from '../lib/db/client';
import { operator, client, capacitySettings, job } from '../lib/db/schema';
import { seedOperator } from '../lib/db/seed';
import { getOwnerId } from '../lib/db/queries';
import { DEFAULT_CAPACITY } from '../lib/domain/capacityConfig';
import { localDateKey, weekRangeOfDate, addDaysToDate } from '../lib/domain/clock';
import { getDashboardCapacity } from '../app/(operator)/actions';

let ownerId: string;
let clientId: string;

// This week's Monday + Tuesday, operator-local (both are working days by default).
const today = localDateKey(new Date(), DEFAULT_CAPACITY.timezone);
const MON = weekRangeOfDate(today).monday;
const TUE = addDaysToDate(MON, 1);

async function insertJob(date: string, completion: string, key: string) {
  await db.insert(job).values({
    ownerId,
    clientId,
    date,
    completion: completion as 'booked' | 'completed' | 'no-show' | 'cancelled',
    priceCents: DEFAULT_CAPACITY.defaultJobPriceCents,
    idempotencyKey: key,
  });
}

describe('Dashboard capacity read (Story 1.7, derive-on-read)', () => {
  beforeAll(async () => {
    await db.execute(
      sql`truncate table ${job}, ${capacitySettings}, ${client}, ${operator} restart identity cascade`,
    );
    await seedOperator();
    ownerId = await getOwnerId();
    const [c] = await db
      .insert(client)
      .values({
        ownerId,
        name: 'Acme',
        phone: '555-0100',
        cadence: 'weekly',
      })
      .returning({ id: client.id });
    clientId = c.id;

    // Fill Monday to the per-day cap (3 consuming), plus one on Tuesday.
    await insertJob(MON, 'booked', 'k-mon-1');
    await insertJob(MON, 'booked', 'k-mon-2');
    await insertJob(MON, 'no-show', 'k-mon-3'); // no-show still consumes (AD-2)
    await insertJob(TUE, 'booked', 'k-tue-1');
    await insertJob(MON, 'cancelled', 'k-mon-cancelled'); // does NOT consume
  });

  it('derives room-left, day-maxed and nearest-open from canonical rows', async () => {
    const cap = await getDashboardCapacity();

    // 4 consuming this week (3 Mon + 1 Tue); cancelled ignored → 14 − 4 = 10.
    expect(cap.consuming).toBe(4);
    expect(cap.roomLeft).toBe(10);
    expect(cap.over).toBe(0);
    expect(cap.weeklyCeiling).toBe(14);

    const mon = cap.days.find((d) => d.date === MON)!;
    expect(mon.consuming).toBe(3);
    expect(mon.maxed).toBe(true);
    // Monday is maxed → surface the next open working day. Tuesday has 1/3 and the
    // week is under ceiling, so nearest-open is Tuesday.
    expect(mon.nextOpen).toBe(TUE);

    const tue = cap.days.find((d) => d.date === TUE)!;
    expect(tue.maxed).toBe(false);
    expect(tue.nextOpen).toBeNull();
  });

  it('cancelling a Monday job frees the slot on the next read (no stored counter)', async () => {
    // Flip one consuming Monday job to cancelled — the ONLY change.
    await db
      .update(job)
      .set({ completion: 'cancelled' })
      .where(sql`${job.idempotencyKey} = 'k-mon-1' and ${job.ownerId} = ${ownerId}`);

    const cap = await getDashboardCapacity();
    expect(cap.consuming).toBe(3); // was 4
    expect(cap.roomLeft).toBe(11); // was 10 — recomputed, nothing invalidated
    const mon = cap.days.find((d) => d.date === MON)!;
    expect(mon.consuming).toBe(2);
    expect(mon.maxed).toBe(false); // 2 < 3 → no longer maxed
    expect(mon.nextOpen).toBeNull();
  });
});
