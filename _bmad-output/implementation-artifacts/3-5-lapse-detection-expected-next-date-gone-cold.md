# Story 3.5: Lapse detection — expected-next-date + gone-cold

Status: ready-for-dev

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

- [ ] **Task 1 — `derive.expectedNextDate` (AC: 1)** [Source: ARCHITECTURE-SPINE.md#AD-7, #AD-10, #AD-9]
  - [ ] In `lib/domain/derive.ts`: `expectedNextDate(client) = last completed Job's date + cadence interval`. "Last completed" reads a `completed` Job only (Story 1.5's `lifecycle` set that basis; `no-show`/`cancelled` are NOT completed and do not advance lapse). Cadence interval per `Client.cadence: weekly|biweekly|monthly|one-time`.
  - [ ] Cadence→interval mapping is a dev decision — see Open gaps. A `one-time` client has no cadence interval, so no `expectedNextDate` and no lapse (one-time clients are a rebooking/win-back concern via soonest-open, not a cadence-lapse concern). Compute in operator-local tz (AD-9).
  - [ ] Computed on read from canonical rows — never stored, never persisted on a Job or Client.
- [ ] **Task 2 — `derive.goneCold` (AC: 2)** [Source: ARCHITECTURE-SPINE.md#AD-7; epics.md FR17]
  - [ ] In `lib/domain/derive.ts`: `goneCold(client) = current_date > expectedNextDate(client) AND no future booking on file`. "No future booking on file" = the client has no Job dated on/after today in a still-live state (i.e. `booked`; a future `cancelled` does not count — reuse the same live/consuming notion, do NOT re-define it). A client with a future booking is NOT gone-cold regardless of the expected date.
  - [ ] **Latency scales per cadence, NO extra grace period** (FR17): the threshold is the `expectedNextDate` itself (last-completed + cadence interval) — a weekly client goes cold ~a week after their expected slot passes, a monthly client ~a month; there is NO additional fixed grace window added on top. Do not bolt a constant buffer onto any cadence.
  - [ ] A `one-time` client (no `expectedNextDate`) is never gone-cold via this path.
- [ ] **Task 3 — Surface the gone-cold flag on read (AC: 1, 2, 3)** [Source: ARCHITECTURE-SPINE.md#AD-1, #AD-7, #AD-13]
  - [ ] Expose `expectedNextDate` / `goneCold` as pure `derive` reads (surfaces → derive → db). `Client.status: active|provisional|gone-cold` where **gone-cold is derived, never a stored enum write** — the schema convention lists `gone-cold` as a derived status (AD-7), so there is no migration and no column to flip here.
  - [ ] This derivation is CONSUMED by Story 3.6 (win-back action operates on gone-cold clients) and the Epic 6 dashboard gone-cold list (FR23). Build the derivation here; do NOT build the win-back action (3.6) or the dashboard list rendering (Epic 6). Keep surfaces dynamic — never `use cache` (AD-13) — so lapse status is live when the operator opens the dashboard.
- [ ] **Task 4 — Tests (AC: 1, 2, 3)**
  - [ ] `expectedNextDate` = last **completed** job date + cadence interval per cadence; a `no-show`/`cancelled` last job does not set the basis. Weekly vs monthly produce proportionally different expected dates. `goneCold` true when `current_date > expectedNextDate` AND no future booking; false when a future `booked` Job exists even past the expected date; false for `one-time`. No extra grace buffer beyond the cadence interval. Every value recomputes on read — assert no persisted `gone-cold` flag and no cron/scheduled job exists.

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

### Debug Log References

### Completion Notes List

### File List
