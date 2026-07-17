---
baseline_commit: 9795a9f4b5e53afc5f663ca0d5bf1532dc4728d8
---

# Story 1.7: Forecasting-lite — room-left, day-maxed, nearest-open

Status: done

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

- [x] **Task 1 — `derive.roomLeft` (AC: 1)** [Source: ARCHITECTURE-SPINE.md#AD-7, #AD-2, #AD-9]
  - [x] In `lib/domain/derive.ts`: `roomLeft = weeklyCeiling(14) − count(jobs this week where consumesSlot(job))`. Reuse `capacity.consumesSlot` (Story 1.4) — do NOT re-implement which states consume. Week = Mon–Sun operator-local (AD-9), config from Story 1.3.
- [x] **Task 2 — `derive.dayMaxed` (AC: 2)** [Source: ARCHITECTURE-SPINE.md#AD-7]
  - [x] `dayMaxed(day)` → true when consuming jobs on that working day ≥ its per-day cap (config from Story 1.3). Computed on read.
- [x] **Task 3 — nearest-open computation (AC: 3)** [Source: ARCHITECTURE-SPINE.md#AD-7; epics.md FR28]
  - [x] Given a day-maxed target, surface the nearest working days that still have room (not day-maxed, within weekly ceiling). Direction/horizon/count unspecified — see Open gaps; pick sensible defaults (future-facing, small window).
- [x] **Task 4 — Dashboard surface (AC: 1, 2, 3)** [Source: ARCHITECTURE-SPINE.md#AD-1, #AD-13, NFR1]
  - [x] RSC dashboard under `app/(operator)/` (auth-gated): show room-left this week, per-day day-maxed markers, nearest-open when a day is maxed. Phone-first, minimal client JS, **dynamic — never `use cache`** (AD-13), so mid-call values are live.
  - [x] Surface reads only via `derive` (surfaces → derive → db); no stored flags.
- [x] **Task 5 — Tests (AC: 1, 2, 3)**
  - [x] room-left = 14 − consuming-this-week (incl. no-show consumes, cancelled doesn't — via `consumesSlot`). day-maxed at per-day cap. nearest-open skips maxed days. All values recompute on read (no persisted flag).

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

claude-opus-4-8 (1M) — dev-story workflow, 2026-07-16.

### Debug Log References

- `npx tsc --noEmit` — clean (exit 0).
- `npx vitest run` — 107/107 passing (was 90; +15 `derive`, +2 `dashboard`; no regressions).
- `npm run build` — compiled OK; `/` route is `ƒ (Dynamic)` server-rendered on demand (AD-13, never static/`use cache`).

### Completion Notes List

- **Two invariants, two single-sources.** `derive` reuses `capacity.consumesSlot` for the AD-2 consuming-status rule (never re-defined) and `clock.weekRangeOfDate` for the AD-9 Mon–Sun week. The calendar-date week helpers (`isoWeekdayOfDate` / `addDaysToDate` / `weekRangeOfDate`) were added to `clock.ts` (the one-clock home) rather than re-implemented in `derive`. NOTE: `capacity.ts` still keeps its own private copies of that arithmetic (pre-existing, tested); unifying it onto `clock.ts` is a low-risk follow-up left out of scope to avoid touching the booking keystone.
- **Pure derive, provable AD-7.** All functions are pure over `(jobs, config, anchorDate)` — no `Date`, no db — so "recomputed on read, no stored flag" is proven by mutating the in-memory row set between calls (unit test) and by flipping a real row to `cancelled` and re-reading (DB test: room 10→11).
- **Open-gap decisions (operator-confirmed 2026-07-16):**
  - *Nearest-open (FR28):* future-facing, surface the **single** next working day with room (below per-day cap AND under weekly ceiling), skipping non-working days. Bounded forward scan (`NEAREST_OPEN_MAX_WORKING_DAYS=28`) so a saturated horizon returns `[]` rather than looping.
  - *Over-capacity (Open gap #2):* `roomLeft` clamps at 0; a separate `over = max(0, consuming − ceiling)` drives a "N over" badge so an FR39 override is visible without a confusing negative. Dashboard never crashes.
  - *Non-working days (Open gap #3):* excluded from the week view and skipped by nearest-open (per Story 1.3 `workingDays`).
- **Layering.** Surface (`page.tsx`) calls the action (`getDashboardCapacity`) only — never `derive`/db. Date labels use `Intl` in the surface (presentation), keeping AD-9 clock math in the domain. Owner resolves fail-loud on the read path (parity with `getOwnerJobs`).
- Scope held to the three foundation derivations; `expectedNextDate`/`goneCold`/counter-metrics deliberately NOT built (their own stories). Closes Epic 1.

### File List

- `lib/domain/derive.ts` — implemented `roomLeft`, `dayMaxed`, `nearestOpen`, `weekCapacity` (was a stub).
- `lib/domain/clock.ts` — added calendar-date helpers `isoWeekdayOfDate`, `addDaysToDate`, `weekRangeOfDate`.
- `lib/db/queries.ts` — added `listJobsFrom(ownerId, fromDateKey)` + `JobDateStatus` (and `gte` import).
- `app/(operator)/actions.ts` — new dashboard read action `getDashboardCapacity()` + `DashboardCapacity`/`DashboardDay`.
- `app/(operator)/page.tsx` — dashboard now renders the at-a-glance capacity view (room-left, per-day maxed, nearest-open).
- `tests/derive.test.ts` — new, 15 pure unit tests (AC1/2/3 + derive-on-read).
- `tests/dashboard.test.ts` — new, 2 DB integration tests (end-to-end read + cancel frees slot).
- `_bmad-output/implementation-artifacts/1-7-*.md` — this story file (tracking).
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — status tracking.

## Change Log

| Date       | Change                                                                 |
|------------|------------------------------------------------------------------------|
| 2026-07-16 | Story 1.7 implemented: derive-on-read capacity dashboard (room-left, day-maxed, nearest-open). 107/107 tests, tsc + build clean. Status → review. |
| 2026-07-16 | Code review (3-layer adversarial): 1 decision + 3 patches applied (AD-9 unify, nextOpen today-floor, day-status ceiling/past accuracy, nearestOpen loop bound), 2 deferred. 111/111 tests, tsc clean. Status → done. Closes Epic 1. |

### Review Findings

Adversarial code-review 2026-07-16 (Blind Hunter + Edge Case Hunter + Acceptance Auditor) on commit 38bf942 vs 9795a9f. 1 decision, 3 patch, 2 deferred, 0 dismissed.

- [x] [Review][Decision→Patch] AD-9 week math duplicated — **RESOLVED (unify now):** deleted `capacity.ts` private `isoWeekdayOf`/`shiftDate`/`weekRange`; it now imports `weekRangeOfDate`/`isoWeekdayOfDate` from `clock.ts`. One source for the Mon–Sun rule (booking caps + dashboard). Full suite (booking/reschedule/capacity) re-run green. [blind+auditor]
- [x] [Review][Patch] Per-day `nextOpen` lacks a `today` floor — **FIXED:** `nextOpen` now set only for a maxed **and non-past** day (`DayCapacity.past`); a past maxed day surfaces none. [app/(operator)/actions.ts; lib/domain/derive.ts]
- [x] [Review][Patch] Day "Open" status ignores the weekly ceiling / shows elapsed days as Open — **FIXED:** `weekCapacity` now emits `past` (date < today) and `open` (not past AND under per-day cap AND week under ceiling); page renders Past / Open / Day-maxed / Week full accordingly. [lib/domain/derive.ts weekCapacity; app/(operator)/page.tsx]
- [x] [Review][Patch] `nearestOpen` infinite loop on empty/invalid `workingDays` — **FIXED:** added `NEAREST_OPEN_MAX_SCAN_DAYS` calendar-day backstop so the walk terminates regardless of working-days-seen. Tests for `workingDays: []` and `[8]`. [lib/domain/derive.ts nearestOpen]
- [x] [Review][Defer] Redundant owner resolution in `getDashboardCapacity` (getOwnerCapacity + getOwnerId) — wasteful now, latent two-owner inconsistency if a real owner source lands [app/(operator)/actions.ts:57-65] — deferred
- [x] [Review][Defer] Consuming job on a now-non-working day lowers roomLeft but appears in no day row (requires dropping a weekday over an existing booking) [lib/domain/derive.ts weekConsuming vs weekCapacity] — deferred, rare edge
