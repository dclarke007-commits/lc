---
baseline_commit: 4b235683c1350d0f2ad1aa9124b106bad33da9a3
---

# Story 4.2: New-client public booking → provisional record + pending request

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a **new client**,
I want **to enter my details (name, phone, service address) and request a slot on the public booking link**,
so that **the operator can review and confirm me without me calling**.

## Acceptance Criteria

1. **(FR6, AR5) Provisional client + non-capacity pending request.**
   **Given** a new client on the public link (the single public signed token from Story 4.1)
   **When** they submit name, phone, and service address (and select an offered open day)
   **Then** a provisional `Client` record is created (`status = 'provisional'`, scoped to the token's `ownerId`) **and** the booking is recorded as a `PendingRequest` row that **neither reserves nor consumes capacity** — no `Job` is inserted, no cap check runs, no slot is locked.

2. **(AR12) At most one `link` Inquiry per token-visit session.**
   **Given** a link visit that begins a booking
   **When** it is submitted (including double-taps / resubmits within the same session)
   **Then** at most **one** `link` Inquiry is auto-logged for that token-visit session, deduped server-side on a per-session nonce, so the inquiry→booking conversion denominator (FR24/AR19) stays clean.

### Definition of Done (invariants — a story is not done until these hold end-to-end)

- **AR5 (critical):** submit does NOT call `commitBooking`, does NOT insert into `job`, does NOT take the week advisory lock, does NOT read/decrement day-cap or weekly-14 counters. Several pending requests MAY target the same day (no slot-uniqueness constraint).
- **AR12:** resubmitting within one token-visit session creates exactly one `link` Inquiry (idempotent on a session nonce).
- **AD-8 (AR9):** every new row (`client`, `pendingRequest`, `inquiry`) carries `ownerId`, taken from `resolvePublicTokenClaims(token).ownerId` — never from a form field, never from a session (there is none on the public surface).
- **Fail-closed:** every failure on the public write path returns/redirects to a single generic message; no raw `{ok:false, reason}`, no existence leak, no 500 (there is no `app/error.tsx`).
- **Regression:** the existing 4.1 public read view and the per-client (3.1/3.2) booking path on the same route still work unchanged.

## Tasks / Subtasks

- [x] **Task 1 — Schema: add `pendingRequest` + `inquiry` tables (AC1, AC2)**
  - [x] In `lib/db/schema.ts` add `pendingRequest` `pgTable`: `id` uuid PK; `ownerId` uuid NOT NULL FK→operator (indexed, AD-8); `clientId` uuid NOT NULL FK→client (the provisional client); `requestedDate` (local calendar day, mirror `job.date` type/convention, AD-9); `status` enum (`pending|approved|declined|withdrawn` — see design note) NOT NULL default `'pending'`; `createdAt` timestamptz UTC default now (AD-9). Do NOT add a unique constraint on `(ownerId, requestedDate)` — multiple pending requests may target one slot (FR36).
  - [x] Add `inquiry` `pgTable`: `id` uuid PK; `ownerId` uuid NOT NULL FK→operator (indexed); `clientId` uuid nullable FK→client; `source` enum (`phone|walk-in|link|referral|other`, FR37) NOT NULL; `sessionNonce` text (the token-visit session key, nullable for future manual logs in 4.4); `createdAt` timestamptz UTC. Add a **partial unique index** on `(ownerId, sessionNonce) WHERE source = 'link'` to enforce AC2's at-most-one-`link`-per-session (mirror `token.nonce` / `messageLog.draftNonce` idempotency pattern).
  - [x] Add the two enums (`pending_request_status`, `inquiry_source`) alongside existing enums.
  - [x] Generate migration: `pnpm db:generate` → produces `drizzle/0011_*.sql`. Review the generated DDL before committing. Run `pnpm db:migrate` against the Docker Postgres.

- [x] **Task 2 — Query layer: owner-scoped inserts in `lib/db/queries.ts` (AC1, AC2)**
  - [x] `insertProvisionalClient({ ownerId, name, phone, address })` → inserts `client` with `status: 'provisional'`, `cadence: 'one-time'` (NOT NULL, no DB default — must be supplied; stranger form doesn't collect cadence), returns the new client row.
  - [x] `insertPendingRequest({ ownerId, clientId, requestedDate })` → plain owner-scoped insert; NO capacity interaction.
  - [x] `logLinkInquiryIfAbsent({ ownerId, clientId, sessionNonce })` → insert with `source:'link'` using `onConflictDoNothing({ target: [...], where: <source='link' arbiter> })` on the partial unique index; returns whether a new row was created. (Follow the `onConflictDoNothing` arbiter-`where` gotcha — NOT `targetWhere`.)
  - [x] All three filter/carry `ownerId`. `lib/db` is the ONLY SQL module (AD-1/AD-2); surfaces never import it.

- [x] **Task 3 — Domain core: `app/book/[token]/request.ts` (plain module, NOT `'use server'`) (AC1, AC2)**
  - [x] Export `submitPublicRequestResult(token, formData)` returning `ActionResult` (`ok/fail` from `lib/domain/result.ts`, AR15). Keep this core OUT of any `'use server'` file (3.2 lesson: every export in a `'use server'` module becomes a public action leaking raw reasons).
  - [x] Steps: (1) `resolvePublicTokenClaims(token)` → `null` ⇒ `fail('invalid')`; extract `ownerId` + derive a `sessionNonce` from the token-submit session (AR13 keying: nonce keys on the event instance, never a bare entity id). (2) Read + trim fields via a `readFields()` helper mirroring `clients/actions.ts` (name required, phone required, address nullable/optional); invalid ⇒ `fail('invalid')`, write nothing. (3) Re-derive the offered open set via the same public derive used by 4.1 (`deriveOwnerOpenWeek(ownerId)` / `resolvePublicBookingView`) and validate the submitted `requestedDate` is a real working day in that set — never trust the form (3.2 lesson). Note: do NOT reject a currently-full day for capacity (AR5 — request holds no capacity); reject only non-working / non-offered dates ⇒ `fail('no-availability')`. (4) Insert provisional client → insert pending request → `logLinkInquiryIfAbsent`. (5) Wrap slot derivation + DB in try/catch → `fail('invalid')` (corrupt-timezone must not 500, 3.1 P2).

- [x] **Task 4 — Server action: extend `app/book/[token]/actions.ts` (AC1, AC2)**
  - [x] Add `submitPublicRequest(formData)` `'use server'` wrapper that calls `submitPublicRequestResult`, then `redirect()`-masks the outcome: success ⇒ `?submitted=1`; `no-availability` ⇒ `?error=no-availability`; else ⇒ `?error=invalid`. No raw reason ever crosses the boundary.

- [x] **Task 5 — Surface: form + banners in `app/book/[token]/page.tsx` and `PublicRequestForm.tsx` (AC1)**
  - [x] Create `app/book/[token]/PublicRequestForm.tsx` — RSC, zero-JS `<form action={submitPublicRequest}>`, phone-first minimal fields (name, phone, address, date select from the offered open set). Mirror `ClientForm.tsx` conventions. Keep it minimal (NFR2/NFR7 — no fields beyond name/phone/address + slot).
  - [x] In `page.tsx`, in the `publicResult.ok` branch, replace the non-interactive `<li>` list + "online requests are coming soon" placeholder (~lines 68–93) with the form. Add success/error banners read from `searchParams` using **`Object.hasOwn`** on the reason map (prototype-pollution guard — untrusted `?error=` param). Keep `export const dynamic = 'force-dynamic'` (AD-13).

- [x] **Task 6 — Tests (`/tests/*.test.ts`, Vitest) — one per AC + adversarial (AC1, AC2)**
  - [x] AC1: valid stranger submit ⇒ provisional client (`status='provisional'`, `cadence='one-time'`, correct `ownerId`) + one `pendingRequest`; assert NO `job` row created and NO capacity change.
  - [x] AC2: two submits within same session nonce ⇒ exactly one `link` inquiry; different session ⇒ second inquiry allowed.
  - [x] Adversarial token cases (reuse 4.1 matrix): tampered / forged / unknown / empty / revoked / cross-capability token ⇒ `invalid`, nothing written. **Weak/missing `PUBLIC_TOKEN_SECRET` ⇒ fail closed** (mandated — 4.1 F4 existed because this was missed).
  - [x] Submitted date not in offered open set ⇒ `no-availability`, nothing written. NOTE (shipped behavior, reconciled 2026-07-18): a currently-full working day is NOT in the offered open set (design decision #1 — client picks only from the offered set), so it also maps to `no-availability` and writes nothing. Capacity is still never consumed either way (AR5 holds); there is no "accept a full day" path in 4.2.
  - [x] Corrupt `capacity_settings.timezone` ⇒ generic invalid, no 500.
  - [x] `beforeEach` clears `job` + `capacitySettings` (+ new `pendingRequest`, `inquiry`) for the shared owner — test-isolation defect from 4.1.
  - [x] Build check: `npm run build` confirms `app/book/[token]` still emits **ƒ (Dynamic)**.

## Dev Notes

### The critical invariant (AR5) — read first

A `PendingRequest` is a *request*, not a booking. It records that a stranger asked for a day. It **must not**: call `commitBooking`, insert a `Job`, take the `pg_advisory_xact_lock`, or read/decrement the per-day cap or weekly-14 counter. Rationale (PRD addendum): new-client requests do not hold the slot, so several pending requests can target the same day — zero stranger-held phantom reservations. Capacity is consumed **only** later, when the operator approves from the queue (Story 4.3 routes approval through `commitBooking`, which re-checks the cap under lock, first-approval-wins). Any implementation that reserves/decrements/locks/creates-a-Job at 4.2 submit time is a defect against AR5.

### Data-shape obligation toward 4.3 (approval queue, FR36)

4.3 consumes exactly what 4.2 writes. Each `PendingRequest` must let 4.3: (a) render the queue item — client name/phone/address (via the provisional `Client`) + target date; (b) build the `Job` at approval — client ref + date (+ default price per AR16, resolved at approval, not here); (c) satisfy `ownerId`. Do NOT enforce slot-uniqueness (multiple pending may target one day).

### Reuse map (do not rebuild — 4.1/3.1/3.2 already built these)

- **Token resolution (fail-closed):** `lib/domain/publicToken.ts` → `resolvePublicTokenClaims(tokenValue)`: signature (`PUBLIC_TOKEN_SECRET`, min-32 guard in `lib/auth/clientToken.ts`) → capability `book-public` → DB revocation row agreement (`clientId===null && ownerId && capability && nonce`) → else `null`. Use it verbatim for `ownerId`.
- **Open-slot derive:** `lib/domain/openWeek.ts` `deriveOwnerOpenWeek(ownerId)` (already try/catch fail-closed on corrupt tz) and `resolvePublicBookingView` (`publicToken.ts` ~180-190) — the offered open set to re-validate against.
- **Action split (mandatory):** `app/book/[token]/actions.ts` is the ONLY `'use server'` wrapper; testable cores live in sibling non-action modules (`confirm.ts` for 3.2 → add `request.ts` for 4.2). Never export the raw-reason core from a `'use server'` file.
- **Result contract (AR15):** `ok/fail/ActionResult` from `lib/domain/result.ts`; no thrown error crosses the boundary; every catch logs + `fail(reason)`.
- **Manual input parsing (no zod anywhere):** mirror `readFields()` in `app/clients/actions.ts` (~54-67) — trim, required-field check, `{ok:true,...}|{ok:false,reason}`, write nothing on failure.
- **Owner-scoping (AD-8):** operator surfaces use `getOwnerId()` from session; the **public 4.2 action has no session** — `ownerId` MUST come from the resolved token claims.
- **Fail direction (AD-8 uniformity):** public `app/book/**` write/resolve fails **closed** (generic message). Apply uniformly.
- **Prototype-pollution guard:** any `?error=`/`?submitted=` reason map on the public surface uses `Object.hasOwn`.

### Source tree components to touch

- **UPDATE** `lib/db/schema.ts` — add `pendingRequest` + `inquiry` tables + 2 enums (header comment already reserves the names).
- **CREATE** `drizzle/0011_*.sql` — generated by `pnpm db:generate` (latest is `0010_condemned_christian_walker.sql`).
- **CREATE** `app/book/[token]/request.ts` — plain core `submitPublicRequestResult`.
- **UPDATE** `app/book/[token]/actions.ts` — add `submitPublicRequest` `'use server'` wrapper (redirect masking).
- **UPDATE** `lib/db/queries.ts` — `insertProvisionalClient`, `insertPendingRequest`, `logLinkInquiryIfAbsent`.
- **CREATE** `app/book/[token]/PublicRequestForm.tsx` — zero-JS RSC form.
- **UPDATE** `app/book/[token]/page.tsx` — replace "coming soon" `<li>` block with the form + banners.
- **CREATE/UPDATE** `/tests/*.test.ts` — new `public-request` test file; extend token/isolation coverage.

### Schema gotchas

- `client.cadence` is NOT NULL with **no DB default** and the stranger form doesn't collect it → provisional insert must hardcode a sentinel (`'one-time'`).
- `client.status` enum is `['active','provisional']` (line ~58) — `provisional` already exists; `gone-cold` is never stored (AD-7). Use `provisional`.
- `client.address` is nullable — form address may be optional at the DB level, but AC1 lists it as submitted; treat as required in the form-level `readFields()` unless the design note below is decided otherwise.
- Drizzle conflict-arbiter gotcha: `onConflictDoNothing` takes `where`; `onConflictDoUpdate` takes `targetWhere`.

### Bugs from prior reviews to NOT repeat

- **[3.2 HIGH]** idempotency key that ignores lifecycle state replayed a dead cancelled Job as "You're booked." → For 4.2, the `link`-Inquiry dedup and any request-dedup must account for lifecycle: a `withdrawn`/`declined` request must not replay as live, nor permanently block a fresh submission. (This is why `pendingRequest.status` exists and why the inquiry dedup keys on the *session nonce*, not the client id.)
- **[3.2]** re-validate submitted slot/date server-side against the freshly-derived open set — never trust the form.
- **[3.2]** don't export the raw-reason core from a `'use server'` module.
- **[3.1 P1 / 4.1 F2]** heal-vs-rotate / lost-race on upserts — use `onConflict...returning()` guards; don't select-after-insert.
- **[3.1 P2]** corrupt `settings.timezone` must not 500 — wrap derive in try/catch (`deriveOwnerOpenWeek` already does).
- **[4.1 test-isolation]** clear `job` + `capacitySettings` (+ new tables) in `beforeEach`; only the full serial suite catches this.

### Testing standards summary

- Vitest, tests flat in `/tests/*.test.ts`; DB-backed tests hit Docker Postgres, pure derive logic gets pure unit tests. Each AC → an explicit test; keep crypto/token contract tests separate from surface/resolve tests. Fake `Date` to a fixed Monday for determinism. Volume trajectory: 4.1 ended at 254 — expect this story to add a meaningful batch (token adversarial matrix + AC1/AC2 + edge cases).
- **Verify discipline (load-bearing, from memory):** independently re-run `npx tsc --noEmit` + the FULL suite on any delegated "green" build — it has caught real bugs (the 4.1 test-isolation defect). Also `npm run build` to confirm the public route stays `ƒ (Dynamic)` (AD-13).

### Review rigor (non-optional for this story)

4.2 accepts a **stranger's untrusted input** (name/phone/address) on an unauthenticated public write surface — the widest attack surface in Epic 4 so far. The established bar applies and is mandatory: **3-layer adversarial code review (Blind Hunter / Edge Case Hunter / Acceptance Auditor) + a dedicated security review pass**, HIGH findings + patches fixed before `done`, re-verified (tsc + full suite + build). This directly discharges the carried-forward action item: *"Carry 3-1 token replay/revocation rigor + adversarial and security review into Epic 4 public self-serve (4-1/4-2)."*

### Resolved design decisions (locked with operator 2026-07-18)

1. **Slot selection = client picks a date. LOCKED.** The form presents the offered open set (reused 4.1 view) and the client selects one day; it is stored as `requestedDate` **NOT NULL** on `PendingRequest`. 4.3 approval targets that exact day. (Day-agnostic option rejected.) This is already reflected in Task 1 / Task 3 above — `requestedDate` is NOT NULL and server-re-validated against the freshly-derived open set (currently-full days still accepted per AR5; only non-working/non-offered dates rejected).
2. **Rate-limiting = accepted gap. LOCKED.** No rate-limit/abuse throttle ships in 4.2 (NFR7 minimalism; PRD defines no such NFR). Revisit only if spam appears. Do not add a throttle in this story.

### Project Structure Notes

- Layer direction is strict: surfaces → actions → domain → db. Surfaces never import `lib/db`; the public action gets `ownerId` from token claims, not session.
- New tables follow existing conventions: `ownerId` FK + index (AD-8), timestamptz UTC (AD-9), enums declared alongside existing enums. No structural variance expected.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story-4.2] (lines 572–586) — user story + ACs
- [Source: _bmad-output/planning-artifacts/epics.md] — FR6 (l.25), FR36 (l.29), FR37 (l.30); AR3/AD-2 (l.100), AR4/AD-3 (l.101), AR5/AD-4 (l.102, core invariant), AR7/AD-6 (l.104), AR9/AD-8 (l.106), AR12/AD-11 (l.109), AR1/AR2/AR13/AR15
- [Source: _bmad-output/planning-artifacts/prds/.../prd.md] — FR6 (l.79), FR36 (l.83), FR37 (l.84); NFR2/3/4/6/7; addendum: `client.status` enum incl. `provisional`, "new-client requests do not hold the slot"
- [Source: lib/db/schema.ts] — `client` (l.60-89, `clientStatus` l.58), `job` (l.157-206); `pendingRequest`/`inquiry` reserved in header (l.4) but not yet defined
- [Source: lib/domain/publicToken.ts] — `resolvePublicTokenClaims` (l.129-167), `resolvePublicBookingView` (l.180-190)
- [Source: app/book/[token]/page.tsx] — public branch + "coming soon" placeholder (l.60-96); [Source: app/book/[token]/actions.ts] `confirmBooking` redirect masking; [Source: app/book/[token]/confirm.ts] non-action core pattern
- [Source: app/clients/actions.ts] — `readFields()` manual-validation pattern (l.54-67)
- [Source: _bmad-output/implementation-artifacts/sprint-status.yaml] — `action_items` (Epic-3 carry-forward into 4-2)
- [Source: _bmad-output/implementation-artifacts/{3-1,3-2,4-1}-*.md] — prior-story dev notes, review patches, HIGH bugs

## Dev Agent Record

### Agent Model Used

claude-opus-4-8[1m] (dev-story)

### Debug Log References

- Full suite green: 264/264 (was 254; +10 new in `tests/public-request.test.ts`). `npx tsc --noEmit` exit 0. `pnpm build` compiled; `/book/[token]` renders **ƒ (Dynamic)** (AD-13 preserved).
- One iteration: initial run had 9 failures in the new test file — `beforeEach` cleared jobs/tokens but not `client`, so provisional clients accumulated across tests/files and broke exact owner-count assertions. Fixed by clearing `client` (+ `message_log`, which has an `ON DELETE restrict` FK to client) in FK-safe order.

### Completion Notes List

- **AR5 invariant enforced + tested:** the submission path never calls `commitBooking`, never inserts a `Job`, never checks/consumes capacity. AC1 test asserts `job` rows = 0 after a successful request.
- **AR12 idempotency raised to whole-submission scope (DEV DECISION):** rather than deduping only the `link` inquiry, the entire submission (provisional client + pending request + inquiry) is one `db.transaction` keyed on the per-render **visit nonce**; the `link` inquiry insert is the idempotency claim (`onConflictDoNothing` on the partial unique index), and a conflict rolls the whole transaction back. So a double-tap of the same rendered form yields exactly one client + one pending request + one inquiry; a fresh render (new nonce) is a new session. Prevents the duplicate-provisional-client bug the naive per-inquiry dedup would leave open (applies the 3.2 idempotency-replay lesson). Transaction lives in `lib/db/queries.ts` (`insertPublicBookingRequest`), keeping SQL in the db layer (AD-1), mirroring `commitBooking`.
- **Visit nonce:** minted in `page.tsx` at render (`generateTokenNonce()`, guaranteed fresh by `force-dynamic`), carried as a hidden form field. A blank/absent nonce (tampered/direct POST) falls back to a fresh server-minted nonce in `readPublicFields`, so it can never collapse legitimate first-submissions into one dedup row.
- **Re-validate the offered set (3.2 lesson):** the submitted date must be in the freshly-derived public open set (`resolvePublicBookingView`) — a date never offered (past/non-working/full) → `no-availability`, nothing written. A currently-full day is not in the open set, so it also maps to `no-availability` while still consuming no capacity (AR5).
- **Fail-closed everywhere (AD-8 uniformity):** token resolve failure, corrupt-timezone derive throw, and DB write faults all return the typed `fail('invalid')` (masked to a generic banner by the action's redirect) — no raw reason, no existence leak, no 500. `submitPublicRequestResult` is a plain (non-`'use server'`) core so it is not exposed as a second raw-reason action (3.2 lesson).
- **Prototype-pollution guard:** the public `?error=` banner map is looked up with `Object.hasOwn`.
- **Provisional client:** `status: 'provisional'`, `cadence: 'one-time'` (the stranger form collects no cadence and the column is NOT NULL with no DB default).
- **Tests (10):** AC1 (provisional client + pending request, zero jobs; null-address; missing name/phone writes nothing), AC2 (same-nonce idempotent single inquiry + `created:false` on repeat; different-nonce distinct sessions), fail-closed token chain (invalid/tampered/unknown/empty; cross-capability per-client token; weak/missing `PUBLIC_TOKEN_SECRET`), offered-set + corrupt-timezone guards. `beforeEach` clears all new tables + client/message_log for isolation.
- **Deferred to Story 4.3 (out of scope, as specced):** the approval queue that runs `commitBooking` on approve. `pending_request.status` + the `(owner, status)` index are the seams for it.

### File List

- `lib/db/schema.ts` (UPDATE) — added `pending_request` + `inquiry` tables, `pending_request_status` + `inquiry_source` enums, and `PendingRequest`/`Inquiry` types.
- `drizzle/0011_remarkable_mongu.sql` (NEW) — generated migration for the two tables + partial unique index `inquiry_owner_session_link_uq`.
- `lib/db/queries.ts` (UPDATE) — added `insertPublicBookingRequest` (transactional, idempotent) + its input/result types; imported the two new tables/types.
- `app/book/[token]/request.ts` (NEW) — `submitPublicRequestResult` core (plain module) + `readPublicFields`.
- `app/book/[token]/actions.ts` (UPDATE) — added the `submitPublicRequest` `'use server'` wrapper with redirect masking.
- `app/book/[token]/PublicRequestForm.tsx` (NEW) — zero-JS RSC request form.
- `app/book/[token]/page.tsx` (UPDATE) — replaced the 4.1 "coming soon" placeholder with the form + submitted/error banners + per-render visit nonce.
- `tests/public-request.test.ts` (NEW) — 10 tests.

## Change Log

- 2026-07-18 — Story 4.2 implemented (dev-story). New-client public booking → provisional client + `PendingRequest` (no capacity, AR5) + at-most-one `link` `Inquiry` per token-visit session (AR12), whole-submission idempotent on the visit nonce. tsc clean, 264/264 tests, build green (route stays Dynamic). Status → review.
- 2026-07-18 — Applied Epic-4 adversarial + security review findings (4 lenses, no HIGH survived). **F1 (MED):** split request idempotency to `(owner, nonce, date)` so a same-session back-button resubmit of a DIFFERENT day records a real request instead of a silent lost booking, while the `link` Inquiry stays one-per-session (AR12) — added `pending_request.session_nonce` + `pending_request_owner_session_date_uq` (migration `0012_long_monster_badoon.sql`) + 2 regression tests. **F2 (MED):** 200-char cap on name/phone/address in `readPublicFields` (unbounded-text storage-DoS on the public write). **F3 (doc):** reconciled the contradictory full-day test note to shipped behavior. **F4 (LOW):** write-failure log emits `err.message` only, not the raw error object. tsc clean, 266/266 tests, build green.
