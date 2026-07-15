# Story 1.3: Configure availability & caps

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As the operator,
I want to set my working days and caps,
so that the book reflects how much I actually work.

## Acceptance Criteria

1. **Given** capacity settings, **When** I view them, **Then** defaults are Mon–Sat working days, per-day cap 3, weekly ceiling 14, and default job price $200 — all editable (FR1, AR16). [Source: epics.md#story-1-3 AC1]
2. **Given** I change a working day or a cap, **When** I save, **Then** the config persists and all downstream math uses it. [Source: epics.md#story-1-3 AC2]
3. **Given** any capacity or week arithmetic, **When** computed, **Then** it runs in the operator's local timezone with the week boundary Mon–Sun (AR10/AD-9). [Source: epics.md#story-1-3 AC3]

## Tasks / Subtasks

- [ ] **Task 1 — Capacity settings storage (AC: 1, 2)** [Source: ARCHITECTURE-SPINE.md#AD-8, #Consistency-Conventions; epics.md FR1, AR16]
  - [ ] Persist operator capacity config in `lib/db/` (Drizzle). Fields: working-day set (default Mon–Sat), per-day cap (default 3), weekly ceiling (default 14), default job price (default $200 → **stored as 20000 integer cents, USD** — AR16, money-as-cents), operator timezone (see Task 3).
  - [ ] Carry `owner_id` (AD-8); scope reads/writes by it. No entity for this in the ER model — dev decides table shape (see Open gaps).
  - [ ] Default job price is operator-config, NOT a hardcoded constant anywhere downstream (AR16).
- [ ] **Task 2 — View + edit settings surface + action (AC: 1, 2)** [Source: ARCHITECTURE-SPINE.md#AD-1, AR15, NFR1]
  - [ ] RSC settings surface under `app/(operator)/` (auth-gated). Show current values (defaults on first load). Phone-first, minimal client JS, dynamic.
  - [ ] Verb-first Server Action (e.g. `saveCapacitySettings`) in `app/(operator)/**/actions.ts` — sole write path (AD-1). Typed return `{ok,data}|{ok:false,reason}` (AR15); validate values (positive caps, ceiling ≥ per-day); reject invalid with a reason, write nothing.
  - [ ] On save, config persists and becomes the single source all downstream capacity/cadence math reads (Stories 1.4/1.6/1.7 consume it — never re-hardcode 3/14/Mon–Sat).
- [ ] **Task 3 — Operator-local clock wiring (AC: 3)** [Source: ARCHITECTURE-SPINE.md#AD-9]
  - [ ] Store/resolve the operator's single timezone (source unspecified — see Open gaps). Establish the helper all schedule math uses.
  - [ ] All capacity/cadence/week arithmetic computed in operator-local tz; timestamps stored UTC ISO-8601; weekly-14 boundary Mon–Sun operator-local (AD-9/FR1). Build this helper now — Stories 1.4/1.6/1.7 depend on it.
- [ ] **Task 4 — Tests (AC: 1, 2, 3)**
  - [ ] Defaults present on first view (Mon–Sat, 3, 14, $200/20000¢). Edit persists and reloads. Save action returns typed shape; invalid rejected.
  - [ ] Week-boundary math resolves Mon–Sun in operator-local tz (unit test the clock helper, incl. a tz where UTC day ≠ local day).

## Dev Notes

### Previous story intelligence

Depends on 1.1 (DB wiring, owner_id, action contract) and sits beside 1.2 (same CRUD-action pattern, owner_id helper). Reuse 1.1's `owner_id` helper and action return contract; reuse 1.2's Drizzle/schema conventions. This story's **clock helper (Task 3) is a load-bearing dependency** for 1.4/1.6/1.7 — build it cleanly. [Source: 1-1-…md, 1-2-…md]

### Architecture Compliance (invariants)

- **AD-9 — One clock (verbatim):** "Timestamps are stored in UTC; all capacity, cadence, and week arithmetic is computed in the operator's single local timezone. The weekly-14 boundary is Monday–Sunday, operator-local (FR1)." [Source: ARCHITECTURE-SPINE.md#AD-9]
- **AD-1 — sole write path** via Server Actions; only `lib/db/` speaks SQL. [Source: ARCHITECTURE-SPINE.md#AD-1]
- **AD-8 — owner_id** on the settings row + every query. [Source: ARCHITECTURE-SPINE.md#AD-8]
- **AR16 — Money as integer cents, USD; default job price operator-config, not hardcoded.** [Source: epics.md#AR16]
- **AR15 — typed action return** `{ok,data}|{ok:false,reason}`. [Source: ARCHITECTURE-SPINE.md#Consistency-Conventions]
- **NFR7 — simplicity gate:** only ship fields that serve capacity/cash decisions. **NFR1 — phone-first.**

### Scope boundaries (do NOT build here)

No booking/`commitBooking` (1.4), no forecasting/room-left/day-maxed render (1.7), no lifecycle (1.5). This story only stores config + establishes the operator-local clock helper. FR1's cap *enforcement* is 1.4; here it's config only.

### FR1 canonical statement [Source: epics.md#fr-1]

"Maintain availability model of working days, each with a max jobs-per-day cap, and enforce a hard ceiling of 14 jobs/calendar week. Defaults: working days Mon–Sat, per-day cap 3, both operator-editable; week boundary Mon–Sun in operator-local tz." (Default price $200 per AC-1.)

### Open gaps flagged to developer

1. **No `CapacitySettings` entity in the ER model** — table shape/name is a dev decision (single-row, owner-scoped).
2. **Per-day cap: uniform vs per-weekday override** — FR1 says "each working day with a max cap" (implies per-day possible) but default is a single 3. Pick one; uniform-single-value is simplest and satisfies AC (NFR7).
3. **Operator timezone source** — AD-9 mandates operator-local but not where the tz is stored/configured. Add it to settings.

### References

- [Source: epics.md#Story-1-3] (epics.md:247–265); FR1 (epics.md:20); AR10/AD-9, AR16 (epics.md:107,95).
- [Source: ARCHITECTURE-SPINE.md] — AD-1, AD-8, AD-9; Consistency-Conventions (Errors, Dates & money, Simplicity gate).

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
