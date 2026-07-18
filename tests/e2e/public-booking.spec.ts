// Public self-serve booking (NO auth). A stranger opens /book/<token>, sees the
// operator's genuinely-open days, fills the new-client request form, picks an offered
// day, and submits → a provisional client + PendingRequest (holds NO capacity, AR5).
// Asserts the visible confirmation banner. Runs in a fresh, unauthenticated context.

import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const STATE_DIR = join(dirname(fileURLToPath(import.meta.url)), '.state');
const state = JSON.parse(
  readFileSync(join(STATE_DIR, 'e2e-state.json'), 'utf8'),
) as { publicToken: string };

test('stranger submits a new-client booking request and sees confirmation', async ({
  page,
}) => {
  await page.goto(`/book/${state.publicToken}`);

  // The public surface renders the request form with offered open days.
  await expect(page.getByRole('heading', { name: 'Book a cleaning' })).toBeVisible();
  await expect(page.getByLabel('Your name')).toBeVisible();

  await page.getByLabel('Your name').fill('Walk-in Wanda');
  await page.getByLabel('Phone').fill('555-0199');
  await page.getByLabel(/Service address/).fill('7 Stranger Lane');

  // Pick the first genuinely-offered open day (option index 0 is the disabled prompt).
  const dateSelect = page.getByLabel('Preferred day');
  const firstOpen = await dateSelect
    .locator('option:not([disabled])')
    .first()
    .getAttribute('value');
  expect(firstOpen, 'expected at least one offered open day').toBeTruthy();
  await dateSelect.selectOption(firstOpen!);

  await page.getByRole('button', { name: 'Request this day' }).click();

  // Request recorded — a provisional request, NOT a confirmed booking (AR5).
  await expect(page.getByText(/your request is in/i)).toBeVisible();
});
