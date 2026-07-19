// Retrospective action item (Epic 6): assert the three day-sensitive lapse panels —
// the 6.1 `lapsed` COUNT, the 6.2 `caughtColdThisWeek` COUNT, and the 6.3 gone-cold LIST —
// AGREE at the DERIVE layer for one `today`. In app/(operator)/actions.ts a single
// `renderNow = cache(() => new Date())` feeds one `today` to every panel.
//
// SCOPE (honest limits): this pins the DERIVE invariant — given ONE `today`, the three
// derivations are mutually consistent, and a DIFFERENT `today` (the pre-fix drift across
// operator-local midnight) changes the answer, so one shared `today` is load-bearing. It
// does NOT exercise the actions.ts wiring itself: re-introducing an independent `new Date()`
// per panel there would leave this test green. That single-shared-today wiring is currently
// guaranteed by construction (one `renderNow` cache) and by E2E — binding it in a unit test
// would need a fragile simulation of React's request-scoped cache(), judged not worth it.

import { describe, it, expect } from 'vitest';
import {
  repeatVsLapsedCounts,
  caughtColdThisWeek,
  goneColdList,
  type ClientLifecycle,
  type LapseClient,
} from '../lib/domain/derive';

/** A client carrying everything all three derives need; we project the two shapes below. */
interface TestClient {
  id: string;
  name: string;
  cadence: ClientLifecycle['cadence'];
  jobs: { date: string; completion: string }[];
}

const asLifecycles = (cs: TestClient[]): ClientLifecycle[] =>
  cs.map((c) => ({ cadence: c.cadence, jobs: c.jobs }));
const asLapseClients = (cs: TestClient[]): LapseClient[] =>
  cs.map((c) => ({ id: c.id, name: c.name, cadence: c.cadence, jobs: c.jobs }));

const completed = (date: string) => ({ date, completion: 'completed' });
const booked = (date: string) => ({ date, completion: 'booked' });

describe('dashboard lapse-panel consistency (renderNow single-today invariant)', () => {
  const today = '2026-07-01';

  // Cold, but the miss is OLD (expected 2026-06-08, > 7 days before today) — lapsed, NOT
  // caught-this-week.
  const oldCold: TestClient = {
    id: 'old-cold',
    name: 'Old Cold',
    cadence: 'weekly',
    jobs: [completed('2026-06-01')], // expected 2026-06-08
  };
  // Cold AND fresh (expected 2026-06-27, within 7 days of today) — lapsed AND caught.
  const freshCold: TestClient = {
    id: 'fresh-cold',
    name: 'Fresh Cold',
    cadence: 'weekly',
    jobs: [completed('2026-06-20')], // expected 2026-06-27
  };
  // Due exactly today (expected === today) — NOT yet cold.
  const dueToday: TestClient = {
    id: 'due-today',
    name: 'Due Today',
    cadence: 'biweekly',
    jobs: [completed('2026-06-17')], // expected 2026-07-01 === today
  };
  // Would be cold, but has a FUTURE booked job — suppressed, not cold.
  const hasFuture: TestClient = {
    id: 'has-future',
    name: 'Has Future',
    cadence: 'weekly',
    jobs: [completed('2026-06-01'), booked('2026-07-10')],
  };
  // One-time — no interval, never lapses.
  const oneTime: TestClient = {
    id: 'one-time',
    name: 'One Time',
    cadence: 'one-time',
    jobs: [completed('2026-01-01')],
  };

  const clients = [oldCold, freshCold, dueToday, hasFuture, oneTime];

  it('lapsed COUNT equals the gone-cold LIST length for one today', () => {
    const { lapsed } = repeatVsLapsedCounts(asLifecycles(clients), today);
    const list = goneColdList(asLapseClients(clients), today);
    // Both are "clients gone-cold right now" — they MUST match exactly.
    expect(lapsed).toBe(2);
    expect(list.map((r) => r.id).sort()).toEqual(['fresh-cold', 'old-cold']);
    expect(list.length).toBe(lapsed);
  });

  it('caughtColdThisWeek is a subset of the lapsed set (count ≤ lapsed, fresh ∈ list)', () => {
    const { lapsed } = repeatVsLapsedCounts(asLifecycles(clients), today);
    const caught = caughtColdThisWeek(asLifecycles(clients), today);
    const list = goneColdList(asLapseClients(clients), today);
    expect(caught).toBe(1); // only freshCold
    expect(caught).toBeLessThanOrEqual(lapsed);
    // The fresh-cold client the caught count represents must also be in the act-now list.
    expect(list.some((r) => r.id === 'fresh-cold')).toBe(true);
  });

  it('a different today changes the answer — proving one shared today is load-bearing', () => {
    // dueToday has expectedNextDate === 2026-07-01. This is the exact midnight boundary
    // the renderNow cache() protects: at D the client is merely due; at D+1 they are cold.
    const onlyDue = [dueToday];

    const atD = {
      lapsed: repeatVsLapsedCounts(asLifecycles(onlyDue), '2026-07-01').lapsed,
      list: goneColdList(asLapseClients(onlyDue), '2026-07-01').length,
    };
    const atDPlus1 = {
      lapsed: repeatVsLapsedCounts(asLifecycles(onlyDue), '2026-07-02').lapsed,
      list: goneColdList(asLapseClients(onlyDue), '2026-07-02').length,
    };

    // Within each single `today` the panels agree (the invariant the fix preserves)…
    expect(atD.lapsed).toBe(atD.list);
    expect(atDPlus1.lapsed).toBe(atDPlus1.list);
    // …but the two todays DISAGREE (0 vs 1). If two panels computed `today` independently
    // across midnight, the lapsed count and the list would desync by this one client —
    // exactly the drift the shared renderNow instant prevents.
    expect(atD.lapsed).toBe(0);
    expect(atDPlus1.lapsed).toBe(1);
    expect(atD.lapsed).not.toBe(atDPlus1.lapsed);
  });
});
