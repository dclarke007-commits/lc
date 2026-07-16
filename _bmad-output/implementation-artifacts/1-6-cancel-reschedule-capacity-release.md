---
baseline_commit: 9a416135f11ea1b0b7233b4ed91bd6f534d353c2
---

# Story 1.6: Cancel & reschedule with capacity release

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As the operator,
I want to cancel or move a booking,
so that freed time reopens for others.

## Acceptance Criteria

1. **Given** a booked job, **When** I cancel it, **Then** its slot's capacity is released back into room-left and day-maxed, and it is not counted completed for lapse or repeat (FR41, AR3/AD-2). [Source: epics.md#story-1-6 AC1]
2. **Given** a booked job, **When** I reschedule it, **Then** the original slot is released and the new one commits inside one transaction under the cap check, so capacity is never transiently double-held or lost (FR41, AR12/AD-12, AR3/AD-2). [Source: epics.md#story-1-6 AC2]

## Tasks / Subtasks

- [x] **Task 1 — Cancel via `lifecycle` (AC: 1)** [Source: ARCHITECTURE-SPINE.md#AD-10, #AD-2]
  - [x] Cancel transitions `Job.completion → cancelled` through `lib/domain/lifecycle` (sole `completion` writer). Because `consumesSlot` treats `cancelled` as NOT consuming (Story 1.4), the slot is automatically released into `roomLeft`/`dayMaxed` (derive-on-read, Story 1.7) — no stored counter to decrement (AD-7). Added `booked→cancelled` to the whitelist (was the AD-10 Task-1 gap) and a `markCancelled` transition fn.
  - [x] A `cancelled` job is not counted `completed` for lapse (FR17) or repeat-rate.
  - [x] Verb-first action (`cancelJob`) + phone-first control; typed return (AR15).
- [x] **Task 2 — Reschedule = atomic release + re-commit (AC: 2)** [Source: ARCHITECTURE-SPINE.md#AD-12, #AD-2, #AD-3]
  - [x] In ONE `db.transaction()`: release the original slot AND commit the new date under the destination-week cap re-check inside the lock (AD-2/AD-3). Capacity is never transiently double-held or lost (AD-12).
  - [x] The original is only released if the new commit succeeds — a single `UPDATE job SET date` both frees the old slot and claims the new one, so there is no window where it is double-held or lost. If the new date is full → reschedule fails `day-maxed`|`week-full`, original stays intact (writes nothing).
  - [x] Chose MOVE-the-row (preserves Job identity/history; naturally idempotent) per operator decision. The cap RULE is shared with `commitBooking` via extracted `resolveConfig` + `countConsuming` helpers (AD-2: ONE capacity authority), so no second capacity path was written.
- [x] **Task 3 — Tests (AC: 1, 2)**
  - [x] Cancel: booked→cancelled frees the slot (`consumesSlot` false); not counted completed.
  - [x] Reschedule success: original slot freed, new committed, net capacity conserved, single row moved (identity preserved).
  - [x] Reschedule into a full day/week: fails with machine reason, original untouched (no capacity lost or double-held). Plus: exclude-self intra-week move, idempotent no-op, availability gates, non-booked reject, cross-tenant isolation.

## Dev Notes

### Previous story intelligence

Consumes Story 1.4 (`commitBooking`, `consumesSlot`, transaction-scoped lock) and Story 1.5 (`lifecycle` — sole `completion` writer). Reschedule MUST reuse `commitBooking` inside its transaction — do NOT write a second capacity-insert path (AD-2). Cancel is a `lifecycle` transition, not a capacity operation — capacity release is automatic because room-left is derived-on-read (AD-7), not a stored counter. [Source: 1-4-…md, 1-5-…md]

### Architecture Compliance (invariants — quote-exact)

- **AD-12 — atomic reschedule (verbatim):** "Reschedule (FR41) releases the original slot and commits the new one inside one transaction (under AD-2/AD-3), so capacity is never transiently double-held or lost." [Source: ARCHITECTURE-SPINE.md#AD-12]
- **AD-2 — capacity one owner:** all capacity-consuming inserts (incl. the reschedule's new slot) via `commitBooking`; `consumesSlot`: `cancelled` does not consume. [Source: ARCHITECTURE-SPINE.md#AD-2]
- **AD-3 — one-winner lock:** the reschedule's re-commit re-evaluates caps inside the transaction-scoped lock. [Source: ARCHITECTURE-SPINE.md#AD-3]
- **AD-10 — lifecycle:** cancel writes `completion=cancelled` only via `lifecycle`. [Source: ARCHITECTURE-SPINE.md#AD-10]
- **AD-7 — derive-on-read:** room-left/day-maxed recompute automatically; no stored capacity counter to adjust. [Source: ARCHITECTURE-SPINE.md#AD-7]
- **AR15 — typed return.**

### Scope boundaries (do NOT build here)

No dashboard render of the freed capacity (1.7 — this story just ensures the underlying rows are correct so derive shows it). No client-initiated reschedule (Epic 3). No lapse/repeat computation (Epic 3 — just ensure cancelled ≠ completed).

### FR reference [Source: epics.md#fr-41]

"Operator can cancel or reschedule a booking. Cancel releases the slot's capacity back into room-left (FR26)/day-maxed (FR27); reschedule moves the job to a new date subject to FR9 and releases the original slot. A cancelled job is not counted completed for lapse (FR17) or repeat-rate."

### Open gaps flagged to developer

1. **Reschedule mechanism** — move the row's `date` vs cancel+recreate. Moving preserves Job identity/history (better for lapse/repeat); either way must be one transaction under cap check. Dev decides.
2. **Reschedule idempotency** — AD-12 covers commit idempotency + atomicity but not a double-tap reschedule of the same job. Dev decides guard.
3. **no-show release** — AC covers cancel of a `booked` job; whether a `no-show` can be corrected to release its slot is a Story 1.5 correction-path concern; coordinate.

### References

- [Source: epics.md#Story-1-6] (epics.md:316–330); FR41 (epics.md:76); AR3/AR12 (epics.md:100,110).
- [Source: ARCHITECTURE-SPINE.md] — AD-2, AD-3, AD-7, AD-10, AD-12.

## Dev Agent Record

### Agent Model Used

Opus 4.8 (1M context) — model id `claude-opus-4-8[1m]`.

### Debug Log References

- `npx tsc --noEmit` → exit 0 (clean).
- `npx vitest run` → 87 passed / 87 (11 files). Was 72 before; +12 new
  `tests/reschedule.test.ts` cases and +3 net in `tests/lifecycle.test.ts`
  (cancel + D1/D2-closed replacing the two old resurrection-legal cases). No
  regressions — `booking.test.ts` (16) unaffected by the `commitBooking` refactor.
- No `lint` script configured; tsc is the type/quality gate.

### Completion Notes List

- **Reschedule mechanism — MOVE the row (operator decision).** `capacity.reschedule`
  moves a booked job's `date` in ONE `db.transaction()` under the destination-week
  advisory lock (same `(owner, week-monday)` key as `commitBooking`, AD-3). A single
  `UPDATE job SET date` frees the old slot and claims the new one atomically —
  capacity is never transiently double-held or lost (AD-12). The row keeps its
  identity/history and `completion` is never touched, so `lifecycle` stays the sole
  completion writer (AD-10). Only the destination week is locked (freeing the source
  can't breach a cap). Idempotent: moving to the date it already occupies is a no-op
  success, so a double-tap can't double-consume.
- **One capacity authority (AD-2).** Rather than a second capacity-insert path, the
  shared cap RULE was extracted from `commitBooking` into `resolveConfig` (config or
  DEFAULT_CAPACITY) and `countConsuming` (day+week consuming counts, with an optional
  `excludeJobId` so an intra-week move isn't blocked by the job's own slot). Both
  `commitBooking` and `reschedule` call them; `commitBooking` behaviour is unchanged.
- **Cancel via lifecycle (Task 1).** Added `booked→cancelled` to the AD-10 whitelist
  (the Task-1 gap 1.5 deferred) and a `markCancelled` transition fn. Because
  `consumesSlot(cancelled)` is false, the slot releases automatically via derive-on-read
  (AD-7) — no capacity code in the cancel path. Surfaced as `cancelJob` + a phone-first
  Cancel button on booked rows.
- **Closed the two Story-1.5 deferred keystone items (owned by 1.6):**
  - **D1** — removed `completed→booked` from the whitelist (`completed` now only →
    `cancelled`), matching AD-10 quote-exact.
  - **D2** — closed resurrection `no-show|cancelled → booked` (both now terminal `[]`),
    which previously re-consumed a slot with no cap/ceiling recheck. Fail-closed: the
    domain now rejects it, not just the (already-removed) UI button. To undo a mistaken
    cancel/no-show, re-book (cap-checked) or reschedule; a capacity-checked resurrection
    can be re-opened later if a real need appears. `deferred-work.md` D1/D2 items are
    resolved by this story.
- **Errors/surface.** Reschedule reasons (`not-reschedulable`, `date-invalid`,
  `non-working-day`, `date-past`, `day-maxed`, `week-full`, `reschedule-failed`) added
  to the jobs-surface error map. The jobs RSC booked rows now show Mark completed /
  Mark no-show / Cancel / a zero-JS `type=date` Move form; each posts to a thin
  server-action wrapper redirecting `?error=<reason>` / `?done=1` (NFR1).
- **Scope respected:** no dashboard capacity render (1.7), no client-initiated
  reschedule (Epic 3), no lapse/repeat computation (just ensured `cancelled ≠ completed`).

### File List

Modified:
- `lib/domain/capacity.ts` (extracted `resolveConfig`/`countConsuming`; added `reschedule` + `RescheduleInput`; `commitBooking` refactored to reuse the helpers, behaviour unchanged)
- `lib/domain/lifecycle.ts` (whitelist: +`booked→cancelled`, −`completed→booked` (D1), resurrection closed (D2); added `markCancelled`; header/docstrings updated)
- `lib/domain/lifecycleErrors.ts` (added reschedule/capacity reasons to the jobs-surface map)
- `app/(operator)/jobs/actions.ts` (added `cancelJob`, `rescheduleJob`)
- `app/(operator)/jobs/page.tsx` (booked-row Cancel button + zero-JS reschedule date form + wrappers)
- `tests/lifecycle.test.ts` (cancel + D1/D2-closed cases replacing the resurrection-legal cases)
- `_bmad-output/implementation-artifacts/1-6-cancel-reschedule-capacity-release.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
- `_bmad-output/implementation-artifacts/deferred-work.md` (D1/D2 marked resolved by 1.6)

Created:
- `tests/reschedule.test.ts`

### Change Log

- 2026-07-16 — Story 1.6 implemented: cancel (booked→cancelled via lifecycle, slot auto-released) and atomic move-the-row reschedule (destination-week cap check, identity preserved, idempotent). Closed deferred D1/D2 from Story 1.5. tsc clean; 87/87 tests.
