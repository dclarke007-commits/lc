# Story 1.5: Mark job outcome (completed / no-show)

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As the operator,
I want to mark how a job ended,
so that repeat, lapse, and ledger logic have a truthful basis.

## Acceptance Criteria

1. **Given** a booked job, **When** I mark it `completed`, **Then** `lifecycle` transitions `booked→completed`, it becomes ledger-eligible, and it sets the basis for the expected-next-date (FR40, AR11/AD-10). [Source: epics.md#story-1-5 AC1]
2. **Given** a booked job, **When** I mark it `no-show`, **Then** it still consumes the slot but is not payment-eligible and does not advance rebooking or lapse logic (FR40). [Source: epics.md#story-1-5 AC2]
3. **Given** a terminal state, **When** anything attempts to transition out of `no-show`/`cancelled`, **Then** only an explicit operator correction is allowed and no other path writes `completion` (AR11/AD-10). [Source: epics.md#story-1-5 AC3]

## Tasks / Subtasks

- [ ] **Task 1 — `lib/domain/lifecycle` state machine (AC: 1, 2, 3)** [Source: ARCHITECTURE-SPINE.md#AD-10]
  - [ ] Create `lib/domain/lifecycle.ts` as the SOLE writer of `Job.completion`. Legal transitions: `booked → completed | no-show | cancelled`; a `completed` Job may be corrected to `cancelled`; nothing transitions OUT of `no-show`/`cancelled` except an explicit operator correction.
  - [ ] Expose transition fns (e.g. `markCompleted`, `markNoShow`) returning the typed `{ok,data}|{ok:false,reason}`; reject illegal transitions with a machine reason, write nothing.
  - [ ] `completion` is written ONLY here — no other module (not the ledger, not derive) writes it (AD-10).
- [ ] **Task 2 — Mark-outcome Server Action + surface (AC: 1, 2)** [Source: ARCHITECTURE-SPINE.md#AD-1, AR15]
  - [ ] Verb-first action `markOutcome` in `app/(operator)/**/actions.ts` → calls `lifecycle`. Typed return. owner_id-scoped.
  - [ ] Phone-first RSC control on a booked job to mark completed / no-show.
- [ ] **Task 3 — Downstream gating semantics (AC: 1, 2)** [Source: ARCHITECTURE-SPINE.md#AD-2, #AD-7, #AD-10]
  - [ ] `completed` → ledger-eligible (`payment` becomes relevant in Epic 5; do NOT build ledger here) AND is the basis for `expectedNextDate` (derived in Epic 3 via `derive` from last **completed** job + cadence — do NOT compute/store it here).
  - [ ] `no-show` → still consumes the slot (`consumesSlot` already treats `no-show` as consuming, Story 1.4) but is NOT payment-eligible and does NOT advance rebooking/lapse. Ensure marking no-show does not release capacity.
- [ ] **Task 4 — Correction path (AC: 3)** [Source: ARCHITECTURE-SPINE.md#AD-10]
  - [ ] Only an explicit operator correction may move out of a terminal state (`completed→cancelled` allowed; resurrecting `no-show`/`cancelled` only via explicit correction). Guard all other callers.
- [ ] **Task 5 — Tests (AC: 1, 2, 3)**
  - [ ] `booked→completed` and `booked→no-show` legal; illegal transitions rejected with typed reason; no path outside `lifecycle` writes `completion`; no-show keeps consuming capacity; terminal-state exit only via explicit correction.

## Dev Notes

### Previous story intelligence

Consumes Story 1.4's `Job` (with `completion` enum, default `booked`) and `consumesSlot` (which already counts `no-show` as consuming). Reuses 1.1 owner_id + action contract. `lifecycle` built here is consumed by 1.6 (cancel/reschedule also transition completion) and Epic 5 ledger (gated on `completed`). [Source: 1-4-…md]

### Architecture Compliance (invariant — quote-exact)

- **AD-10 — Job lifecycle authority (verbatim):** "A Job's `completion` follows one state machine owned by `lib/domain/lifecycle`: `booked → completed | no-show | cancelled`; a `completed` Job may be corrected to `cancelled` but nothing transitions out of `no-show`/`cancelled` except an explicit operator correction. `payment` is orthogonal but gated: only a `completed` Job is ledger-eligible (`owed`/`paid`); `markPaid` sets `payment` and never alters `completion`. No path outside `lifecycle` writes `completion`; no path outside the ledger writes `payment`." [Source: ARCHITECTURE-SPINE.md#AD-10]
- **AD-1** — mutation via Server Action; **AR15** — typed return. [Source: ARCHITECTURE-SPINE.md]

### Scope boundaries (do NOT build here)

No ledger/`payment`/`markPaid` (Epic 5 — but respect the "only completed is ledger-eligible" gate). No `expectedNextDate`/gone-cold/post-job-nudge computation (Epic 3 — just set the `completed` basis). No cancel/reschedule (1.6). No capacity release logic (1.6) — no-show here must NOT release.

### FR reference [Source: epics.md#fr-40]

"Operator can mark a job's outcome completed or no-show. Completed enables the post-job nudge (FR12), sets basis for expected-next-date (FR16), and makes the job ledger-eligible (FR29). A no-show consumes the slot but is not payment-eligible and does not advance rebooking/lapse logic."

### Open gaps flagged to developer

1. **"Explicit operator correction" UX** — AD-10 permits it but the surface/guard for corrections is unspecified. Provide a minimal correction path; do not open unlimited transitions.
2. **Whether `completed→cancelled` correction releases capacity** — AD-10 allows the transition; capacity consequence overlaps 1.6. Coordinate: `cancelled` does not consume (Story 1.4 `consumesSlot`), so a completed→cancelled correction frees the slot. Confirm intended.

### References

- [Source: epics.md#Story-1-5] (epics.md:296–314); FR40 (epics.md:75); AR11 (epics.md:108).
- [Source: ARCHITECTURE-SPINE.md] — AD-10; Consistency-Conventions (Mutation, Errors).

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
