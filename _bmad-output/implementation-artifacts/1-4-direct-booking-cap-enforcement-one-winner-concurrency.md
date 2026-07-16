---
baseline_commit: ab9d9e468badda7472d0830e100145ba6672f46a
---

# Story 1.4: Direct booking with cap enforcement & one-winner concurrency

Status: review

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

- [x] **Task 1 — `Job` Drizzle schema (AC: 1, 3, 5)** [Source: ARCHITECTURE-SPINE.md#Consistency-Conventions, #AD-8, #AD-9]
  - [x] `Job` table in `lib/db/`: `uuid` PK; `owner_id` FK (AD-8); `client_id` FK → Client; `date` (scheduled, Postgres `date` = operator-local calendar day); `completion` enum `booked|completed|no-show|cancelled` (default `booked`); `payment` enum `paid|owed` (default `owed`); `overridden` boolean (default false); `price_cents` integer (default from capacity config, AR16); `idempotency_key` text; `created_at`/`completed_at` UTC ISO-8601 (AD-9). Unique `(owner_id, idempotency_key)`; `(owner_id, date)` index for cap counts.
  - [x] Generate + apply migration (`0004_lethal_rage.sql`).
- [x] **Task 2 — `capacity.consumesSlot(job)` predicate (AC: 5)** [Source: ARCHITECTURE-SPINE.md#AD-2]
  - [x] In `lib/domain/capacity.ts`: `consumesSlot(job)` → `booked|completed|no-show` consume, `cancelled` does not. ONE predicate; the SQL cap counts filter on the same `CONSUMING_COMPLETIONS` constant so the rule is defined once (derive.roomLeft, Story 1.7, imports it).
- [x] **Task 3 — `capacity.commitBooking()` — sole capacity-consuming insert (AC: 1, 2, 3, 4)** [Source: ARCHITECTURE-SPINE.md#AD-2, #AD-3, #AD-12]
  - [x] In `lib/domain/capacity.ts`: the ONLY code that inserts a capacity-consuming Job. `override: boolean` arg (NOT a separate path).
  - [x] Inside one `db.transaction()`: acquire a **transaction-scoped** `pg_advisory_xact_lock(hashtext(owner), hashtext(date))` (dev decision: no day-row table exists, so the AD-3 advisory-xact fallback on `(owner,date)`). Session-scoped locks NOT used (AD-3).
  - [x] Inside the lock: re-check per-day cap AND weekly-14 ceiling (counts via `CONSUMING_COMPLETIONS`, week boundary Mon–Sun operator-local per AD-9, config from Story 1.3). Full + `override=false` → `{ok:false, reason:'day-maxed'|'week-full'}`, writes nothing. Full + `override=true` → insert `overridden=true`. Room → insert `booked`.
  - [x] Idempotent per booking attempt (AD-12): dev decision = hidden per-form nonce; repeat submit with the same key returns the same Job (checked under the lock + unique-index backstop).
- [x] **Task 4 — Booking Server Action + surface (AC: 1, 2, 3)** [Source: ARCHITECTURE-SPINE.md#AD-1, AR15]
  - [x] Verb-first `createBooking` action in `app/(operator)/bookings/actions.ts`; calls `capacity.commitBooking`. Typed return; rejection reason surfaced via `?error=`; override is an explicit checkbox.
  - [x] Phone-first RSC surface (`app/(operator)/bookings/page.tsx`): pick client + date, override toggle, hidden nonce; see reject reason or confirmation. Surface calls actions only, never `lib/db`. Dashboard nav link added.
- [x] **Task 5 — Concurrency stress test (AC: 4)** [Source: ARCHITECTURE-SPINE.md#AD-3]
  - [x] `tests/booking.test.ts`: 2 concurrent commits on the last slot → exactly 1 success + 1 `day-maxed`; plus a 5-way burst → exactly 1 winner. Real Docker Postgres; stable across 3 re-runs.
- [x] **Task 6 — Unit tests (AC: 1, 2, 3, 5)**
  - [x] Cap re-check inside txn; `day-maxed`/`week-full` reasons; nothing written on reject; `overridden=true` on override (and NOT when in-cap); `consumesSlot` table; idempotent repeat submit; cross-owner client rejected.

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

claude-opus-4-8[1m] (dev-story), orchestrator-implemented and independently verified (tsc, full suite, concurrency re-runs ×3).

### Debug Log References

- `npx tsc --noEmit` → exit 0.
- `npx vitest run` → 52/52 passed (42 prior + 10 new booking tests), no regressions.
- Concurrency (`tests/booking.test.ts`) re-run ×3: 2-way and 5-way single-slot bursts each yield exactly one winner every run (no flakiness).
- Migration `drizzle/0004_lethal_rage.sql` (job table, 3 indexes, 2 FKs) applied cleanly to Docker Postgres.

### Completion Notes List

Three dev decisions on the open gaps (user-confirmed): (1) **lock target** — no per-day row table exists, so `commitBooking` uses the AD-3 fallback `pg_advisory_xact_lock(hashtext(owner_id), hashtext(date))`, transaction-scoped, inside `db.transaction()` (session-scoped locks forbidden under pgBouncer txn pooling). (2) **idempotency key** — hidden per-form nonce (`randomUUID()` rendered per RSC load, unique `(owner_id, idempotency_key)`); a repeat submit of the same form returns the same Job. (3) **stress-test depth** — 2 concurrent + 5-way burst. Gap 2 (overridden render math) is Story 1.7 scope — untouched.

`Job.date` is a Postgres `date` (operator-local scheduled calendar day, not an instant), so per-day and weekly-14 counts are calendar arithmetic; the Mon–Sun week window is `>= monday AND < nextMonday` on ISO date strings (a date's weekday is tz-independent — AD-9). `created_at`/`completed_at` remain UTC timestamps.

`commitBooking` is the sole slot-consuming insert (AD-2): advisory lock → idempotency replay → cross-owner client guard (AD-8) → config from Story 1.3 (or `DEFAULT_CAPACITY`) → re-check both caps under the lock (per-day is the narrower `day-maxed`, then `week-full`) → insert `booked` or reject writing nothing. `overridden=true` only when the booking actually bypassed a full cap (the overbooking counter-metric), never merely because the flag was set. Typed AR15 result; catch → `console.error` + `fail('booking-failed')`. `consumesSlot` + `CONSUMING_COMPLETIONS` are the ONE consuming-status definition, shared by the predicate and the SQL counts.

Surface: zero-JS `?error`/`?booked` redirect pattern (NFR1); `getBookableClients` read fails loud + logged on unresolved owner (parity with the write path).

Scope held: insert-as-`booked` only; no lifecycle transitions (1.5), no cancel/reschedule (1.6), no room-left render (1.7), no ledger (Epic 5).

### File List

- `lib/db/schema.ts` (modified) — `job` table + `jobCompletion`/`jobPayment` enums + `Job`/`NewJob` types; `boolean`/`date` imports.
- `lib/domain/capacity.ts` (was stub → implemented) — `consumesSlot`, `CONSUMING_COMPLETIONS`, `commitBooking` + week/date helpers.
- `lib/domain/bookingErrors.ts` (new) — booking reason → operator-facing message map.
- `app/(operator)/bookings/actions.ts` (new) — `getBookableClients`, `createBooking` Server Action.
- `app/(operator)/bookings/page.tsx` (new) — phone-first RSC booking surface (client picker, date, override, hidden nonce).
- `app/(operator)/page.tsx` (modified) — dashboard nav link to `/bookings`.
- `drizzle/0004_lethal_rage.sql` (+ meta) (new) — job table migration.
- `tests/booking.test.ts` (new, 10) — cap enforcement, reasons, override, idempotency, cross-owner guard, 2-way + 5-way concurrency.
