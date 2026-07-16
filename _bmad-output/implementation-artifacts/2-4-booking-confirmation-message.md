---
baseline_commit: 1d9b193b687a643199a1bc1e0756487384714a21
---

# Story 2.4: Booking-confirmation message

Status: review

## Change Log

- 2026-07-16 — Implemented (dev-story). Wired booking-confirmation draft into the `commitBooking` success path (best-effort, outside txn); Job-keyed nonce dedup; `resulting_job_ref` attribution; reused 2.2/2.3 send+log path on the post-booking surface. 159/159 tests, typecheck + build clean. Status → review. Closes Epic 2.

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

- [x] **Task 1 — Wire confirmation compose to the booking-commit path (AC: 1, 3)** [Source: ARCHITECTURE-SPINE.md#AD-5, #AD-2, #AD-12]
  - [x] `createBooking` (bookings/actions.ts): after `commitBooking` returns `{ok:true, data: Job}`, the confirmation is built from the committed Job's OWN `client_id`/`date`/`price_cents` — the drafted-row write uses those fields; `getConfirmationDraft` composes the preview from the same Job fields + the 2.1 booking-confirmation template (default-body fallback). No re-fetch/recompute of the booking (AC3, FR8).
  - [x] Produces a `MessageDraft{ recipient, body, type:'booking_confirmation' }` (via 2.2 `compose`) — no transport detail in the draft (AR6/AD-5).
  - [x] **Dev decision (Open gap #1):** the confirmation draft-write fires AFTER `commitBooking` succeeds, OUTSIDE the capacity txn, wrapped in try/catch — best-effort. A draft-write failure NEVER rolls back or blocks the committed Job (not capacity-consuming, AD-2; compose ≠ deliver, AD-5); it never touches the day-row lock (AD-3).
- [x] **Task 2 — Draft-log on creation, no dispatch on render (AC: 1, 2)** [Source: ARCHITECTURE-SPINE.md#AD-5; epics.md#story-2-3]
  - [x] Commit writes `MessageLog.drafted_at` via the 2.3 `upsertMessageDraft`, keyed on the Job-deterministic nonce `confirm:${jobId}`, with `resulting_job_ref = job.id` (FR13 — the draft is born attached to the Job). NO `dispatched_at` on creation (AR6).
  - [x] **No autonomous send:** produced as a DRAFT only — not auto-sent on commit. The operator's explicit send tap is required (FR19, AD-5). Verified by test (drafted row has null `dispatched_at`).
- [x] **Task 3 — Tap-to-send dispatches via the 2.2 adapter + logs once via 2.3 (AC: 2)** [Source: ARCHITECTURE-SPINE.md#AD-5; epics.md#story-2-2, #story-2-3]
  - [x] Send reuses the 2.2/2.3 `sendDraft` → `deepLink` path verbatim (no new delivery/logging). `recordDispatch(clientId, 'booking_confirmation', confirm:${jobId})` stamps `dispatched_at` once; a re-tap keys to the same row → no double-log (AR6, FR21).
- [x] **Task 4 — Confirmation surface hook on the booking result (AC: 1, 2)** [Source: ARCHITECTURE-SPINE.md#AD-1]
  - [x] `bookings/page.tsx`: on `?booked=1&job=<id>` the operator sees the composed confirmation + zero-JS WhatsApp/SMS send forms (POST → `sendDraft`). Server Action is the sole write path (AD-1); surface never imports lib/db. Typed AR15 throughout. Wired at the commit call site so every future `commitBooking` caller (FR7/FR36) inherits it (Open gap #3).
- [x] **Task 5 — Tests (AC: 1, 2, 3)**
  - [x] `tests/confirmation.test.ts` (6 tests): commit → booking_confirmation drafted row off the Job's client/date/price (AC1/AC3), drafted_at set + dispatched_at null (no autonomous send), resulting_job_ref = job.id; idempotent repeat commit → same Job → single draft (AD-12); `getConfirmationDraft` composes from Job fields + unknown-job typed failure; tap dispatches once + re-tap no double-log (AC2); commit durability independent of the confirmation (Open gap #1). Full suite 159/159.

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

claude-opus-4-8 (1M context) — dev-story workflow, 2026-07-16.

### Debug Log References

- `npm run typecheck` clean; `npm test` 159/159; `npm run build` clean. No schema change (2.4 is pure wiring) — no new migration.

### Completion Notes List

- **Compose timing (Open gap #1) → after commit, outside txn, best-effort.** The confirmation draft-write is a try/catch after `commitBooking` returns ok; a failure logs and is swallowed so the committed booking is never rolled back or blocked. Covered by the `commit durability` test.
- **Dedup (Open gap #2) → deterministic Job-keyed nonce `confirm:${jobId}`** (`compose.confirmationDraftNonce`). An idempotent repeat `commitBooking` (AD-12) returns the same Job → same nonce → `upsertMessageDraft` ON CONFLICT DO NOTHING → exactly one draft. Covered by the AD-12 test.
- **Locus (Open gap #3) → wired in `createBooking`**, the shared commit call site, so future FR7/FR36 booking paths inherit confirmation with zero extra wiring.
- **Reuse, not rebuild** — no new template (2.1), no new compose (2.2 `compose`), no new delivery adapter (2.2 `deepLink`), no new logging (2.3 `upsertMessageDraft`/`recordDispatch`). The send surface reuses `sendDraft` verbatim; `getConfirmationDraft` is a pure read→compose for display.
- **Draft-write timing note** — unlike Story 2.3's ad-hoc /draft surface (where the draft row is materialized at send), the confirmation's `drafted_at` is genuinely written at commit (the natural draft-creation moment), with `resulting_job_ref` attribution — faithful to AC1 "drafted on creation."
- **No autonomous send (FR19)** — commit produces a draft only; `dispatched_at` stays null until the operator taps. Asserted in tests.
- **Scope** — only the booking-confirmation caller wired. No rebooking/win-back/payment callers (Epics 3/5). `resulting_job_ref` now populated for confirmations (the FR13 seam).

### File List

- `lib/domain/compose.ts` — added `confirmationDraftNonce(jobId)`.
- `lib/db/queries.ts` — `upsertMessageDraft` gained optional `resultingJobRef` param (FR13).
- `lib/domain/bookingErrors.ts` — added `job-not-found` reason.
- `app/(operator)/bookings/actions.ts` — `createBooking` writes the confirmation draft after commit (best-effort); added `getConfirmationDraft` + `ConfirmationDraft`.
- `app/(operator)/bookings/page.tsx` — `book()` carries the Job id; post-booking confirmation preview + zero-JS send forms (reuse `sendDraft`).
- `tests/confirmation.test.ts` — new (6 tests).
