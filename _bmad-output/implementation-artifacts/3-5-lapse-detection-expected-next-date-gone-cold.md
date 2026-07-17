---
baseline_commit: 86b5c39afd6f4d50df84e7180969d0fc75c46f0e
---

# Story 3.5: Lapse detection — expected-next-date + gone-cold

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As the operator,
I want regulars flagged the moment they slip,
so that I catch them within a week instead of losing them.

## Acceptance Criteria

1. **Given** a client's last completed job and cadence, **When** the dashboard renders, **Then** `derive` computes the expected next booking date (FR16, AR8/AD-7). [Source: epics.md#story-3-5 AC1]
2. **Given** the current date passes the expected date with no future booking on file, **When** rendered, **Then** the client is flagged gone-cold, with latency scaled per cadence and no extra grace period (FR17). [Source: epics.md#story-3-5 AC2]
3. **Given** gone-cold status, **When** computed, **Then** it is a view-time derivation — no stored flag, no cron (AR8/AD-7). [Source: epics.md#story-3-5 AC3]

## Tasks / Subtasks

- [x] **Task 1 — `derive.expectedNextDate` (AC: 1)** [Source: ARCHITECTURE-SPINE.md#AD-7, #AD-10, #AD-9]
  - [x] In `lib/domain/derive.ts`: `expectedNextDate(client) = last completed Job's date + cadence interval`. "Last completed" reads a `completed` Job only (Story 1.5's `lifecycle` set that basis; `no-show`/`cancelled` are NOT completed and do not advance lapse). Cadence interval per `Client.cadence: weekly|biweekly|monthly|one-time`.
  - [x] Cadence→interval mapping is a dev decision — see Open gaps. A `one-time` client has no cadence interval, so no `expectedNextDate` and no lapse (one-time clients are a rebooking/win-back concern via soonest-open, not a cadence-lapse concern). Compute in operator-local tz (AD-9).
  - [x] Computed on read from canonical rows — never stored, never persisted on a Job or Client.
- [x] **Task 2 — `derive.goneCold` (AC: 2)** [Source: ARCHITECTURE-SPINE.md#AD-7; epics.md FR17]
  - [x] In `lib/domain/derive.ts`: `goneCold(client) = current_date > expectedNextDate(client) AND no future booking on file`. "No future booking on file" = the client has no Job dated on/after today in a still-live state (i.e. `booked`; a future `cancelled` does not count — reuse the same live/consuming notion, do NOT re-define it). A client with a future booking is NOT gone-cold regardless of the expected date.
  - [x] **Latency scales per cadence, NO extra grace period** (FR17): the threshold is the `expectedNextDate` itself (last-completed + cadence interval) — a weekly client goes cold ~a week after their expected slot passes, a monthly client ~a month; there is NO additional fixed grace window added on top. Do not bolt a constant buffer onto any cadence.
  - [x] A `one-time` client (no `expectedNextDate`) is never gone-cold via this path.
- [x] **Task 3 — Surface the gone-cold flag on read (AC: 1, 2, 3)** [Source: ARCHITECTURE-SPINE.md#AD-1, #AD-7, #AD-13]
  - [x] Expose `expectedNextDate` / `goneCold` as pure `derive` reads (surfaces → derive → db). `Client.status: active|provisional|gone-cold` where **gone-cold is derived, never a stored enum write** — the schema convention lists `gone-cold` as a derived status (AD-7), so there is no migration and no column to flip here.
  - [x] This derivation is CONSUMED by Story 3.6 (win-back action operates on gone-cold clients) and the Epic 6 dashboard gone-cold list (FR23). Build the derivation here; do NOT build the win-back action (3.6) or the dashboard list rendering (Epic 6). Keep surfaces dynamic — never `use cache` (AD-13) — so lapse status is live when the operator opens the dashboard.
- [x] **Task 4 — Tests (AC: 1, 2, 3)**
  - [x] `expectedNextDate` = last **completed** job date + cadence interval per cadence; a `no-show`/`cancelled` last job does not set the basis. Weekly vs monthly produce proportionally different expected dates. `goneCold` true when `current_date > expectedNextDate` AND no future booking; false when a future `booked` Job exists even past the expected date; false for `one-time`. No extra grace buffer beyond the cadence interval. Every value recomputes on read — assert no persisted `gone-cold` flag and no cron/scheduled job exists.

## Dev Notes

### Previous story intelligence

This is the READ-side lapse twin of the same `derive` module built in Story 1.7 (room-left/day-maxed/nearest-open) — extend that module, do not fork a new one. It reads the `completed` basis that Story 1.5's `lifecycle` establishes: `expectedNextDate` derives from the last **completed** Job only, exactly as 1.5 Task 3 promised ("basis for expected-next-date… derived in Epic 3 via `derive` from last completed job + cadence — do NOT compute/store it here"). Cadence lives on `Client` (Story 1.2). Reuses 1.1 owner_id + owner-scoped queries (AD-8). Mirrors Story 1.7's derive-on-read pattern exactly: pure computation from canonical rows, dynamic surface, zero stored flags. [Source: 1-2/1-5/1-7 …md]

### Architecture Compliance (invariants — quote-exact)

- **AR8 / AD-7 — Derived state computed on read (verbatim):** "A single `derive` module computes `expectedNextDate`, `goneCold`, `roomLeft` (via `consumesSlot`, AD-2), `dayMaxed`, all dashboard metrics, **and the §2 counter-metrics**… from canonical rows on every render… No stored derived flags, no cron, no background job. `goneCold` is a view-time computation surfaced when the operator opens the dashboard." [Source: ARCHITECTURE-SPINE.md#AD-7]
- **FR16 (verbatim):** "Compute each regular client's expected next booking date from last completed job + cadence." [Source: epics.md:41]
- **FR17 (verbatim):** "Flag a client 'gone cold' when current date passes the expected next booking date (FR16) with no future booking on file. Detection latency scales per cadence; no extra grace period." [Source: epics.md:42]
- **AD-9 — one clock:** cadence arithmetic (last-completed + interval, and the current-date comparison) is computed in the operator's single local timezone; timestamps stored UTC. [Source: ARCHITECTURE-SPINE.md#AD-9]
- **AD-10 — completion basis:** only a `completed` Job is the lapse basis; `no-show`/`cancelled` do not advance lapse (a `cancelled` job "is not counted completed for lapse", FR41). [Source: ARCHITECTURE-SPINE.md#AD-10; epics.md:76]
- **AD-13 — latency budget:** derive-on-read stays indexed + owner-scoped; dashboard surface dynamic (no `use cache`), <2s on 4G. [Source: ARCHITECTURE-SPINE.md#AD-13]
- **Convention — status:** `Client.status: active|provisional|gone-cold` with **gone-cold derived** (AD-7). [Source: ARCHITECTURE-SPINE.md#Consistency-Conventions]

### Scope boundaries (do NOT build here)

Only the two lapse derivations: `expectedNextDate` and `goneCold`. Do NOT build the win-back action or win-back template (Story 3.6). Do NOT build the Epic 6 dashboard gone-cold list rendering (FR23) — this story only exposes the derivation those consume. Do NOT add a stored `gone-cold` column, flag, materialized view, cron, or background job (AR8 forbids all of them). Do NOT re-implement cadence on a Job or re-derive the `completed` basis — read Story 1.5's `completed` state. No rebooking-proposal / soonest-open logic (Story 3.3).

### FR references [Source: epics.md]

- **FR16** — compute each regular client's expected next booking date from last completed job + cadence. (epics.md:41)
- **FR17** — flag gone-cold when current date passes the expected-next date with no future booking; latency scales per cadence, no extra grace period. (epics.md:42)
- **FR23** (downstream) — dashboard lists gone-cold clients with direct access to win-back (Epic 6 consumes this derivation). (epics.md:52)

### Open gaps flagged to developer

1. **Cadence representation + latency-scaling formula** — the interval per `cadence` value is unspecified as concrete days. Recommend a single mapping table: `weekly → 7d`, `biweekly → 14d`, `monthly → 30d` (or calendar-month add), `one-time → none`. `expectedNextDate = lastCompletedDate + interval`; gone-cold fires once `current_date` passes it — the interval IS the latency, so it "scales per cadence" with **no extra grace period** (FR17). Confirm exact intervals (calendar-month vs 30-day) and that no fixed buffer is added.
2. **"No future booking on file" — which states count** — recommend: a Job dated on/after today in a live `booked` state suppresses gone-cold; a future `cancelled` does not. Reuse the existing consuming/live notion from Story 1.4's `consumesSlot` rather than defining a new predicate. Confirm whether a future `no-show` (unusual for a future date) is possible and how to treat it.
3. **Client with no completed jobs / brand-new regular** — a client who has never completed a job has no `expectedNextDate`. Recommend: not gone-cold (nothing to lapse from) — lapse detection applies only to established regulars. Confirm; ensure the derivation does not crash on a null last-completed.
4. **`provisional` clients** — the status enum includes `provisional`; decide whether provisional clients participate in lapse detection or are excluded until they have a completed basis (recommend excluded — same as no-completed-job case).

### References

- [Source: epics.md#Story-3-5] (epics.md:516–534); FR16/FR17 (epics.md:41–42); FR23 (epics.md:52); FR41 lapse note (epics.md:76); AR8 (epics.md:105).
- [Source: ARCHITECTURE-SPINE.md] — AD-7 (derive-on-read), AD-9 (one clock), AD-10 (completed basis), AD-13 (latency); Consistency-Conventions (Cadence/status, derived gone-cold).

## Dev Agent Record

### Agent Model Used

claude-opus-4-8 (1M context) — bmad-dev-story workflow, 2026-07-17.

### Debug Log References

- `npx vitest run tests/lapse.test.ts` → 16/16 pass (RED confirmed first: exports missing → TS2305, then GREEN).
- `npx tsc --noEmit` → clean.
- `npx vitest run` (full regression) → 24 files, 234/234 pass (218 prior + 16 new lapse tests).

### Completion Notes List

Implemented the two READ-side lapse derivations in `lib/domain/derive.ts`, extending the Story 1.7 derive module (no fork):

- **`expectedNextDate(cadence, jobs)`** — last `completed` Job date + cadence interval, operator-local (AD-9). Returns `null` for no basis: `one-time` (no interval), unknown cadence (defensive, mirrors 3.3 P5), or no completed Job. Only `completed` sets the basis (AD-10/FR41) — a later `no-show`/`cancelled` never advances it.
- **`goneCold(cadence, jobs, today)`** — `true` only when `today` strictly PAST `expectedNextDate` AND no future live booking on file. "Future booking on file" reuses `capacity.consumesSlot` (AD-2), so a future `booked` suppresses cold and a future `cancelled` does not; a past-but-live job is not "future". The interval IS the latency → scales per cadence, NO extra grace buffer (FR17).

**Reused single-sources (no re-derivation):** `CADENCE_INTERVAL_DAYS` (weekly 7 / biweekly 14 / monthly 28 — the same table 3.3 rebooking uses, so lapse + rebooking agree on one arithmetic), `consumesSlot` (AD-2 live-state predicate), `addDaysToDate` (AD-9 calendar math), `Cadence` + `DeriveJob` types.

**Derive-on-read proven (AC3/AD-7):** pure functions of the passed rows — no stored `gone-cold` column (the `clientStatus` pgEnum is physically `active|provisional`, so the DB cannot persist it), no cron, no background job. A test mutates the jobs array (book → cancel a future slot) and asserts the very next call flips.

**Open-gap decisions (followed story recommendations):**
1. Cadence interval = existing `CADENCE_INTERVAL_DAYS` (28-day "monthly", not calendar month) — keeps lapse/rebooking on one arithmetic; the interval is the sole latency, no fixed buffer.
2. "No future booking" = `consumesSlot(j) && j.date >= today` (reused predicate, not a new one).
3. No completed jobs → `null` → never cold (no crash on empty/booked-only history).
4. `provisional` clients: excluded naturally — a provisional (Epic 4 pending self-booking) client has no completed basis yet, so the no-basis guard already returns `null`/`false`. Kept the derivations PURE (cadence + jobs only, no status param); any surface wanting a hard status filter does so before calling (surfaces → derive → db layering).

**Scope honored:** built ONLY the two derivations. No win-back action/template (3.6), no Epic 6 dashboard list (FR23), no stored flag/column/materialized view/cron, no migration. Task 3 "surface on read" is satisfied by the pure exports the downstream stories consume.

### File List

- `lib/domain/derive.ts` — added `expectedNextDate` + `goneCold` (Story 3.5 section appended; no existing export changed).
- `tests/lapse.test.ts` — new: 16 pure unit tests for both derivations (AC1/AC2/AC3).

## Change Log

- 2026-07-17 — Story 3.5 implemented: `derive.expectedNextDate` + `derive.goneCold` (lapse detection, FR16/FR17), pure derive-on-read twin of Story 1.7; 16 new tests, full suite 234/234 green, tsc clean. Status → review.

### Review Findings

_Code review of commit 9dee466 (2026-07-17), 3 adversarial layers (blind + edge + auditor). Full triage: 2 decision-needed, 1 patch, 2 defer, 4 dismissed — patch/perf items on the 3-6 story file._

- [x] [Review][Decision] **RESOLVED 2026-07-17 → patched** (booked-only suppressor). `goneCold` future-suppressor now tests `j.completion === 'booked'` instead of `consumesSlot(j)`, so a today/future `no-show`/`completed` no longer suppresses cold (matches Task 2 "booked only"); new no-show edge test in `lapse.test.ts` (17 tests). Original: `goneCold` future-suppressor reuses `consumesSlot`, which includes `no-show` — a today/future `no-show` suppresses cold [`lib/domain/derive.ts` goneCold loop] — `CONSUMING_COMPLETIONS = ['booked','completed','no-show']` (`lib/domain/capacity.ts:34`). Spec Task 2 defines the live/on-the-books state as **`booked` only**, but the code's suppressor is the broader capacity predicate: a future/today `no-show` (the archetypal lapse signal) — and a future-dated `completed` — both mark the client not-cold. Contradiction is spec-internal (Task 2 says "booked"; the same spec's open-gap #2 said "reuse the consuming predicate"). Low reachability (future/today no-show + already-past-expected). Sources: blind (MED), auditor (LOW), edge. Decision: restrict future suppressor to `booked` (+ `completed`) per Task 2, or keep `consumesSlot` reuse and update the doc/Task-2 wording to match.
