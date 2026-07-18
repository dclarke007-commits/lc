// Error-path E2E: an invalid booking token (public, unauthenticated). The public
// surface fails CLOSED (app/book/[token]/page.tsx): every failure mode — bad signature,
// unknown/revoked token, missing client — collapses to ONE generic "Link not valid"
// message that leaks nothing about whether a client or token exists. A garbage token
// resolves neither the public capability nor a per-client link, so the page renders the
// generic dead-end with NO slots and NO request form.
//
// Runs in the `public` project: no operator session (storageState undefined). proxy.ts
// leaves app/book/** open, so the route is reachable without auth.

import { test, expect } from '@playwright/test';

test('an invalid booking token shows the fail-closed dead-end, no form', async ({
  page,
}) => {
  await page.goto('/book/not-a-real-token-000000000000');

  // The single generic message — never a reason code, never a 404 stack.
  await expect(
    page.getByRole('heading', { name: 'Link not valid' }),
  ).toBeVisible();
  await expect(page.getByText(/isn.t valid\. Please ask for a new link\./)).toBeVisible();

  // Nothing bookable is exposed: the dead-end renders NO "Book a cleaning" heading that
  // the valid surfaces show, and no slot/submit control. (We don't assert zero buttons
  // globally — `pnpm dev` injects a "Open Next.js Dev Tools" button that prod omits.)
  await expect(
    page.getByRole('heading', { name: 'Book a cleaning' }),
  ).toHaveCount(0);
  await expect(page.getByRole('button', { name: /book|pick|confirm/i })).toHaveCount(0);
});
