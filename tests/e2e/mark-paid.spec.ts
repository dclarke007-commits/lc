// Mark a job paid (authenticated, Story 5.4 UI wiring). global-setup seeds one
// COMPLETED + OWED job; on /jobs its row exposes the "Mark paid" control (the only
// completed+owed job at this point in the serial run, so `.first()` is deterministic).
// Tapping it flips owed→paid through markJobPaid and re-renders the row as "Paid ✓".
//
// This is the happy-path E2E that the prior ledger-export spec could NOT drive: back
// then markJobPaid had no UI, so the seed marked a job paid directly. Now the control
// is reachable and this spec exercises it end-to-end.

import { test, expect } from '@playwright/test';

test('an owed completed job can be marked paid from /jobs', async ({ page }) => {
  await page.goto('/jobs');
  await expect(page.getByRole('heading', { name: 'Jobs' })).toBeVisible();

  // The seeded owed job surfaces the one-tap Mark paid control.
  const markPaid = page.getByRole('button', { name: 'Mark paid' }).first();
  await expect(markPaid).toBeVisible();
  await markPaid.click();

  // Zero-JS flow: markJobPaid → revalidate → redirect ?done=1 → the shared banner.
  await expect(
    page.getByRole('status').filter({ hasText: 'Updated.' }),
  ).toBeVisible();

  // The row now shows the static Paid confirmation (payment flipped owed→paid).
  await expect(page.getByText('Paid ✓').first()).toBeVisible();
});
