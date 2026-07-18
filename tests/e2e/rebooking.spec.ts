// Rebooking (authenticated). From /jobs, a completed job's one-tap rebook control mints
// the per-client booking link (the write) and surfaces the rebooking proposal panel with
// the proposed next slot + composed draft. Asserts the visible dispatch-ready state.
//
// Boundary: the panel's "Open in WhatsApp/SMS" buttons POST to sendRebook, which then
// redirects to an EXTERNAL wa.me/sms: deep link (no network in this sandbox). So this
// spec drives up to the generated-draft state — the reachable, assertable UI outcome —
// and does not follow the external deep link.

import { test, expect } from '@playwright/test';

test('a completed job generates a rebooking proposal with a proposed slot', async ({
  page,
}) => {
  await page.goto('/jobs');
  await expect(page.getByRole('heading', { name: 'Jobs' })).toBeVisible();

  // The seeded completed job exposes the highlighted "Send rebooking nudge" (a fresh
  // completed job with no nudge yet) or the plain "Rebook" control — both fire the same
  // prepareRebook flow. Click the first rebook-type control.
  const rebook = page
    .getByRole('button', { name: /Send rebooking nudge|^Rebook$/ })
    .first();
  await expect(rebook).toBeVisible();
  await rebook.click();

  // prepareRebook → redirect to ?rebook=<id> → the rebooking proposal panel renders.
  const panel = page.getByRole('region', { name: 'Rebooking proposal' });
  await expect(panel).toBeVisible();
  await expect(panel.getByText(/Proposed next slot:/)).toBeVisible();
  // Dispatch-ready: the send affordance for the composed draft is present.
  await expect(
    panel.getByRole('button', { name: 'Open in WhatsApp' }),
  ).toBeVisible();
});
