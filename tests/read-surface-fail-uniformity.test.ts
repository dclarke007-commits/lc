// Epic 3 retro action item — the fail-pattern-uniformity CHECK for RSC read surfaces (AD-8).
//
// Every operator read surface resolves its owner_id from the verified session via
// requireOwnerId (lib/auth/requireOwnerId). The invariant this locks: when that resolution
// FAILS (no/expired session), EVERY read path fails CLOSED — it never degrades to data
// (an empty list, DEFAULT_CAPACITY, default templates) that would render an authenticated-
// looking page for a caller with no session. Two sanctioned shapes, both fail-closed:
//   • bare-value readers (return T) let the rejection PROPAGATE (directly or re-thrown as
//     Error('owner-unresolved')) → the RSC error boundary shows, never a silent [].
//   • ActionResult readers (return { ok } | { ok:false }) catch and return fail(...) — NO data.
// This test drives requireOwnerId to reject and asserts each read wrapper conforms. A future
// reader that catches the rejection and returns [] / a default (fail-OPEN) breaks this test.

import { describe, it, expect, vi } from 'vitest';

// Reject owner resolution for every read wrapper below (overrides the global setup.ts mock,
// which delegates to getOwnerId — here we simulate the no-session, fail-closed path instead).
vi.mock('@/lib/auth/requireOwnerId', () => ({
  requireOwnerId: vi.fn(() =>
    Promise.reject(new Error('requireOwnerId: no valid operator session (fail-closed)')),
  ),
}));
// Surface/action modules import these at module top; neutralize them (no request scope here).
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));

import { getOwnerTemplates } from '../app/(operator)/templates/actions';
import { listOwnerInquiries } from '../app/(operator)/inquiries/actions';
import { listDraftClients } from '../app/(operator)/draft/actions';
import { getOwnerCapacity } from '../app/(operator)/settings/actions';
import { listOwnerPendingRequests } from '../app/(operator)/requests/actions';
import { getOwnerJobs } from '../app/(operator)/jobs/actions';
import {
  getDashboardCapacity,
  getDashboardMetrics,
  getLeakIndicators,
  getGoneColdList,
} from '../app/(operator)/actions';
import {
  listOwnerClients,
  listOwnerClientsWithLapse,
} from '../app/(operator)/clients/actions';
import { getBookableClients } from '../app/(operator)/bookings/actions';
import { getPublicBookingLink } from '../app/(operator)/link/actions';

// The zero-arg bare-value RSC read surfaces. On an unresolved owner each MUST reject
// (propagate/rethrow) — never resolve to data.
const BARE_VALUE_READERS: { name: string; fn: () => Promise<unknown> }[] = [
  { name: 'getOwnerTemplates', fn: getOwnerTemplates },
  { name: 'listOwnerInquiries', fn: listOwnerInquiries },
  { name: 'listDraftClients', fn: listDraftClients },
  { name: 'getOwnerCapacity', fn: getOwnerCapacity },
  { name: 'listOwnerPendingRequests', fn: listOwnerPendingRequests },
  { name: 'getOwnerJobs', fn: getOwnerJobs },
  { name: 'getDashboardCapacity', fn: getDashboardCapacity },
  { name: 'getDashboardMetrics', fn: getDashboardMetrics },
  { name: 'getLeakIndicators', fn: getLeakIndicators },
  { name: 'getGoneColdList', fn: getGoneColdList },
  { name: 'listOwnerClients', fn: listOwnerClients },
  { name: 'listOwnerClientsWithLapse', fn: listOwnerClientsWithLapse },
  { name: 'getBookableClients', fn: getBookableClients },
];

describe('RSC read-surface fail-pattern uniformity (Epic 3 retro, AD-8)', () => {
  for (const { name, fn } of BARE_VALUE_READERS) {
    it(`${name} fails CLOSED (rejects) on an unresolved owner — never returns data`, async () => {
      await expect(fn()).rejects.toThrow();
    });
  }

  it('getPublicBookingLink (ActionResult reader) fails CLOSED with a typed failure carrying no data', async () => {
    const res = await getPublicBookingLink();
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('owner-unresolved');
  });
});
