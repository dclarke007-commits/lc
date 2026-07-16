---
baseline_commit: 4c8ebe0f7d8f4b7a70c2d251853775c6940f646e
---

# Story 3.2: Known-client direct-confirm booking

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a known client,
I want to pick a slot and have it booked immediately,
so that rebooking takes one tap.

## Acceptance Criteria

1. **Given** a client on their per-client link, **When** they confirm an open slot, **Then** `commitBooking` attaches the Job to the existing client record without re-collecting identity and confirms directly — no approval step (FR7). [Source: epics.md#story-3-2 AC1]
2. **Given** a double-tap or repeat submit, **When** it reaches `commitBooking`, **Then** an idempotency key returns the same Job, never a second (AR13). [Source: epics.md#story-3-2 AC2]
3. **Given** the slot filled between view and confirm, **When** they submit, **Then** they receive no-availability rather than an overbook (FR9, AR4). [Source: epics.md#story-3-2 AC3]

## Tasks / Subtasks

- [x] **Task 1 — Client-confirm Server Action on the per-client surface (AC: 1)** [Source: ARCHITECTURE-SPINE.md#AD-1, #AD-6, #AD-4]
  - [x] `app/book/[token]/actions.ts`: `confirmBooking(formData)` + inner testable `confirmBookingResult(token, date)`. Resolves the token → `client_id`+`owner_id` via the shared `resolveTokenClaims` (extracted from Story 3.1's fail-closed chain). No identity re-collection, no `PendingRequest`.
  - [x] Calls the **existing** `capacity.commitBooking` (Story 1.4) with `override=false`. Direct-confirm, no approval (FR7/AD-4). Typed AR15 `{ok,data}|{ok:false,reason}`; surface never imports `lib/db` (goes through `resolveTokenClaims` + `commitBooking`).
  - [x] `client_id`/`owner_id` come from the TOKEN, never a form field (AR7/AD-6). Form carries only `token` + `date`.
- [x] **Task 2 — Idempotency key for the token-submit (AC: 2)** [Source: ARCHITECTURE-SPINE.md#AD-12]
  - [x] Server-derived key `book:${clientId}:${date}` plumbed into `commitBooking` (reuses Story 1.4's idempotency; no second dedupe). Double-tap same slot → same key → same Job.
  - [x] **Dev decision: option (a)** — server-derived `client_id + date` composite. Client is fixed by the token; the slot is day-granular (Story 3.1 openSlots are dates), so one booking per (client, day) via this link. A different date → different key → a new Job (tested). Not a client nonce (avoids double-tap creating two rows).
- [x] **Task 3 — Client-confirm booking surface (AC: 1, 3)** [Source: ARCHITECTURE-SPINE.md#AD-1, #AD-13]
  - [x] `app/book/[token]/page.tsx`: each open slot is a zero-JS POST form to `confirmBooking` (hidden `token`+`date`). `?booked=1` → direct confirmation banner (no pending state); still `force-dynamic`, no client JS.
  - [x] Lost race → no-availability banner (Task 4), remaining open slots still shown.
- [x] **Task 4 — Slot-filled-between-view-and-confirm → no-availability (AC: 3)** [Source: ARCHITECTURE-SPINE.md#AD-2, #AD-3]
  - [x] No race check reinvented — `commitBooking` re-checks caps inside the transaction-scoped lock (1.4/AD-2/AD-3). `day-maxed`|`week-full` both map to ONE client line "That time was just taken — please pick another slot."; raw reason never shown. No silent overbook.
- [x] **Task 5 — Tests (AC: 1, 2, 3)** — `tests/confirm-booking.test.ts` (5 DB-backed)
  - [x] AC1: confirm inserts a `booked` Job on the token's `client_id`+`owner_id`, `overridden=false`, exactly one row, no second mechanism/approval.
  - [x] AC2: double-tap same slot → same Job id, one row; corollary: different date → separate Job (key includes slot).
  - [x] AC3: date filled to cap → `ok:false` reason ∈ {day-maxed, week-full}, zero new Jobs for the loser. Plus a fail-closed tampered-token test (no Job, generic `invalid`).

## Dev Notes

### Previous story intelligence

- **Story 1.4 is the keystone this story reuses.** `capacity.commitBooking`, `capacity.consumesSlot`, the **transaction-scoped** day-row lock, per-attempt idempotency, and the typed `{ok,data}|{ok:false,reason}` contract were all built there. This story adds **only** the client-confirm Server Action + surface that calls `commitBooking` unchanged. **Do NOT create a parallel booking path** (AD-2). [Source: 1-4-direct-booking-cap-enforcement-one-winner-concurrency.md]
- **Story 3.1 dependency (per-client token surface).** 3.1 delivers the per-client signed token scoped to one client's `owner_id` record, unguessable, showing only genuinely-open slots (day under cap AND week under 14), no login (FR2/FR34/AR7). This story consumes that token resolution + slot list — do not re-implement token generation or the open-slot query here. [Source: epics.md#Story-3-1]

### Architecture Compliance (invariants — quote-exact)

- **AD-2 — Capacity has exactly one owner (verbatim):** "A single `capacity.commitBooking()` is the **only** code that inserts a capacity-consuming Job. It re-checks the per-day cap and the weekly-14 ceiling inside one transaction and commits-or-rejects… All three slot-consuming paths — client-confirm (FR7), operator approve-from-queue (FR36), operator direct (FR39) — call `commitBooking`. The FR39 cap **override** is a boolean argument into it, never a separate insert path." → This story is the **client-confirm (FR7)** path; it calls the one existing `commitBooking`, never a new insert. [Source: ARCHITECTURE-SPINE.md#AD-2]
- **AD-12 / AR13 — Booking idempotency (verbatim):** "`commitBooking` is idempotent per booking attempt (an idempotency key per token-submit); a repeat submit returns the same Job, never a second." [Source: ARCHITECTURE-SPINE.md#AD-12]
- **AD-3 / AR4 — Exactly-one-winner → no-availability (verbatim):** "`commitBooking` serializes concurrent claims via `SELECT … FOR UPDATE` on the day row (preferred) or `pg_advisory_xact_lock()` — a **transaction-scoped** lock — **inside one `db.transaction()`**, with both caps re-evaluated inside the lock… Exactly one claim wins the last slot; the rest receive no-availability." → AC3 (slot filled between view and confirm) is exactly a lost race; the lock already yields no-availability. Do not reinvent it. [Source: ARCHITECTURE-SPINE.md#AD-3]
- **AD-4 — Approval queue holds no capacity (verbatim):** "Known clients on a per-client link (FR7) skip the queue and commit directly." → No `PendingRequest`, no approval step for this path (contrast Epic 4's public/stranger path). [Source: ARCHITECTURE-SPINE.md#AD-4]
- **AD-6 / AR7 — Token is capability (verbatim):** "a per-client token is scoped to one client… A bearer can do exactly what its token scopes — nothing more." → `client_id` comes from the token, never from client input; no client login (FR34). [Source: ARCHITECTURE-SPINE.md#AD-6]
- **AR15 — typed return**, capacity reasons `day-maxed`|`week-full` surfaced (mapped to a client-facing no-availability message). [Source: ARCHITECTURE-SPINE.md#Consistency-Conventions]

### Scope boundaries (do NOT build here)

- **Do NOT modify `commitBooking`, `consumesSlot`, or the lock** — reuse Story 1.4 unchanged. This story is a **caller**, not a re-implementation.
- **No approval queue / `PendingRequest`** — that is Epic 4 (public path, FR36). Known-client = direct commit (AD-4).
- **No token generation / open-slot query** — delivered by Story 3.1; consumed here.
- **No override** — a known client books within caps; `override` stays `false` (override is the operator-direct path, FR39 / Story 1.4).
- **No rebooking proposal / message compose** (Story 3.3), **no post-job nudge** (3.4), **no lapse/gone-cold** (3.5), **no win-back** (3.6). This story is only "known client taps an open slot → Job committed directly."
- **No lifecycle transitions** beyond insert-as-`booked` (owned by `lib/domain/lifecycle`, AD-10); **no ledger/payment** (Epic 5).

### FR references [Source: epics.md]

- **FR7** — known client on a per-client link confirms a slot and it books immediately, no approval step (the direct-confirm path; AD-4). [Source: epics.md#Epic-3]
- **FR9** — prevent over-cap booking; communicate no-availability, never silently overbook. [Source: epics.md]
- **FR34** — client access is token-only, no login/account (AR7/AD-6). [Source: epics.md]

### Open gaps flagged to developer

1. **Idempotency-key derivation for the token-submit** — AD-12 says "per token-submit". Dev decides: server-derived `client_id + slot(date) + token` composite (natural for this flow — client fixed by token, slot is the target) vs. a client-supplied submit nonce echoed on retry. Whichever is chosen must route through Story 1.4's existing idempotency, not a new mechanism. Note the edge case: same client legitimately booking two different open dates must produce two Jobs — the key must include the slot/date, not just `client_id + token`.
2. **No-availability copy** — mapping of `day-maxed`|`week-full` machine reasons to a single client-facing "no longer available, pick another slot" message is a UX-copy decision; the machine reason is not shown raw to the client.
3. **Concurrency proof reuse** — AC3's lost-race proof should extend Story 1.4's single-winner stress test onto the token-confirm entrypoint rather than standing up a new harness.

### References

- [Source: epics.md#Story-3-2] (epics.md:460–478); FR7 (Epic 3), FR9, FR34.
- [Source: 1-4-direct-booking-cap-enforcement-one-winner-concurrency.md] — `commitBooking` / `consumesSlot` / transaction-scoped lock / idempotency (the keystone reused here).
- [Source: ARCHITECTURE-SPINE.md] — AD-2, AD-3, AD-4, AD-6, AD-12; AD-13/NFR2/NFR3 (latency); Consistency-Conventions (Mutation, Errors, Auth).

## Dev Agent Record

### Agent Model Used

claude-opus-4-8[1m] (Opus 4.8, 1M context). Build delegated to a subagent; verified independently (tsc + full suite re-run) by the main session.

### Debug Log References

- Independently verified: `npx tsc --noEmit` → 0 errors; `npx vitest run` → **188/188** (21 files, +5 over 3.1's 183). DB tests on Docker Postgres.

### Completion Notes List

- **Pure caller of Story 1.4 (AD-2):** no new insert path — `commitBooking` / `consumesSlot` / the lock / token crypto all untouched. This story adds only the client-confirm action + surface wiring.
- **Dev decision — idempotency key = `book:${clientId}:${date}`** (option a, server-derived). Client fixed by the token; slot is day-granular, so double-tap on a slot replays the same Job (AC2) and distinct dates make distinct Jobs. `override=false` always (known client never overrides caps).
- **Refactor:** extracted `resolveTokenClaims(tokenValue)` from Story 3.1's `resolveBookingView` — the ONE fail-closed token→claims chain (signature → capability → revocation row), now shared by the view resolver AND the confirm action. `resolveBookingView` behavior unchanged (its tests still green).
- **Fail-closed:** an unresolvable/tampered/revoked token → `fail('invalid')`, no Job, no leak of which guard failed. `day-maxed`|`week-full` → one client-facing no-availability line (raw reason never rendered).
- **Zero-JS (NFR1):** each open slot is a POST form; testable inner `confirmBookingResult` returns the typed AR15 result, the thin `confirmBooking(formData)` wrapper adds only the redirect (mirrors the `sendDraft`/`recordDispatch` split).
- **Scope honored:** no `PendingRequest`/approval (AD-4), no override, no lifecycle beyond insert-as-`booked`, no message compose/nudge/ledger.

### File List

- `lib/domain/booking.ts` (M) — extracted exported `resolveTokenClaims`; `resolveBookingView` now calls it (behavior unchanged)
- `app/book/[token]/actions.ts` (A) — `confirmBooking` action + inner `confirmBookingResult`
- `app/book/[token]/page.tsx` (M) — open slots as zero-JS confirm forms; booked/no-availability/invalid banners
- `tests/confirm-booking.test.ts` (A) — AC1/AC2/AC2-corollary/AC3 + fail-closed (5 DB-backed)

### Change Log

- 2026-07-16 — Story 3.2 implemented: known-client direct-confirm booking on the per-client surface. `confirmBooking` action calls the existing `commitBooking` (override=false) with a server-derived idempotency key `book:${clientId}:${date}`; extracted shared `resolveTokenClaims`; zero-JS confirm forms + direct-confirmation / no-availability banners. No schema change, no new booking path (AD-2). Independently verified: tsc clean, 188/188. Status → review.
