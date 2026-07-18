// Playwright browser E2E for LovesCleaning. Real Chromium against a real `pnpm dev`
// (Turbopack) server + the Docker Postgres. globalSetup clean-slates + seeds the DB
// (owner-scoped, mirroring tests/public-request.test.ts), then the `setup` project
// signs in ONCE through the real /sign-in UI and saves storageState. Operator specs
// reuse that session; the public booking spec runs unauthenticated (fresh context).
//
// Serial (workers:1, no fullyParallel): every spec shares the ONE dev server + ONE DB,
// so they must not interleave. Happy-path only — assert visible outcomes.

import 'dotenv/config';
import { defineConfig, devices } from '@playwright/test';

const STATE_DIR = './tests/e2e/.state';

export default defineConfig({
  testDir: './tests/e2e',
  globalSetup: './tests/e2e/global-setup.ts',
  // One worker: specs share a single server + DB and run in a defined order.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  reporter: [['list']],
  timeout: 60_000,
  expect: { timeout: 15_000 },

  use: {
    baseURL: 'http://localhost:3000',
    headless: true,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    // Signs in through the real UI and persists the operator session.
    {
      name: 'setup',
      testMatch: /auth\.setup\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
    // Authenticated operator surfaces — reuse the saved session.
    {
      name: 'operator',
      testMatch: /(operator-dashboard|rebooking|ledger-export)\.spec\.ts/,
      dependencies: ['setup'],
      use: {
        ...devices['Desktop Chrome'],
        storageState: `${STATE_DIR}/operator.json`,
      },
    },
    // Public booking — the one un-authenticated surface. Fresh context, no session.
    {
      name: 'public',
      testMatch: /public-booking\.spec\.ts/,
      dependencies: ['setup'],
      use: { ...devices['Desktop Chrome'], storageState: undefined },
    },
  ],

  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:3000',
    reuseExistingServer: true,
    // First route compile under Turbopack is slow.
    timeout: 120_000,
  },
});
