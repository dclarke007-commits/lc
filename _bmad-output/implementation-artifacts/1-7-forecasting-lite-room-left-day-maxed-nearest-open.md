# Story 1.7: Forecasting-lite — room-left, day-maxed, nearest-open

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As the operator,
I want to see capacity at a glance,
so that I can decide accept or pass mid-call.

## Acceptance Criteria

1. **Given** the current week, **When** the dashboard renders, **Then** `derive` computes room-left = 14 − consuming jobs this week (FR26, AR8/AD-7). [Source: epics.md#story-1-7 AC1]
2. **Given** a working day at its per-day cap, **When** rendered, **Then** it is marked day-maxed (FR27). [Source: epics.md#story-1-7 AC2]
3. **Given** a requested day is day-maxed, **When** I look, **Then** the nearest days with room are surfaced (FR28), **And** all values are derived on read — no stored flags, no cron (AR8/AD-7). [Source: epics.md#story-1-7 AC3]

## Tasks / Subtasks

- [ ] **Task 1 — `derive.roomLeft` (AC: 1)** [Source: ARCHITECTURE-SPINE.md#AD-7, #AD-2, #AD-9]
  - [ ] In `lib/domain/derive.ts`: `roomLeft = weeklyCeiling(14) − count(jobs this week where consumesSlot(job))`. Reuse `capacity.consumesSlot` (Story 1.4) — do NOT re-implement which states consume. Week = Mon–Sun operator-local (AD-9), config from Story 1.3.
- [ ] **Task 2 — `derive.dayMaxed` (AC: 2)** [Source: ARCHITECTURE-SPINE.md#AD-7]
  - [ ] `dayMaxed(day)` → true when consuming jobs on that working day ≥ its per-day cap (config from Story 1.3). Computed on read.
- [ ] **Task 3 — nearest-open computation (AC: 3)** [Source: ARCHITECTURE-SPINE.md#AD-7; epics.md FR28]
  - [ ] Given a day-maxed target, surface the nearest working days that still have room (not day-maxed, within weekly ceiling). Direction/horizon/count unspecified — see Open gaps; pick sensible defaults (future-facing, small window).
- [ ] **Task 4 — Dashboard surface (AC: 1, 2, 3)** [Source: ARCHITECTURE-SPINE.md#AD-1, #AD-13, NFR1]
  - [ ] RSC dashboard under `app/(operator)/` (auth-gated): show room-left this week, per-day day-maxed markers, nearest-open when a day is maxed. Phone-first, minimal client JS, **dynamic — never `use cache`** (AD-13), so mid-call values are live.
  - [ ] Surface reads only via `derive` (surfaces → derive → db); no stored flags.
- [ ] **Task 5 — Tests (AC: 1, 2, 3)**
  - [ ] room-left = 14 − consuming-this-week (incl. no-show consumes, cancelled doesn't — via `consumesSlot`). day-maxed at per-day cap. nearest-open skips maxed days. All values recompute on read (no persisted flag).

## Dev Notes

### Previous story intelligence

The `derive` module here is the READ-side twin of Story 1.4's `commitBooking` — both call the SAME `capacity.consumesSlot` predicate so capacity and dashboard never disagree (AD-2). Consumes Story 1.3 config (weekly ceiling, per-day cap, working days, operator tz) and Story 1.6 (cancel/reschedule already leave correct rows, so derive reflects freed capacity automatically). Reuses 1.1 owner_id. This closes Epic 1: the operator can now see capacity mid-call. [Source: 1-3/1-4/1-6 …md]

### Architecture Compliance (invariants — quote-exact)

- **AD-7 — Derived state computed on read (verbatim):** "A single `derive` module computes `expectedNextDate`, `goneCold`, `roomLeft` (via `consumesSlot`, AD-2), `dayMaxed`, all dashboard metrics, and the §2 counter-metrics… from canonical rows on every render… No stored derived flags, no cron, no background job." [Source: ARCHITECTURE-SPINE.md#AD-7]
- **AD-2 — one predicate:** `roomLeft` calls `capacity.consumesSlot` — the same one `commitBooking` uses. Never re-define consuming states. [Source: ARCHITECTURE-SPINE.md#AD-2]
- **AD-9 — one clock:** week = Mon–Sun operator-local. [Source: ARCHITECTURE-SPINE.md#AD-9]
- **AD-13 — latency budget:** dashboard <2s on 4G, dynamic (no `use cache`), minimal client JS. [Source: ARCHITECTURE-SPINE.md#AD-13]
- **NFR1 phone-first; NFR7 simplicity.**

### Scope boundaries (do NOT build here)

Only the three foundation derivations (room-left, day-maxed, nearest-open). Do NOT build `expectedNextDate`/`goneCold`/repeat-rate/counter-metrics (Epic 3 + Epic 6) even though they live in the same `derive` module — add them in their own stories. No booking mutation (1.4). No leak-indicator dashboard (Epic 6).

### FR references [Source: epics.md]

- **FR26** — compute/display room-left-this-week (14 − jobs booked this week). (epics.md:57)
- **FR27** — mark a working day day-maxed at its per-day cap. (epics.md:58)
- **FR28** — when requested day is day-maxed, surface nearest days with room. (epics.md:59)

### Open gaps flagged to developer

1. **Nearest-open algorithm** — FR28 gives no direction (future-only vs either side), search horizon, or how many days to surface. Recommend: future-facing, scan forward to end of a bounded window (e.g. next 14 working days), surface first N with room. Confirm.
2. **Overridden jobs & negative room-left** — if operator override (Story 1.4) pushed the week past 14, `roomLeft` could be negative. Decide render (clamp at 0 vs show negative). Dashboard must not crash.
3. **Non-working / non-configured days** — nearest-open must skip non-working days per capacity config (Story 1.3).

### References

- [Source: epics.md#Story-1-7] (epics.md:332–351); FR26/FR27/FR28 (epics.md:57–59); AR8 (epics.md:105).
- [Source: ARCHITECTURE-SPINE.md] — AD-2, AD-7, AD-9, AD-13.

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
