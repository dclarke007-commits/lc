# Story 2.4: Booking-confirmation message

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As the operator,
I want a confirmation draft the moment a booking is confirmed,
so that the client gets certainty and I look organized.

## Acceptance Criteria

1. **Given** a confirmed booking, **When** it commits, **Then** the system produces a booking-confirmation `MessageDraft` via the confirmation template (FR8). [Source: epics.md#story-2-4 AC1]
2. **Given** the confirmation draft, **When** I tap send, **Then** it dispatches through the 2.2 adapter and logs once via 2.3 (FR19, FR21, AR6). [Source: epics.md#story-2-4 AC2]
3. **Given** the job record, **When** confirmed, **Then** it already carries client, date, and price from Epic 1 — this story adds only the message (FR8). [Source: epics.md#story-2-4 AC3]

## Tasks / Subtasks

- [ ] **Task 1 — Wire confirmation compose to the booking-commit path (AC: 1, 3)** [Source: ARCHITECTURE-SPINE.md#AD-5, #AD-2, #AD-12]
  - [ ] After `capacity.commitBooking` (Story 1.4) returns `{ok:true, data: Job}`, call `compose` (Story 2.2) with the **booking-confirmation** template (Story 2.1) and the tuple `(client, slot, amount, template)` built **from the committed Job's existing fields** — `Job.client_id → Client`, `Job.date` (slot), `Job.price` (amount). Do **not** re-fetch or recompute the booking; the Job already carries client/date/price (AC3, FR8).
  - [ ] Produce a `MessageDraft{ recipient, body, type }` of type `booking-confirmation`. No transport details inside the draft (AR6/AD-5).
  - [ ] **Dev decision — commit-transaction boundary (see Open gaps #1):** compose fires **after `commitBooking` succeeds**, outside the capacity transaction. A confirmation draft is not capacity-consuming and compose ≠ deliver (AD-5), so a compose/draft-write failure must **never** roll back or block the committed Job. Never call compose inside the `db.transaction()` that acquires the day-row lock (AD-3) — it would widen the lock hold for non-capacity work.
- [ ] **Task 2 — Draft-log on creation, no dispatch on render (AC: 1, 2)** [Source: ARCHITECTURE-SPINE.md#AD-5; epics.md#story-2-3]
  - [ ] Creating the draft sets `MessageLog.drafted_at` via the Story 2.3 logging path. **No** `dispatched_at` is written on draft creation/render (AR6). Optionally attribute the log to the Job via `MessageLog.resulting_job_ref` / job attribution (FR13) — the draft is born attached to the Job it confirms.
  - [ ] **CRITICAL — no autonomous send:** the confirmation is **produced as a draft only**. It is **not** auto-sent on commit. The operator's explicit send tap is still required (FR19, AD-5, Consistency-Conventions#Messaging).
- [ ] **Task 3 — Tap-to-send dispatches via the 2.2 adapter + logs once via 2.3 (AC: 2)** [Source: ARCHITECTURE-SPINE.md#AD-5; epics.md#story-2-2, #story-2-3]
  - [ ] Operator tap routes the `MessageDraft` through the **existing** `lib/delivery` deep-link adapter (Story 2.2) → `wa.me`/`sms:` pre-filled. Reuse the 2.2 adapter; do **not** add a new delivery path here.
  - [ ] On tap, `dispatched_at` is recorded **once per draft**; a re-tap does **not** double-log (idempotent per draft — AR6, FR21). Only `dispatched_at` feeds the nudge-fatigue counter (AD-5 §2).
- [ ] **Task 4 — Confirmation surface hook on the booking result (AC: 1, 2)** [Source: ARCHITECTURE-SPINE.md#AD-1]
  - [ ] After a successful booking (the Story 1.4 operator-direct surface, and any later commit caller), the operator sees the confirmation draft with a send affordance. Server Action is the sole write path (AD-1); surface never imports `lib/db`. Typed return `{ok,data}|{ok:false,reason}` (AR15).
- [ ] **Task 5 — Tests (AC: 1, 2, 3)**
  - [ ] Commit → a `booking-confirmation` `MessageDraft` is produced via the confirmation template using the Job's existing client/date/price (no re-fetch). [AC1, AC3]
  - [ ] Draft creation sets `drafted_at` and writes **no** `dispatched_at`; nothing sends without a tap. [AC1, AC2 — no autonomous send]
  - [ ] Tap → dispatch via the 2.2 adapter; `dispatched_at` logged once; re-tap does not double-log. [AC2]
  - [ ] compose failure after commit does **not** roll back or lose the committed Job. [Task 1 dev decision]

## Dev Notes

### Previous story intelligence

This is the **last story of Epic 2 and the first real caller of the whole messaging spine.** It consumes, and must not rebuild:
- **Story 1.4 — `capacity.commitBooking`:** the sole capacity-consuming insert and this story's trigger point. The committed `Job` already carries `client_id`, `date`, and `price` (Job schema built in 1.4). Read those; never re-derive the booking (AC3). All three slot-consuming paths (client-confirm FR7, approve-from-queue FR36, operator-direct FR39) funnel through `commitBooking`, so hooking confirmation to the commit result covers every future booking path with one wiring.
- **Story 2.1 — templates:** the operator-editable **booking-confirmation** template with `{client}`/`{slot}`/`{amount}` placeholders, persisted per `owner_id`. Load it; missing placeholders resolve to empty/safe text (2.1 AC3), never a literal `{amount}` leak.
- **Story 2.2 — compose + delivery:** `compose(client, slot, amount, template) → MessageDraft{recipient, body, type}` and the `lib/delivery` deep-link adapter. Reuse both verbatim.
- **Story 2.3 — dispatch logging:** `drafted_at` on create, `dispatched_at` once-per-draft on tap, idempotent re-tap. Reuse this logging path; do not add a parallel one.

This story adds **only the message wiring** — no new domain module, no new adapter, no booking logic. [Source: 1-4 …md; epics.md#Epic-2]

### Architecture Compliance (invariants — quote-exact)

- **AD-5 — Compose ≠ deliver (verbatim):** "`compose` turns `(client, slot, amount, template)` into a channel-agnostic `MessageDraft{ recipient, body, type }`. A `lib/delivery` **adapter** renders the draft to a `wa.me` / `sms:` deep-link in v1. Templates depend only on `MessageDraft`, never on the transport. Auto-send later = a new adapter, no template change. Dispatch is recorded **once, only on the operator's explicit send tap** (idempotent per draft — a re-tap does not double-log), never on render. `MessageLog` distinguishes `drafted_at` from `dispatched_at`; only `dispatched_at` feeds the nudge-fatigue counter (§2)." [Source: ARCHITECTURE-SPINE.md#AD-5]
- **AD-2 — Capacity has one owner (verbatim, relevant clause):** "A single `capacity.commitBooking()` is the **only** code that inserts a capacity-consuming Job… All three slot-consuming paths — client-confirm (FR7), operator approve-from-queue (FR36), operator direct (FR39) — call `commitBooking`." This story hooks off `commitBooking`'s success; it never inserts a Job or consumes capacity. A `MessageDraft`/`MessageLog` is **not** capacity-consuming. [Source: ARCHITECTURE-SPINE.md#AD-2]
- **AD-12 — Booking idempotency (verbatim, relevant clause):** "`commitBooking` is idempotent per booking attempt… a repeat submit returns the same Job, never a second." Confirmation composes off the **returned** Job, so an idempotent repeat submit yields the same Job and must not spawn a second confirmation draft. [Source: ARCHITECTURE-SPINE.md#AD-12]
- **AR6 (compose≠deliver as an AC citation):** MessageDraft carries no transport details; `drafted_at` on create with no dispatch on render; `dispatched_at` once per draft, re-tap does not double-log. [Source: epics.md#Epic-2 (2.2/2.3 ACs)]
- **Messaging convention (verbatim):** "All outbound client comms are draft + tap-to-send (FR19); no autonomous send in v1." [Source: ARCHITECTURE-SPINE.md#Consistency-Conventions]
- **AR15 — typed return:** Server Actions return `{ ok, data } | { ok:false, reason }`; no thrown errors cross the action boundary. [Source: ARCHITECTURE-SPINE.md#Consistency-Conventions]

### The integration, precisely

1. Operator (or later, any FR7/FR36/FR39 path) commits a booking → `capacity.commitBooking` returns `{ok:true, data: Job}`.
2. **After** commit succeeds (outside the capacity txn), build `(client, slot, amount, template)` from the Job's own `client_id`/`date`/`price` + the 2.1 booking-confirmation template — no re-fetch of booking state (AC3).
3. `compose` (2.2) → `MessageDraft{ recipient, body, type:'booking-confirmation' }`; 2.3 sets `drafted_at`. **The draft is produced, not sent.**
4. Operator taps send → 2.2 `lib/delivery` adapter opens `wa.me`/`sms:` pre-filled; 2.3 records `dispatched_at` once (idempotent per draft).

### Scope boundaries (do NOT build here)

No new template (2.1 owns it), no new `compose` logic (2.2), no new delivery adapter (2.2), no new logging mechanism (2.3), no booking/capacity logic (1.4). No rebooking-nudge / win-back / payment-reminder callers (Epics 3/5) — this story wires **only** the booking-confirmation caller. No autonomous send (deferred; AD-5 keeps the adapter seam for it).

### FR references [Source: epics.md]

- **FR8** — a confirmed booking produces a confirmation message via the confirmation template; the job already carries client/date/price from Epic 1, so this adds only the message.
- **FR19** — draft + tap-to-send; nothing sends autonomously; operator tap required.
- **FR21** — dispatch logged once per draft; only `dispatched_at` feeds nudge-fatigue.

### Open gaps flagged to developer

1. **Compose timing vs. the commit transaction (RESOLVED — recommendation):** Fire compose **after `commitBooking` succeeds**, outside the `db.transaction()`. Rationale: compose ≠ deliver (AD-5) and a draft is **not** capacity-consuming (AD-2) — a message-compose/draft-write failure must not roll back or block a committed booking, and must not widen the day-row lock hold (AD-3). Do not couple booking durability to messaging.
2. **Idempotent repeat submit → single draft (AD-12):** an idempotent repeat `commitBooking` returns the same Job. Dev decides how confirmation-draft creation dedupes so a repeat submit does not create a second `booking-confirmation` draft for the same Job (e.g., key the draft to the Job id / idempotency key). AR6 already makes *dispatch* idempotent per draft; this is about not minting duplicate *drafts*.
3. **Wiring locus:** whether the compose-on-commit hook lives in the booking Server Action (call site) or is centralized so every future `commitBooking` caller (FR7/FR36) inherits it. Recommend centralizing at/next to the commit call site so Epic 3/4 booking paths get confirmation for free.

### References

- [Source: epics.md#Story-2-4] (epics.md:416–434); Epic 2 (epics.md:353–435); FR8, FR19, FR21.
- [Source: epics.md#Story-2-1/2-2/2-3] (epics.md:357–414) — template, compose+delivery, dispatch logging this story consumes.
- [Source: ARCHITECTURE-SPINE.md] — AD-5 (compose≠deliver / MessageDraft / drafted_at vs dispatched_at), AD-2 (commitBooking single owner), AD-12 (booking idempotency); Consistency-Conventions (Messaging, Mutation, Errors).
- [Source: 1-4-direct-booking-cap-enforcement-one-winner-concurrency.md] — the `commitBooking` seam this story hangs off.

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
