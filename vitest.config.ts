import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // DB-backed tests (seed idempotency, signIn) load .env via setup below.
    setupFiles: ['./tests/setup.ts'],
    hookTimeout: 30_000,
    testTimeout: 30_000,
    // Seed-idempotency and signIn tests share the one Docker Postgres and write the
    // operator table. Run test files serially in a single worker so their writes
    // never interleave (otherwise one file's insert races another's truncate).
    fileParallelism: false,
    poolOptions: { forks: { singleFork: true } },
  },
});
