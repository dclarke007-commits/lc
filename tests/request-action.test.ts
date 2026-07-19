// Task 7 — redirect-mask behavior for the ONLY public endpoint on the tokenless request
// path. Verifies the Server Action collapses every core outcome (success, validation
// failure) into a generic ?sent / ?error redirect target, mirroring the token path's
// mask discipline (app/book/[token]/actions.ts). next/navigation's redirect and IP
// extraction are mocked so the throw mechanics are testable without a real request
// context. Exercised against the Docker Postgres (serial, singleFork — vitest.config.ts).
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { db } from '../lib/db/client';
import { client, pendingRequest, inquiry, messageLog, job, token } from '../lib/db/schema';
import { seedOperator } from '../lib/db/seed';

// Capture redirect target (next/navigation redirect throws NEXT_REDIRECT).
const redirectMock = vi.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});
vi.mock('next/navigation', () => ({ redirect: (u: string) => redirectMock(u) }));
vi.mock('@/lib/security/requestIp', () => ({ getRequestIp: async () => '1.2.3.4' }));

import { submitPublicRequest } from '../app/request/actions';

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

// Operator is a DB-enforced singleton (AD-8) — seed once, never raw-insert/delete it here.
beforeAll(async () => {
  await seedOperator();
});

// Clean slate each test: clear only the child tables this path touches, FK-safe order —
// mirrors tests/request.test.ts. Never db.delete(operator) here.
beforeEach(async () => {
  redirectMock.mockClear();
  await db.delete(inquiry);
  await db.delete(pendingRequest);
  await db.delete(messageLog);
  await db.delete(job);
  await db.delete(token);
  await db.delete(client);
});

describe('submitPublicRequest (redirect mask)', () => {
  it('redirects to ?sent=1 on success', async () => {
    await expect(
      submitPublicRequest(fd({ name: 'Sam', phone: '555', date: '2026-08-04', visit: 'v1' })),
    ).rejects.toThrow('REDIRECT:/request?sent=1');
  });

  it('masks a validation failure as ?error=invalid (never the raw reason)', async () => {
    await expect(
      submitPublicRequest(fd({ name: '', phone: '', date: '' })),
    ).rejects.toThrow('REDIRECT:/request?error=invalid');
  });
});
