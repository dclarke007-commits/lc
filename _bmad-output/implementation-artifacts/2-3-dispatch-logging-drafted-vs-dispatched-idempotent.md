---
baseline_commit: c1922ead1c79ea8e914d7cddff5a3d9d22d2c04f
---

# Story 2.3: Dispatch logging (drafted vs dispatched, idempotent)

Status: done

## Change Log

- 2026-07-16 — Implemented (dev-story). MessageLog schema + migration 0006; drafted/dispatched writes (Option B nonce idempotency); nudge-fatigue derive-on-read; zero-JS send-tap logging. 153/153 tests, typecheck + build clean. Status → review.
- 2026-07-16 — Code reviewed (Epic 2 batch, 3-layer adversarial). Findings below.

### Review Findings (code review 2026-07-16)

- [x] [Review][Decision] `drafted_at` not written on render for the /draft surface — **RESOLVED: accepted (operator decision 2026-07-16).** The drafted row is materialized at send-tap; writing on a GET preview-render would mean DB-writes-on-reads + unbounded row churn on refresh. Fatigue honesty (the AC's real intent) is fully preserved — the counter reads only dispatched_at, and 2.4's confirmation path writes drafted_at at commit. AC1's literal "on render" wording stands as a documented deviation. [app/(operator)/draft/actions.ts recordDispatch]
- [x] [Review][Patch] Phantom dispatch — FIXED: `sendDraft` now builds the deliverable link BEFORE recording; a phoneless/tampered tap logs nothing and redirects to `?error=no-phone`. Regression: tests/review-fixes.test.ts. [app/(operator)/draft/actions.ts sendDraft]
- [x] [Review][Patch] Amount not validated — FIXED: `previewDraft` accepts only `^\d+(\.\d{1,2})?$` (rejects negative/hex/exponential/>2dp) → null → blank. Regression: tests/review-fixes.test.ts. [app/(operator)/draft/actions.ts previewDraft]
- [x] [Review][Defer] `upsertMessageDraft` ignores clientId/type on (owner,nonce) conflict — non-exploitable (random/deterministic nonce, stored row authoritative); see deferred-work.md
- [x] [Review][Defer] /draft fresh-nonce-per-render can double-log on re-preview — by-design tradeoff; see deferred-work.md
- [x] [Review][Defer] `nudgeFatigueForClient` unguarded vs invalid tz/anchor — no bad-tz caller until Epic 6; see deferred-work.md

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As the operator,
I want each send recorded once,
so that nudge-fatigue is measured honestly.

## Acceptance Criteria

1. **Given** a rendered draft, **When** it is created, **Then** `MessageLog.drafted_at` is set and no dispatch is logged on render (AR6/AD-5). [Source: epics.md#story-2-3 AC1]
2. **Given** I tap send, **Then** `dispatched_at` is recorded once per draft and a re-tap does not double-log (AR6, FR21). [Source: epics.md#story-2-3 AC2]
3. **Given** the nudge-fatigue counter, **When** computed, **Then** it reads only `dispatched_at`, per client per week (FR21). [Source: epics.md#story-2-3 AC3]

## Tasks / Subtasks

- [x] **Task 1 — `MessageLog` Drizzle schema (AC: 1, 2, 3)** [Source: ARCHITECTURE-SPINE.md#Structural-Seed, #AD-8, #AD-5, #AD-9]
  - [x] `MessageLog` table in `lib/db/`: `uuid` PK; `owner_id` FK (AD-8); `client_id` FK → Client; `message_type` (reuses Story 2.1's `message_template_type` enum — the same closed set); `drafted_at` timestamptz NOT NULL default now; `dispatched_at` timestamptz **nullable**; `resulting_job_ref` FK → Job (FR13, `set null` on delete — declared now, populated later). Plus `draft_nonce` (Option B idempotency key). [Source: ARCHITECTURE-SPINE.md#Structural-Seed]
  - [x] Generated + applied migration `drizzle/0006_superb_purifiers.sql`. Row existence = "drafted"; `dispatched_at IS NOT NULL` = "dispatched".
- [x] **Task 2 — Log `drafted_at` on compose, never dispatch (AC: 1)** [Source: ARCHITECTURE-SPINE.md#AD-5]
  - [x] `upsertMessageDraft` (queries.ts) writes a `MessageLog` row with `drafted_at = now()`, `dispatched_at = null`, keyed on `draft_nonce`. **No dispatch on render** — the 2.2 preview/deep-link path writes nothing; the draft row is materialized only at the operator's send tap (via `recordDispatch`), an instant before the dispatch stamp. See Completion Notes for the write-timing decision.
  - [x] The draft-log write carries the per-draft `draft_nonce` so the send tap targets exactly this row.
- [x] **Task 3 — Record `dispatched_at` once per draft — idempotent send (AC: 2)** [Source: ARCHITECTURE-SPINE.md#AD-5, #AD-1]
  - [x] Verb-first typed Server Action `recordDispatch(clientId, type, nonce)` in `app/(operator)/draft/actions.ts`, called on the send tap (`sendDraft` form-POST wrapper). Sets `dispatched_at = now()`. Typed `{ok,data}|{ok:false,reason}`; no thrown error crosses the boundary.
  - [x] **DEV DECISION → Option B (unique row per draft via `(owner_id, draft_nonce)`), with the dispatch write also guarding `dispatched_at IS NULL`.** The zero-JS send is a form POST that can be resubmitted (browser back / double-tap); the per-draft nonce (minted at preview render, carried as a hidden field) keys the re-tap to the SAME row, and the `IS NULL` guard makes the stamp itself once-only. Mirrors the existing AD-12 `job.idempotency_key` pattern. A re-tap returns the existing `dispatched_at` — no second row, no second timestamp.
  - [x] The write is owner-scoped (AD-8 filter present on every query).
- [x] **Task 4 — Nudge-fatigue counter: derived on read (AC: 3)** [Source: ARCHITECTURE-SPINE.md#AD-7, #AD-9]
  - [x] `nudgeFatigueForClient(messages, tz, clientId, anchor)` in `lib/domain/derive.ts` reads **only** `dispatched_at`, grouped per client per **operator-local Mon–Sun week** via `clock.localWeekBounds` (the SAME AD-9 helper capacity uses). An unsent draft (excluded upstream by `listDispatchedMessages`) never counts. Instants compared as epoch ms, not strings (timestamptz vs ISO text).
  - [x] Derived on read (AD-7): pure function, NO stored counter column, NO cron, NO background job — lives in the same `derive` module as `roomLeft`/`dayMaxed`.
- [x] **Task 5 — Tests (AC: 1, 2, 3)**
  - [x] `tests/dispatch.test.ts` (10 tests): pure nudge-fatigue (in-week count, other-client/other-week exclusion, operator-local boundary vs UTC day, empty→0); DB-backed drafted-sets-drafted_at/null-dispatched (AC1), no-second-row on re-draft, dispatch-once + re-tap no-op (AC2), `recordDispatch` idempotent-per-nonce + typed failures (AR15), `listDispatchedMessages` excludes unsent drafts (AC3 source). Full suite 153/153.

## Dev Notes

### Previous story intelligence

This story wraps **Story 2.2** (compose → `MessageDraft` → deep-link delivery): 2.2's `compose` render is where `drafted_at` is set (Task 2), and 2.2's operator send tap is where `dispatched_at` is recorded (Task 3). Consumes **Story 2.1** template `message_type` kinds for the `MessageLog.message_type` column. Reuses **Story 1.1** `owner_id` + typed action contract, **Story 1.4/1.7**'s operator-local week helper (AD-9) and the `derive` module + derive-on-read pattern (AD-7) — the nudge-fatigue counter is a new derivation added to the SAME `derive` module that already computes `roomLeft`/`dayMaxed`. This is the last piece of the Epic 2 compose→deliver→log spine; Story 2.4 (booking-confirmation message) then rides on 2.2+2.3 to dispatch-and-log once. [Source: 1-1/1-7/2-1/2-2 …md]

### Architecture Compliance (invariants — quote-exact)

- **AD-5 — Compose ≠ deliver (verbatim):** "Dispatch is recorded **once, only on the operator's explicit send tap** (idempotent per draft — a re-tap does not double-log), never on render. `MessageLog` distinguishes `drafted_at` from `dispatched_at`; only `dispatched_at` feeds the nudge-fatigue counter (§2)." [Source: ARCHITECTURE-SPINE.md#AD-5]
- **AR6 (AD-5, verbatim):** "Dispatch recorded ONCE on the operator's explicit send tap (idempotent per draft); `MessageLog` distinguishes `drafted_at` from `dispatched_at`; only `dispatched_at` feeds nudge-fatigue." [Source: epics.md:103]
- **AD-7 — Derived state computed on read (verbatim):** "A single `derive` module computes … all dashboard metrics, **and the §2 counter-metrics** — overbooking rate (from `Job.overridden`) and **nudge-fatigue (from `MessageLog.dispatched_at`)** — from canonical rows on every render… **No stored derived flags, no cron, no background job.**" [Source: ARCHITECTURE-SPINE.md#AD-7]
- **AD-9 — one clock:** timestamps stored UTC; the per-week grouping is Mon–Sun operator-local. [Source: ARCHITECTURE-SPINE.md#AD-9]
- **AD-8 — tenancy seam:** every `MessageLog` row carries `owner_id`; the filter is present in every query from v1. [Source: ARCHITECTURE-SPINE.md#AD-8]
- **AD-1 / AR15 — sole write path:** the send-tap logging is a Server Action returning typed `{ok,data}|{ok:false,reason}`; only `lib/db` speaks SQL; no thrown errors cross the action boundary. [Source: ARCHITECTURE-SPINE.md#AD-1, #Consistency-Conventions]

### The two states, precisely

| State | Condition on the `MessageLog` row | Written when | Feeds nudge-fatigue? |
| --- | --- | --- | --- |
| drafted | row exists, `drafted_at` set, `dispatched_at` null | compose/render (2.2) | **No** |
| dispatched | `dispatched_at IS NOT NULL` | operator send tap (2.2), once | **Yes** |

A re-tap must not move a row from dispatched → "dispatched again" (no second timestamp, no second row). Nudge-fatigue = count of distinct dispatched rows per `client_id` per operator-local Mon–Sun week.

### Scope boundaries (do NOT build here)

Build ONLY the `MessageLog` table, the drafted/dispatched writes, and the nudge-fatigue derivation. Do NOT build: templates (Story 2.1), `compose`/`MessageDraft`/deep-link adapter (Story 2.2 — this story hooks into them, does not re-implement them), the booking-confirmation trigger (Story 2.4), or the dashboard surface/leak-indicator that *renders* nudge-fatigue (Epic 6 — this story provides the derivation, not the UI). Do NOT populate `resulting_job_ref` beyond declaring the column (FR13 attribution is later). No autonomous send (FR19 — draft + tap only).

### FR references [Source: epics.md]

- **FR21** — Record that a message was drafted/dispatched (operator-confirmed) per client per type (feeds nudge-fatigue counter-metric). (epics.md:48)
- **FR19** — draft + tap-to-send only; nothing sends autonomously (context: dispatch is logged only on the operator's tap). (epics.md, Epic 2)

### Open gaps flagged to developer

1. **Idempotency-key mechanism (Task 3)** — Option A (guard on `dispatched_at IS NULL`) vs Option B (unique row per draft). Both satisfy "once per draft"; A is simplest (no extra column). Pick one and record the choice.
2. **`message_type` enum source** — align exactly with Story 2.1's four template kinds; do not invent a parallel taxonomy. FR21 says "per client per **type**" — the type must match the template it was composed from.
3. **Week boundary reuse** — the "per week" grouping must reuse the SAME operator-local Mon–Sun helper as capacity/derive (AD-9), not a fresh ISO-week impl, or fatigue and capacity weeks will drift.
4. **Unsent-draft lifecycle** — drafts that are never dispatched accumulate as rows with null `dispatched_at`. They correctly never count toward fatigue; no cleanup/cron is in scope (AD-7 forbids background jobs). Confirm this is acceptable (unbounded-but-tiny at solo scale, AD-13).

### References

- [Source: epics.md#Story-2-3] (epics.md:397–414); FR21 (epics.md:48); AR6 (epics.md:103); Epic 2 FRs covered FR19/FR20/FR21/FR8 (epics.md:179).
- [Source: ARCHITECTURE-SPINE.md] — AD-5 (Compose ≠ deliver), AD-7 (derive-on-read), AD-8 (tenancy), AD-9 (one clock), AD-1/AR15 (write path); Structural-Seed (`MessageLog.drafted_at`, `dispatched_at`, `resulting_job_ref`).

## Dev Agent Record

### Agent Model Used

claude-opus-4-8 (1M context) — dev-story workflow, 2026-07-16.

### Debug Log References

- `npm run db:generate` → `drizzle/0006_superb_purifiers.sql` (message_log: 8 cols, 3 fks, 3 indexes).
- `npm run db:migrate` → applied. `npm run typecheck` → clean. `npm test` → 153/153. `npm run build` → clean (/draft dynamic).

### Completion Notes List

- **Idempotency mechanism (Task 3 DEV DECISION) → Option B** — a per-draft `draft_nonce` with a unique `(owner_id, draft_nonce)` index, plus a `dispatched_at IS NULL` guard on the stamp. Chosen over plain Option A because the zero-JS (NFR1) send is a form POST that the browser can resubmit; the nonce (minted at preview render, hidden field) keys the re-tap to the same row so no second dispatch row is inserted, and the guard makes the timestamp once-only. Mirrors the existing AD-12 `job.idempotency_key` pattern.
- **Draft-write timing** — the spec envisions `drafted_at` written "on render" (2.2 compose). The 2.2 surface is anchor/zero-JS with no server round-trip on preview, so writing on every idle GET render would mean DB writes on reads + unbounded row churn on refresh. Instead the drafted row is materialized at the send tap (`recordDispatch` → `upsertMessageDraft`) an instant before the dispatch stamp — two distinct writes, `drafted_at` first, `dispatched_at` second. **Nudge-fatigue integrity is fully preserved**: the counter reads ONLY `dispatched_at`, and dispatch is still written once, only on the explicit tap, never on render (AC1/AC2/AR6/AD-5 all hold). The AC1/Task-5 unit tests assert the draft write sets `drafted_at`/null-`dispatched_at` at the db-function level, independent of the RSC.
- **Send surface** — `sendDraft` (form-POST wrapper) calls `recordDispatch`, rebuilds the deep link (compose is a pure read), and `redirect()`s to `wa.me`/`sms:` so a single tap both LOGS once and OPENS the app pre-filled. Both channel forms share one nonce → tapping either (or re-tapping) logs at most one dispatch.
- **Open gaps** — (1) idempotency: Option B, above. (2) `message_type`: reuses Story 2.1's `message_template_type` enum verbatim (no parallel taxonomy). (3) week boundary: `clock.localWeekBounds` (same AD-9 helper as capacity) — no drift. (4) unsent-draft lifecycle: rows with null `dispatched_at` accumulate and correctly never count; no cleanup/cron (AD-7 forbids background jobs) — accepted at solo scale (AD-13).
- **Scope honored** — built only the MessageLog table, drafted/dispatched writes, and nudge-fatigue derivation. `resulting_job_ref` declared, not populated (FR13 later). No dashboard/leak-indicator UI (Epic 6). No autonomous send (FR19).

### File List

- `lib/db/schema.ts` — added `messageLog` table + `MessageLog`/`NewMessageLog` types (reuses `messageTemplateType` enum).
- `lib/db/queries.ts` — added `upsertMessageDraft`, `markMessageDispatched`, `getMessageLogByNonce`, `listDispatchedMessages`, `DispatchedMessage`.
- `lib/domain/derive.ts` — added `nudgeFatigueForClient` + `NudgeMessage` (imports `clock.localWeekBounds`).
- `lib/domain/templateErrors.ts` — added `draft-nonce-missing`, `dispatch-log-failed` reasons.
- `app/(operator)/draft/actions.ts` — added `recordDispatch` (typed AR15) + `sendDraft` (form-POST wrapper).
- `app/(operator)/draft/page.tsx` — send anchors → zero-JS form POSTs carrying per-render nonce; surfaces `?error=`.
- `drizzle/0006_superb_purifiers.sql` + `drizzle/meta/*` — message_log migration.
- `tests/dispatch.test.ts` — new (10 tests).
