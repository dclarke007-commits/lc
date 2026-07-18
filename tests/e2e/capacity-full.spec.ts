// Error-path E2E: booking past a full day is rejected (authenticated, FR9). The seed
// sets perDayCap = 3. This spec books that many jobs on a DEDICATED far-future date
// (today+20) — isolated from every other spec's date so it neither depends on nor
// perturbs their shared serial DB state — then attempts one more and asserts the
// capacity dead-end banner (day-maxed → "That day is full…"), with override left OFF.
//
// Booking is per-day across all clients (not per client), so three bookings for the one
// seeded client on the same day consume the day's three slots; the fourth is refused.

import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const STATE_DIR = join(dirname(fileURLToPath(import.meta.url)), '.state');
const state = JSON.parse(
  readFileSync(join(STATE_DIR, 'e2e-state.json'), 'utf8'),
) as { activeClientName: string };

/** 'YYYY-MM-DD' for now + offset days — a far date no other spec touches. */
function isoDay(offset: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
}

const PER_DAY_CAP = 3;
const fullDate = isoDay(20);

async function bookOnFullDate(page: import('@playwright/test').Page): Promise<void> {
  // Fresh load each time → fresh idempotency key + reset form (the select defaults to
  // empty), so each submit is a distinct booking rather than an idempotent replay.
  await page.goto('/bookings');
  await page.getByLabel('Client').selectOption({ label: state.activeClientName });
  await page.getByLabel('Date').fill(fullDate);
  await page.getByRole('button', { name: 'Book job' }).click();
}

test('booking past the per-day cap is refused with the day-full banner', async ({
  page,
}) => {
  // Fill the day to its cap.
  for (let i = 0; i < PER_DAY_CAP; i++) {
    await bookOnFullDate(page);
    await expect(
      page.getByRole('status').filter({ hasText: 'Booked.' }),
    ).toBeVisible();
  }

  // One more (override OFF) is rejected — the capacity banner, not a "Booked." status.
  // Target the banner COPY directly: `getByRole('alert')` also matches Next.js's empty
  // __next-route-announcer__ live region in dev, so scope to the visible message text.
  await bookOnFullDate(page);
  await expect(page.getByText(/day is full/i)).toBeVisible();
  await expect(
    page.getByRole('status').filter({ hasText: 'Booked.' }),
  ).toHaveCount(0);
});
