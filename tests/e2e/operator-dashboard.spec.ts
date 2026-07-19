// Operator dashboard + booking lifecycle (authenticated). Loads the dashboard and
// asserts the capacity/forecast section is visible, then creates a booking through the
// real /bookings UI and marks its outcome on /jobs, asserting the visible result banner.

import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const STATE_DIR = join(dirname(fileURLToPath(import.meta.url)), '.state');
const state = JSON.parse(
  readFileSync(join(STATE_DIR, 'e2e-state.json'), 'utf8'),
) as { activeClientName: string; bookingDate: string };

test('dashboard shows capacity, then a booking can be created and completed', async ({
  page,
}) => {
  // Dashboard capacity/forecast is visible ('/' is now the public homepage).
  await page.goto('/dashboard');
  await expect(
    page.getByRole('heading', { name: 'Operator dashboard' }),
  ).toBeVisible();
  await expect(page.getByText('Room left this week:')).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Status' })).toBeVisible();

  // Create a booking through the UI.
  await page.goto('/bookings');
  await expect(page.getByRole('heading', { name: 'Book a job' })).toBeVisible();
  await page.getByLabel('Client').selectOption({ label: state.activeClientName });
  await page.getByLabel('Date').fill(state.bookingDate);
  await page.getByRole('button', { name: 'Book job' }).click();

  // Committed booking → the "Booked." status.
  await expect(page.getByRole('status').filter({ hasText: 'Booked.' })).toBeVisible();

  // Mark its outcome on /jobs — the newly booked row exposes "Mark completed".
  await page.goto('/jobs');
  await expect(page.getByRole('heading', { name: 'Jobs' })).toBeVisible();
  await page.getByRole('button', { name: 'Mark completed' }).first().click();

  // Visible result of the lifecycle transition.
  await expect(page.getByRole('status').filter({ hasText: 'Updated.' })).toBeVisible();
});
