# Story 1.4: Direct booking with cap enforcement & one-winner concurrency

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As the operator,
I want to book a job for any client with caps enforced and an explicit override,
so that I never accidentally double-book — but can choose to when I mean to.

## Acceptance Criteria

1. **Given** a client and a target date, **When** I book, **Then** `capacity.commitBooking` inserts the `Job` inside one transaction after re-checking the per-day cap and the weekly-14 ceiling (FR39, FR9, AR3/AD-2). [Source: epics.md#story-1-4 AC1]
2. **Given** the day or week is full, **When** I book without override, **Then** it is rejected with a machine reason (`day-maxed` | `week-full`) and nothing is written — no silent overbook (FR9, AR15). [Source: epics.md#story-1-4 AC2]
3. **Given** the day or week is full, **When** I set the override flag, **Then** the booking commits with `Job.overridden=true`, feeding the overbooking counter-metric (FR39). [Source: epics.md#story-1-4 AC3]
4. **Given** two concurrent claims on the last open slot, **When** both attempt to commit, **Then** a `SELECT … FOR UPDATE` / `pg_advisory_xact_lock` serializes them so exactly one wins and the other receives no-availability (AR4/AD-3), **And** a concurrency stress test proves single-winner behavior. [Source: epics.md#story-1-4 AC4]
5. **Given** any `Job`, **When** capacity is computed, **Then** `consumesSlot` treats `booked|completed|no-show` as consuming and `cancelled` as not (AR3/AD-2). [Source: epics.md#story-1-4 AC5]

## Tasks / Subtasks

- [ ] **Task 1 — `Job` Drizzle schema (AC: 1, 3, 5)** [Source: ARCHITECTURE-SPINE.md#Consistency-Conventions, #AD-8, #AD-9]
  - [ ] `Job` table in `lib/db/`: `uuid` PK; `owner_id` FK (AD-8); `client_id` FK → Client; `date` (scheduled); `completion` enum `booked|completed|no-show|cancelled` (default `booked`); `payment` enum `paid|owed`; `overridden` boolean (default false); `price` integer cents (default from capacity config, AR16); `created_at`/`completed_at` UTC ISO-8601 (AD-9).
  - [ ] Generate + apply migration.
- [ ] **Task 2 — `capacity.consumesSlot(job)` predicate (AC: 5)** [Source: ARCHITECTURE-SPINE.md#AD-2]
  - [ ] In `lib/domain/capacity.ts`: `consumesSlot(job)` → `booked|completed|no-show` consume, `cancelled` does not. This ONE predicate is called by both `commitBooking` and `derive.roomLeft` (Story 1.7). Define once, here.
- [ ] **Task 3 — `capacity.commitBooking()` — sole capacity-consuming insert (AC: 1, 2, 3, 4)** [Source: ARCHITECTURE-SPINE.md#AD-2, #AD-3, #AD-12]
  - [ ] In `lib/domain/capacity.ts`: the ONLY code that inserts a capacity-consuming Job. Signature takes an `override: boolean` arg (NOT a separate path).
  - [ ] Inside one `db.transaction()`: acquire the day-row lock via `SELECT … FOR UPDATE` on the day row (preferred) OR `pg_advisory_xact_lock()` — **transaction-scoped**. **Session-scoped `pg_advisory_lock()` is FORBIDDEN** (transaction-mode pgBouncer pooling silently breaks it — AD-3).
  - [ ] Inside the lock: re-check per-day cap AND weekly-14 ceiling (counts via `consumesSlot`, week boundary Mon–Sun operator-local per AD-9, config from Story 1.3). If full and `override=false` → return `{ok:false, reason: 'day-maxed'|'week-full'}`, write nothing. If full and `override=true` → insert with `overridden=true`. If room → insert `booked`.
  - [ ] Idempotent per booking attempt (AD-12): repeat submit returns the same Job, never a second. (Operator-direct idempotency-key source is a dev decision — see Open gaps.)
- [ ] **Task 4 — Booking Server Action + surface (AC: 1, 2, 3)** [Source: ARCHITECTURE-SPINE.md#AD-1, AR15]
  - [ ] Verb-first action (`commitBooking` call site) in `app/(operator)/**/actions.ts`; calls `capacity.commitBooking`. Typed return `{ok,data}|{ok:false,reason}`; rejection reason surfaced to operator; override is an explicit operator toggle.
  - [ ] Phone-first RSC surface: pick client + date, book, see reject reason or confirmation. No client-side data store; surface never imports `lib/db`.
- [ ] **Task 5 — Concurrency stress test (AC: 4)** [Source: ARCHITECTURE-SPINE.md#AD-3]
  - [ ] Test that two concurrent commits on the last open slot yield exactly one success + one no-availability. Prove single-winner. (Harness/threshold a dev decision.)
- [ ] **Task 6 — Unit tests (AC: 1, 2, 3, 5)**
  - [ ] Cap re-check inside txn; `day-maxed`/`week-full` reasons; nothing written on reject; `overridden=true` on override; `consumesSlot` table (booked/completed/no-show consume, cancelled not); idempotent repeat submit.

## Dev Notes

### Previous story intelligence

Consumes Story 1.3's capacity config (per-day cap, weekly-14, working days, price) + operator-local clock helper — read them, never re-hardcode. Consumes 1.2's `Client`. Reuses 1.1's owner_id + action contract. **This is the architectural keystone story** — `commitBooking`, `consumesSlot`, and the transaction-scoped lock built here are called by every later booking path (client-confirm FR7 Epic 3, approve-from-queue FR36 Epic 4). Get the lock right. [Source: 1-1/1-2/1-3 …md]

### Architecture Compliance (invariants — quote-exact)

- **AD-2 — Capacity has one owner (verbatim):** "A single `capacity.commitBooking()` is the only code that inserts a capacity-consuming Job. It re-checks the per-day cap and the weekly-14 ceiling inside one transaction and commits-or-rejects… `capacity.consumesSlot(job)`: `booked`, `completed`, and `no-show` consume…; `cancelled` does not. Both `commitBooking` and `derive.roomLeft` call this one predicate. A row in `jobs` always represents consumed capacity per `consumesSlot`… All three slot-consuming paths — client-confirm (FR7), operator approve-from-queue (FR36), operator direct (FR39) — call `commitBooking`. The FR39 cap override is a boolean argument into it, never a separate insert path." [Source: ARCHITECTURE-SPINE.md#AD-2]
- **AD-3 — Exactly-one-winner (verbatim):** "`commitBooking` serializes concurrent claims via `SELECT … FOR UPDATE` on the day row (preferred) or `pg_advisory_xact_lock()` — a transaction-scoped lock — inside one `db.transaction()`, with both caps re-evaluated inside the lock. Session-scoped `pg_advisory_lock()` is forbidden: Vercel serverless uses transaction-mode connection pooling (Neon/Supabase pgBouncer), under which session-scoped locks silently break mutual exclusion. Exactly one claim wins the last slot; the rest receive no-availability." [Source: ARCHITECTURE-SPINE.md#AD-3]
- **AD-12 — Idempotency (verbatim):** "`commitBooking` is idempotent per booking attempt (an idempotency key per token-submit); a repeat submit returns the same Job, never a second…" [Source: ARCHITECTURE-SPINE.md#AD-12]
- **AD-9 — one clock:** week counts Mon–Sun operator-local; timestamps UTC. [Source: ARCHITECTURE-SPINE.md#AD-9]
- **AR15 — typed return**, capacity reasons `day-maxed`|`week-full`. [Source: ARCHITECTURE-SPINE.md#Consistency-Conventions]

### Scope boundaries (do NOT build here)

No client-token booking surface (Epic 3), no approval queue (Epic 4), no lifecycle transitions beyond insert-as-`booked` (1.5), no cancel/reschedule (1.6), no dashboard render of room-left (1.7 — but DO build `consumesSlot` here). No ledger/payment mutation (Epic 5).

### FR references [Source: epics.md]

- **FR9** — prevent over-cap booking; communicate no-availability, never silently overbook; only operator override may book past. (epics.md:28)
- **FR39** — operator direct booking subject to cap check; explicit override recorded, counts toward overbooking counter-metric; override is the only sanctioned path past a cap. (epics.md:74)

### Open gaps flagged to developer

1. **Idempotency-key source for operator-direct booking** — AD-12 phrases it "per token-submit" (client-flow language); operator-direct has no token. Dev decides the key (e.g. form-submit nonce).
2. **Overridden render math** — how `roomLeft`/`dayMaxed` (Story 1.7) show when overridden jobs push counts past 14 / per-day (negative room-left?) is unspecified.
3. **Concurrency test harness/threshold** — required to exist; framework unspecified.
4. **`SELECT … FOR UPDATE` "day row"** — implies a per-day lockable row; if capacity settings don't materialize day rows, dev decides the lock target (advisory-xact key on `(owner_id,date)` is the fallback).

### References

- [Source: epics.md#Story-1-4] (epics.md:267–294); FR9, FR39 (epics.md:28,74); AR3/AR4/AR15 (epics.md:100,101,112).
- [Source: ARCHITECTURE-SPINE.md] — AD-2, AD-3, AD-9, AD-12; Consistency-Conventions (Mutation, Errors).

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
