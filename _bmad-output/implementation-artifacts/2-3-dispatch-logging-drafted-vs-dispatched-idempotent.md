# Story 2.3: Dispatch logging (drafted vs dispatched, idempotent)

Status: ready-for-dev

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

- [ ] **Task 1 — `MessageLog` Drizzle schema (AC: 1, 2, 3)** [Source: ARCHITECTURE-SPINE.md#Structural-Seed, #AD-8, #AD-5, #AD-9]
  - [ ] `MessageLog` table in `lib/db/`: `uuid` PK; `owner_id` FK (AD-8, filter present in every query from v1); `client_id` FK → Client; `message_type` (aligns with template kinds — booking-confirmation | rebooking-nudge | win-back | payment-reminder, from Story 2.1); `drafted_at` UTC ISO-8601 (set on render, NOT null); `dispatched_at` UTC ISO-8601 **nullable** (null until the operator's send tap); optional `resulting_job_ref` FK → Job (FR13 attribution, per Structural Seed — a column now, populated by later stories). [Source: ARCHITECTURE-SPINE.md#Structural-Seed]
  - [ ] Generate + apply migration. A `MessageLog` row is created at draft time with `drafted_at` set and `dispatched_at` null — the row's existence is "drafted", `dispatched_at IS NOT NULL` is "dispatched".
- [ ] **Task 2 — Log `drafted_at` on compose, never dispatch (AC: 1)** [Source: ARCHITECTURE-SPINE.md#AD-5]
  - [ ] When Story 2.2's `compose` produces a `MessageDraft`, persist a `MessageLog` row with `drafted_at = now()` and `dispatched_at = null`. **No dispatch is logged on render** (AD-5: "Dispatch is recorded once, only on the operator's explicit send tap … never on render"). Rendering the deep-link (2.2 adapter) does NOT write `dispatched_at`.
  - [ ] The draft-log write carries the idempotency key (Task 3) so the subsequent send tap can target exactly this row.
- [ ] **Task 3 — Record `dispatched_at` once per draft — idempotent send (AC: 2)** [Source: ARCHITECTURE-SPINE.md#AD-5, #AD-1]
  - [ ] Verb-first Server Action (`markDispatched` / `logDispatch`) in `app/(operator)/**/actions.ts`, called on the operator's explicit send tap. Sets `dispatched_at = now()` on the target `MessageLog` row. Typed return `{ok,data}|{ok:false,reason}` (no thrown errors across the action boundary).
  - [ ] **Idempotent per draft (AD-5):** a re-tap does NOT double-log. **DEV DECISION — pick the idempotency-key mechanism:**
    - **Option A (guard on `dispatched_at IS NULL`):** conditional update `SET dispatched_at = now() WHERE id = :draftId AND dispatched_at IS NULL`; the first tap wins, a re-tap matches zero rows and is a no-op (return the existing dispatched_at). Simplest; no extra column.
    - **Option B (unique row per draft):** treat one `MessageLog` row as the single dispatch record for that draft (unique key on the draft id / `(owner_id, draft nonce)`); a re-tap keys to the same row so no second dispatch row is ever inserted.
    - Either satisfies "once per draft"; do NOT log dispatch as a separate append-only row without a uniqueness guard (that re-introduces double-counting). Choose one, document it in the File List/Completion Notes.
  - [ ] The write is on the single `owner_id` (AD-8 filter present).
- [ ] **Task 4 — Nudge-fatigue counter: derived on read (AC: 3)** [Source: ARCHITECTURE-SPINE.md#AD-7, #AD-9]
  - [ ] In `lib/domain/derive.ts`: nudge-fatigue counter reads **only** `MessageLog.dispatched_at` (NOT `drafted_at`), grouped **per client per ISO week** (Mon–Sun operator-local, AD-9). A draft that was never sent (`dispatched_at IS NULL`) does NOT count. [Source: ARCHITECTURE-SPINE.md#AD-7]
  - [ ] **Derived on read (AD-7): NO stored counter column, NO cron, NO background job** — computed from canonical `MessageLog` rows on every render, same pattern as `roomLeft`/`dayMaxed` (Story 1.7). This counter lives in the same `derive` module as the §2 counter-metrics.
- [ ] **Task 5 — Tests (AC: 1, 2, 3)**
  - [ ] Render/compose sets `drafted_at`, leaves `dispatched_at` null (no dispatch on render). Send tap sets `dispatched_at` once; a second (re-)tap does NOT produce a second dispatch (guard or unique-row — per Task 3 decision). Nudge-fatigue counts only `dispatched_at` rows, groups per client per Mon–Sun operator-local week; an unsent draft is not counted; recomputes on read (no persisted counter).

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

### Debug Log References

### Completion Notes List

### File List
