// Ledger CSV export (authenticated). Triggers the owner-scoped jobs CSV export from the
// dashboard "Own your data" section and asserts the browser download event fires.
//
// Boundary: the spec's brief calls for marking a job PAID via the UI first — but
// `markJobPaid` (app/(operator)/ledger/actions.ts) is defined and has NO UI control
// wired to it anywhere in app/** (verified). There is no drivable mark-paid affordance,
// so global-setup seeds a COMPLETED + PAID job directly, and this spec drives only the
// reachable step: the CSV export. The export serializes that paid job row.

import { test, expect } from '@playwright/test';

test('exporting jobs CSV from the dashboard fires a download', async ({ page }) => {
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: 'Own your data' })).toBeVisible();

  const exportButton = page.getByRole('button', { name: 'Export jobs (CSV)' });
  await expect(exportButton).toBeVisible();

  // ExportButtons turns the Server Action's CSV text into a Blob + transient <a download>
  // click — Playwright surfaces that as a download event.
  const downloadPromise = page.waitForEvent('download');
  await exportButton.click();
  const download = await downloadPromise;

  expect(download.suggestedFilename()).toMatch(/\.csv$/i);
});
