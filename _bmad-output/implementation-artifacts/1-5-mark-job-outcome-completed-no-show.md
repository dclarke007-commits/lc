---
baseline_commit: 77fbf7b
---

# Story 1.5: Mark job outcome (completed / no-show)

Status: done

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

- [x] **Task 1 — `lib/domain/lifecycle` state machine (AC: 1, 2, 3)** [Source: ARCHITECTURE-SPINE.md#AD-10]
  - [x] Create `lib/domain/lifecycle.ts` as the SOLE writer of `Job.completion`. Legal transitions: `booked → completed | no-show | cancelled`; a `completed` Job may be corrected to `cancelled`; nothing transitions OUT of `no-show`/`cancelled` except an explicit operator correction.
  - [x] Expose transition fns (e.g. `markCompleted`, `markNoShow`) returning the typed `{ok,data}|{ok:false,reason}`; reject illegal transitions with a machine reason, write nothing.
  - [x] `completion` is written ONLY here — no other module (not the ledger, not derive) writes it (AD-10).
- [x] **Task 2 — Mark-outcome Server Action + surface (AC: 1, 2)** [Source: ARCHITECTURE-SPINE.md#AD-1, AR15]
  - [x] Verb-first action `markOutcome` in `app/(operator)/**/actions.ts` → calls `lifecycle`. Typed return. owner_id-scoped.
  - [x] Phone-first RSC control on a booked job to mark completed / no-show.
- [x] **Task 3 — Downstream gating semantics (AC: 1, 2)** [Source: ARCHITECTURE-SPINE.md#AD-2, #AD-7, #AD-10]
  - [x] `completed` → ledger-eligible (`payment` becomes relevant in Epic 5; do NOT build ledger here) AND is the basis for `expectedNextDate` (derived in Epic 3 via `derive` from last **completed** job + cadence — do NOT compute/store it here).
  - [x] `no-show` → still consumes the slot (`consumesSlot` already treats `no-show` as consuming, Story 1.4) but is NOT payment-eligible and does NOT advance rebooking/lapse. Ensure marking no-show does not release capacity.
- [x] **Task 4 — Correction path (AC: 3)** [Source: ARCHITECTURE-SPINE.md#AD-10]
  - [x] Only an explicit operator correction may move out of a terminal state (`completed→cancelled` allowed; resurrecting `no-show`/`cancelled` only via explicit correction). Guard all other callers.
- [x] **Task 5 — Tests (AC: 1, 2, 3)**
  - [x] `booked→completed` and `booked→no-show` legal; illegal transitions rejected with typed reason; no path outside `lifecycle` writes `completion`; no-show keeps consuming capacity; terminal-state exit only via explicit correction.

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

Opus 4.8 (1M context) — model id `claude-opus-4-8[1m]`.

### Debug Log References

- `npx tsc --noEmit` → exit 0 (clean).
- `npx vitest run` → 70 passed / 70 (10 files). Was 58 before; +12 new
  `tests/lifecycle.test.ts` cases. No regressions.

### Completion Notes List

- **`lib/domain/lifecycle.ts`** is the SOLE writer of `Job.completion` (AD-10). One
  private `transition(ownerId, jobId, to)` runs the check-then-write inside a
  `db.transaction()` with a `for update` row lock (owner-scoped), so the legality
  check is atomic with the update. Public fns: `markCompleted`, `markNoShow`,
  `correctOutcome(ownerId, jobId, to)`, all returning `Promise<ActionResult<Job>>`.
- **Transition whitelist** (implemented exactly): `booked → completed | no-show`
  (NORMAL); `completed → cancelled | booked`, `no-show → booked`,
  `cancelled → booked` (CORRECTION — the only exit from a terminal/completed
  state). Anything else → `fail('illegal-transition')`, writes nothing. A non-UUID
  jobId → `fail('job-not-found')` (UUID-guarded before the txn); unknown id →
  `job-not-found`. Errors caught → `console.error` + `fail('lifecycle-write-failed')`.
- **`completed_at`**: set to `new Date().toISOString()` only when the target is
  `completed`; cleared to `null` for every other target (leaving `completed`
  clears it).
- **Capacity is derived, untouched here**: `no-show` still consumes
  (`consumesSlot` true — never releases); `completed → cancelled` frees the slot
  automatically because `cancelled` does not consume. No capacity code in this
  module. Ledger/`payment`/`markPaid` (Epic 5) and `expectedNextDate` (Epic 3) not
  built — only the "completed is ledger-eligible" gate noted in comments.
- **Surface + actions**: `app/(operator)/jobs/actions.ts` (`getOwnerJobs`,
  `markOutcome`, `correctOutcome`; typed AR15; owner resolved fail-closed except
  the read path which fails loud+logged; `revalidatePath('/jobs')`).
  `app/(operator)/jobs/page.tsx` is a phone-first zero-JS RSC listing date / client
  name / status; booked jobs show Mark completed + Mark no-show, terminal/completed
  jobs show Undo→booked (+ Correct to cancelled for completed), each a tiny form to
  a wrapper redirecting `?error=<reason>` / `?done=1`. Banner via
  `lifecycleErrorMessage`. Dashboard gained a `/jobs` nav link.
- **Queries**: `listJobs(ownerId)` (owner-scoped, inner-joins client for the name,
  newest date first) and `getJob(ownerId, id)` (UUID-guarded, owner-scoped) added
  to `lib/db/queries.ts`. `getJob` is exported for surface/action reuse though the
  1.5 surface currently reads via `listJobs`.
- **Two flagged gaps, decisions made:** (1) *Correction UX* — minimal per-row
  correction controls (Undo→booked always; Correct→cancelled only for completed),
  a small whitelist, not arbitrary transitions. (2) *completed→cancelled releasing
  capacity* — confirmed intended: `cancelled` does not consume, so the slot frees
  automatically via the single `consumesSlot` predicate; no explicit release code
  (that stays in 1.6). A test asserts `consumesSlot` flips to false after the
  correction.

### File List

Created:
- `lib/domain/lifecycle.ts`
- `lib/domain/lifecycleErrors.ts`
- `app/(operator)/jobs/actions.ts`
- `app/(operator)/jobs/page.tsx`
- `tests/lifecycle.test.ts`

Modified:
- `lib/db/queries.ts` (added `listJobs`, `getJob`, `JobListItem`; imported `job`/`Job`)
- `app/(operator)/page.tsx` (added `/jobs` nav link)
- `_bmad-output/implementation-artifacts/1-5-mark-job-outcome-completed-no-show.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
