# Story 3.2: Known-client direct-confirm booking

Status: ready-for-dev

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

- [ ] **Task 1 — Client-confirm Server Action on the per-client surface (AC: 1)** [Source: ARCHITECTURE-SPINE.md#AD-1, #AD-6, #AD-4]
  - [ ] In `app/book/[token]/**/actions.ts`: a verb-first Server Action for the client-confirm path. Resolve the per-client token → its single `client_id` + `owner_id` (AD-6 token-is-capability, AR7 token-scoped). The client is already known — **do NOT re-collect identity** and **do NOT create a `PendingRequest`** (that is Epic 4's public path).
  - [ ] The action calls the **existing** `capacity.commitBooking` from Story 1.4 with `override=false` (a known client never overrides caps). Direct-confirm = no approval step (FR7 / AD-4: "Known clients on a per-client link (FR7) skip the queue and commit directly"). Typed return `{ok,data}|{ok:false,reason}`; surface never imports `lib/db`.
  - [ ] Pass `client_id` from the token, not from any client-supplied field — a bearer can do exactly what its token scopes, nothing more (AR7/AD-6).
- [ ] **Task 2 — Idempotency key for the token-submit (AC: 2)** [Source: ARCHITECTURE-SPINE.md#AD-12]
  - [ ] Derive/plumb an idempotency key per token-submit into `commitBooking` so a double-tap or repeat submit returns the **same** Job, never a second (AD-12/AR13). `commitBooking`'s idempotency was built in Story 1.4 — **reuse it**, do not add a second dedupe mechanism.
  - [ ] **Dev decision — key derivation:** AD-12 phrases idempotency "per token-submit". Options: (a) server-derived `client_id + slot(date) + token` composite, or (b) a client-supplied submit nonce echoed on retry. Pick one and document it; (a) is the natural fit for the token flow since the client is fixed by the token and the slot is the booking target. (See Open gaps.)
- [ ] **Task 3 — Client-confirm booking surface (AC: 1, 3)** [Source: ARCHITECTURE-SPINE.md#AD-1, #AD-13]
  - [ ] Phone-first RSC surface at `app/book/[token]/`: known client sees genuinely-open slots (from Story 3.1) and confirms in one tap. On success, a direct confirmation — no "pending approval" state. Minimal client JS; <60s flow / <2s interactive on 4G (AD-13/NFR2/NFR3).
  - [ ] On a lost race, render **no-availability** (see Task 4), not an overbook.
- [ ] **Task 4 — Slot-filled-between-view-and-confirm → no-availability (AC: 3)** [Source: ARCHITECTURE-SPINE.md#AD-2, #AD-3]
  - [ ] Do **not** reinvent the race check. `commitBooking` already re-checks the per-day cap + weekly-14 ceiling **inside the transaction-scoped lock** (Story 1.4 / AD-2 / AD-3); if the slot filled after the client viewed it, `commitBooking` returns `{ok:false, reason:'day-maxed'|'week-full'}`. Map that machine reason to a client-facing "no longer available" message. No silent overbook (FR9/AR4).
- [ ] **Task 5 — Tests (AC: 1, 2, 3)**
  - [ ] AC1: confirming an open slot on a per-client link inserts a `booked` Job attached to the token's `client_id`, no `PendingRequest`, no identity re-collection, no approval step.
  - [ ] AC2: repeat submit / double-tap through the client-confirm action returns the **same** Job id, never a second row.
  - [ ] AC3: slot that filled between view and confirm yields no-availability (`day-maxed`|`week-full` mapped to client message), zero Jobs written for the loser — reuse/extend Story 1.4's one-winner concurrency proof for the token path.

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

### Debug Log References

### Completion Notes List

### File List
