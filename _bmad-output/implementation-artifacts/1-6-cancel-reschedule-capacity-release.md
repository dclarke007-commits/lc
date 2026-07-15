# Story 1.6: Cancel & reschedule with capacity release

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As the operator,
I want to cancel or move a booking,
so that freed time reopens for others.

## Acceptance Criteria

1. **Given** a booked job, **When** I cancel it, **Then** its slot's capacity is released back into room-left and day-maxed, and it is not counted completed for lapse or repeat (FR41, AR3/AD-2). [Source: epics.md#story-1-6 AC1]
2. **Given** a booked job, **When** I reschedule it, **Then** the original slot is released and the new one commits inside one transaction under the cap check, so capacity is never transiently double-held or lost (FR41, AR12/AD-12, AR3/AD-2). [Source: epics.md#story-1-6 AC2]

## Tasks / Subtasks

- [ ] **Task 1 — Cancel via `lifecycle` (AC: 1)** [Source: ARCHITECTURE-SPINE.md#AD-10, #AD-2]
  - [ ] Cancel transitions `Job.completion → cancelled` through `lib/domain/lifecycle` (sole `completion` writer). Because `consumesSlot` treats `cancelled` as NOT consuming (Story 1.4), the slot is automatically released into `roomLeft`/`dayMaxed` (derive-on-read, Story 1.7) — no stored counter to decrement (AD-7).
  - [ ] A `cancelled` job is not counted `completed` for lapse (FR17) or repeat-rate.
  - [ ] Verb-first action + phone-first control; typed return (AR15).
- [ ] **Task 2 — Reschedule = atomic release + re-commit (AC: 2)** [Source: ARCHITECTURE-SPINE.md#AD-12, #AD-2, #AD-3]
  - [ ] In ONE `db.transaction()`: release the original slot AND commit the new date via `capacity.commitBooking` (day/week cap re-check inside the lock, AD-2/AD-3). Capacity is never transiently double-held or lost (AD-12).
  - [ ] Implement so the original is only released if the new commit succeeds (or both roll back). If the new date is full → reschedule fails with `day-maxed`|`week-full`, original stays intact.
  - [ ] Prefer moving the existing Job row's `date` (preserving identity/history) over cancel-and-recreate — but whichever, it MUST be inside the one transaction under the cap check. (See Open gaps.)
- [ ] **Task 3 — Tests (AC: 1, 2)**
  - [ ] Cancel: booked→cancelled; slot re-appears in room-left/day-maxed (via derive); not counted completed.
  - [ ] Reschedule success: original slot freed, new committed, net capacity conserved, single transaction.
  - [ ] Reschedule into a full day/week: fails with machine reason, original untouched (no capacity lost or double-held).

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

### Debug Log References

### Completion Notes List

### File List
