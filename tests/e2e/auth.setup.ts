// Auth setup project — sign in ONCE through the REAL /sign-in UI (operator-only, AD-6)
// and persist the session cookie to storageState. The `operator` project reuses this;
// the `public` booking spec runs without it. Credentials come from env, never hardcoded.

import { test as setup, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const STATE_DIR = join(dirname(fileURLToPath(import.meta.url)), '.state');
const operatorStateFile = join(STATE_DIR, 'operator.json');

setup('authenticate operator via the sign-in form', async ({ page }) => {
  const email = process.env.OPERATOR_EMAIL;
  const passphrase = process.env.OPERATOR_PASSPHRASE;
  expect(email, 'OPERATOR_EMAIL must be set').toBeTruthy();
  expect(passphrase, 'OPERATOR_PASSPHRASE must be set').toBeTruthy();

  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(email!);
  await page.getByLabel('Passphrase').fill(passphrase!);
  await page.getByRole('button', { name: 'Sign in' }).click();

  // On success the action sets the cookie server-side and the client routes to '/'.
  await expect(page).toHaveURL('http://localhost:3000/');
  await expect(
    page.getByRole('heading', { name: 'Operator dashboard' }),
  ).toBeVisible();

  await page.context().storageState({ path: operatorStateFile });
});
