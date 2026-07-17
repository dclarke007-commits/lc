# Story 3.4: Post-job nudge + rebooking tracking

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As the operator,
I want a nudge right after I finish a job,
so that I never forget to ask for the next one.

## Acceptance Criteria

1. **Given** a job just marked completed, **When** the outcome is recorded, **Then** a prompt surfaces to send that client's rebooking message (FR12). [Source: epics.md#story-3-4 AC1]
2. **Given** a rebooking nudge, **When** it is sent and later leads to a booking, **Then** both facts are recorded to feed the one-time → repeat conversion metric (FR13). [Source: epics.md#story-3-4 AC2]

## Tasks / Subtasks

- [x] **Task 1 — Surface the post-job nudge on `completed` outcome (AC: 1)** [Source: ARCHITECTURE-SPINE.md#AD-10, #AD-7]
  - [x] Hook the **Story 1.5** completion event: when `lifecycle` transitions a Job `booked→completed` (via the `markOutcome` action / mark-outcome surface), surface a prompt to send that client's rebooking message. `no-show` and `cancelled` do NOT surface the nudge (FR40: "Completed enables the post-job nudge (FR12)"; a no-show "does not advance rebooking/lapse logic").
  - [x] The nudge is a **view-time prompt**, not a stored flag or queued task: it is present wherever the operator sees a job whose `completion = completed` that has no rebooking nudge yet dispatched for it. Derive-on-read (AD-7) — **no `nudge_due` column, no cron, no background job.** [Source: ARCHITECTURE-SPINE.md#AD-7]
  - [x] Tapping the prompt fires the **Story 3.3** one-tap rebooking action (`compose` → rebooking `MessageDraft` pre-filled with the proposed slot + the client's per-client link). This story adds the *trigger from completion*; it does NOT re-implement 3.3's proposal/compose logic.
- [x] **Task 2 — Record nudge-sent by reusing Story 2.3 `dispatched_at` (AC: 2)** [Source: ARCHITECTURE-SPINE.md#AD-5, #AD-8]
  - [x] "Nudge sent" = the existing **Story 2.3** dispatch log: when the operator taps send on the rebooking draft, `MessageLog.dispatched_at` is set once (idempotent per draft, per 2.3's guard). **Do NOT add a parallel `nudge_sent` log or column** — the rebooking `MessageLog` row (`message_type = rebooking-nudge`) IS the record that a nudge was sent. [Source: ARCHITECTURE-SPINE.md#AD-5]
  - [x] No new dispatch path: the rebooking nudge rides 2.2 compose → 2.3 draft/dispatch logging exactly like every other outbound message. This story only ensures the rebooking draft is a `MessageLog` row so its `dispatched_at` is the sent-fact.
- [x] **Task 3 — Attribute a resulting booking back to the nudge (AC: 2)** [Source: ARCHITECTURE-SPINE.md#Structural-Seed, #AD-12, #AD-8]
  - [x] Populate the `MessageLog.resulting_job_ref` FK → Job column (declared-but-unpopulated in Story 2.3) so the dispatched rebooking nudge links to the Job it produced. This is the "nudge-resulted-in-booking" fact.
  - [x] The attribution link is written server-side within the sole write path (AD-1); the Job it references is the one created by `commitBooking` on the client's per-client link (Story 3.2 direct-confirm). owner_id-scoped (AD-8).
  - [x] **DEV DECISION — how a booking is attributed back to a nudge (see Open gaps #1):** time-window heuristic vs. explicit link (per-client link click carrying the originating nudge id). Pick one; `resulting_job_ref` is the storage either way. → **CHOSE time-window heuristic** (see Completion Notes).
- [x] **Task 4 — Conversion metric derived on read (AC: 2)** [Source: ARCHITECTURE-SPINE.md#AD-7]
  - [x] The one-time → repeat conversion metric is computed in `lib/domain/derive.ts` **on every render** from canonical rows — the two recorded facts (dispatched rebooking nudges via `MessageLog.dispatched_at` + `message_type = rebooking-nudge`, and their `resulting_job_ref` links) plus `Job.created_at`/`Job.completed_at` per addendum F. **No stored conversion counter, no cron, no background job** (AD-7). This story records the *facts*; the metric is a derivation over them.
  - [x] Reuse the existing `derive` module + operator-local Mon–Sun week helper (AD-9); do not fork a parallel metric impl.
- [x] **Task 5 — Tests (AC: 1, 2)**
  - [x] `completed` outcome surfaces the nudge prompt; `no-show`/`cancelled` do NOT. Nudge prompt disappears once a rebooking nudge is dispatched for that job/client (view-time, no stored flag). Tapping send sets `MessageLog.dispatched_at` once (reuses 2.3 idempotency — no second row/timestamp, no parallel log). A resulting booking populates `resulting_job_ref` linking nudge→Job. Conversion metric recomputes on read from the two facts (no persisted counter).

## Dev Notes

### Previous story intelligence

This story is the **join** between three already-built spines — it adds almost no new substrate, it wires existing ones:
- **Story 1.5** (`lib/domain/lifecycle`, `markOutcome`) — the `booked→completed` transition is the event AC1 hooks. FR40 explicitly says "Completed enables the post-job nudge (FR12)". Do not re-open lifecycle; subscribe to its completed outcome at view time.
- **Story 3.3** (one-tap rebooking proposal + `MessageDraft`) — the message the nudge sends. Task 1's prompt fires 3.3's action; it is not a second compose path.
- **Story 2.3** (`MessageLog.drafted_at`/`dispatched_at`, idempotent dispatch) — the "nudge sent" substrate. AC2's first fact = 2.3's `dispatched_at`. **Reuse it; do not add a parallel log** (2.3 already declared `resulting_job_ref` as a column "populated by later stories" — this is that story).
- **Story 3.2** (`commitBooking` on the per-client link) — the Job whose creation is the "resulted-in-booking" fact that `resulting_job_ref` points to.
Reuses **Story 1.1** owner_id + typed action contract, **Story 1.7/2.3**'s `derive` module + derive-on-read pattern (AD-7) and operator-local week helper (AD-9). [Source: 1-5/2-3/3-2/3-3 …md]

### Architecture Compliance (invariants — quote-exact)

- **AD-7 — Derived state is computed on read (verbatim):** "A single `derive` module computes `expectedNextDate`, `goneCold`, `roomLeft` (via `consumesSlot`, AD-2), `dayMaxed`, all dashboard metrics, **and the §2 counter-metrics** — overbooking rate (from `Job.overridden`) and nudge-fatigue (from `MessageLog.dispatched_at`) — from canonical rows on every render. The repeat-booking rate reads `Job.createdAt` and `Job.completedAt` per addendum F (rolling 30-day, same-client follow-on within 30 days of completion), never the scheduled `date` as a substitute. **No stored derived flags, no cron, no background job.**" [Source: ARCHITECTURE-SPINE.md#AD-7]
- **AD-5 — Compose ≠ deliver (verbatim, dispatch-logging clause):** "Dispatch is recorded **once, only on the operator's explicit send tap** (idempotent per draft — a re-tap does not double-log), never on render. `MessageLog` distinguishes `drafted_at` from `dispatched_at`; only `dispatched_at` feeds the nudge-fatigue counter (§2)." — the nudge-sent fact is this `dispatched_at`; no parallel log. [Source: ARCHITECTURE-SPINE.md#AD-5]
- **AD-10 — Job lifecycle authority (verbatim, relevant clause):** "A Job's `completion` follows one state machine owned by `lib/domain/lifecycle`: `booked → completed | no-show | cancelled`… `payment` is orthogonal but gated: only a `completed` Job is ledger-eligible… No path outside `lifecycle` writes `completion`." — the nudge subscribes to `completed`; it never writes `completion`. [Source: ARCHITECTURE-SPINE.md#AD-10]
- **AR6 (AD-5, verbatim):** "Dispatch recorded ONCE on the operator's explicit send tap (idempotent per draft); `MessageLog` distinguishes `drafted_at` from `dispatched_at`; only `dispatched_at` feeds nudge-fatigue." [Source: epics.md:103]
- **Structural Seed (verbatim):** "Key fields the metrics depend on: `Job.created_at`, `Job.completed_at`, `Job.overridden`; `MessageLog.drafted_at`, `dispatched_at`, optional `resulting_job_ref` (FR13)." The ER diagram: `JOB ||--o| MESSAGELOG : "attributed to (FR13)"`. [Source: ARCHITECTURE-SPINE.md#Structural-Seed]
- **AD-12 — Booking idempotency:** the resulting Job is created by `commitBooking` (idempotent per attempt); `resulting_job_ref` links to that single Job. [Source: ARCHITECTURE-SPINE.md#AD-12]
- **AD-8 — tenancy seam:** every `MessageLog`/`Job` row carries `owner_id`; the filter is present in every query. **AD-1 / AR15** — writes via Server Action returning typed `{ok,data}|{ok:false,reason}`. [Source: ARCHITECTURE-SPINE.md#AD-8, #AD-1]

### The two recorded facts (AC2), precisely

| Fact | Where recorded | Reuses |
| --- | --- | --- |
| Nudge **sent** | `MessageLog.dispatched_at` set on send tap (row with `message_type = rebooking-nudge`) | Story 2.3 dispatch logging — **no parallel log** |
| Nudge **led to a booking** | `MessageLog.resulting_job_ref` FK → the Job `commitBooking` created | Story 2.3's declared column + Story 3.2 Job |

Conversion metric = a **derive-on-read** computation over these two facts (AD-7) — never a stored counter.

### Scope boundaries (do NOT build here)

Do NOT: re-implement 3.3's rebooking proposal/`compose` (only fire it from completion); re-implement 2.2 compose or 2.3 draft/dispatch logging or its idempotency guard (only reuse them); add a parallel nudge-sent column/log (use `dispatched_at`); write `Job.completion` (that is 1.5/`lifecycle`); store a conversion counter or a `nudge_due` flag (both are derive-on-read, AD-7); build the dashboard surface that *renders* the conversion metric (Epic 6 — this story provides the facts + derivation, not the UI); build lapse/gone-cold (Story 3.5) or win-back (Story 3.6).

### FR references [Source: epics.md]

- **FR12** — "Post-job nudge: after a job is marked complete, surface a prompt to send that client's rebooking message." (epics.md:35)
- **FR13** — "Record whether a rebooking nudge was sent and whether it produced a booking (feeds one-time→repeat metric)." (epics.md:36)
- **FR40** — completed "enables the post-job nudge (FR12)"; a no-show "does not advance rebooking/lapse logic" (the completed-only trigger). (epics.md:75)

### Open gaps flagged to developer

1. **Booking→nudge attribution mechanism (Task 3)** — how a resulting Job is linked back to the nudge that produced it is a dev decision:
   - **Time-window heuristic:** attribute a booking to a recently-dispatched rebooking nudge for the same client within a bounded window after `dispatched_at`. Simple, no token change; risks mis-attribution if the client books for an unrelated reason inside the window.
   - **Explicit link (per-client link click):** the rebooking `MessageDraft` already carries the client's per-client link (Story 3.3); thread the originating nudge id through that link so the `commitBooking` on click writes `resulting_job_ref` deterministically. Precise; requires carrying the nudge id on the link/booking submit.
   `resulting_job_ref` is the storage either way. Pick one, record it in the File List/Completion Notes. (Both must stay within AD-1's server-side write path.)
2. **Nudge-prompt dismissal / re-surface** — AC1 says the prompt surfaces on completion; whether it re-surfaces if the operator ignored it, and what suppresses it (a dispatched rebooking nudge for that job vs. any rebooking nudge for that client) is a view-time predicate the dev defines. Keep it derived (AD-7) — no stored `dismissed` flag beyond what canonical rows already imply.
3. **Conversion metric exact denominator** — addendum F defines repeat-booking rate (rolling 30-day, same-client follow-on within 30 days of completion). Confirm whether the FR13 one-time→repeat metric is that same addendum-F derivation keyed off nudge facts, or a distinct nudge-conversion ratio (nudges-that-booked / nudges-sent). Do not invent a second stored metric; both are derive-on-read.

### References

- [Source: epics.md#Story-3-4] (epics.md:500–514); FR12 (epics.md:35), FR13 (epics.md:36), FR40 (epics.md:75); AR6 (epics.md:103), AR8 (epics.md:105); Epic 3 FRs covered (epics.md:184).
- [Source: ARCHITECTURE-SPINE.md] — AD-5 (Compose ≠ deliver), AD-7 (derive-on-read + repeat-rate/addendum F), AD-10 (lifecycle authority), AD-12 (booking idempotency), AD-8 (tenancy), AD-1/AR15 (write path); Structural-Seed (`MessageLog.resulting_job_ref`, `Job ||--o| MessageLog : attributed to (FR13)`).
- [Source: 1-5-mark-job-outcome-completed-no-show.md] (completion event), [Source: 2-3-dispatch-logging-drafted-vs-dispatched-idempotent.md] (`dispatched_at`, `resulting_job_ref` column), [Source: 3-3 …md] (rebooking proposal + draft), [Source: 3-2 …md] (`commitBooking` on per-client link).

## Dev Agent Record

### Agent Model Used

Opus 4.8 (1M context) — claude-opus-4-8[1m].

### Debug Log References

- `npx tsc --noEmit` → 0 errors.
- `npx vitest run` → **23 files, 218 tests, all passed** (7 new in `tests/nudge-tracking.test.ts`; no regressions). Docker Postgres up; serial singleFork.

### Completion Notes List

This is a WIRING story — it joined already-built seams and added only two PURE derives, one attribution query, and one reuse-based send action. **No schema change, no migration** (`resulting_job_ref` and the `rebooking_nudge` `message_type` enum value already existed from Stories 2.3/2.1). The three LOCKED dev decisions:

1. **Booking→nudge attribution = time-window heuristic, best-effort (Task 3, Open gap #1).** After a successful `commitBooking` in `confirmBookingResult`, a try/catch step (OUTSIDE the booking — a failure never affects the booking result, mirroring Story 2.4's post-booking draft write) calls the new owner-scoped `attributeRebookingNudge(ownerId, clientId, jobId, sinceIso)` query. It does a guarded UPDATE of the SINGLE most-recent (`ORDER BY dispatched_at DESC LIMIT 1`) dispatched `rebooking_nudge` for `(owner, client)` that is still `resulting_job_ref IS NULL` and was dispatched within `ATTRIBUTION_WINDOW_DAYS = 30`. An already-attributed nudge is excluded (a second booking never steals a link); a booking with no preceding nudge attributes nothing. `commitBooking` itself is unchanged.

2. **Nudge-sent = Story 2.3 `dispatched_at`, single shared dispatch path (Task 2).** The `?rebook=<jobId>` panel's plain WhatsApp/SMS anchors were REPLACED with dispatch-logging send forms (as `/draft` does), posting to a new `sendRebook(formData)` call-site action in `jobs/actions.ts`. `sendRebook` re-derives the SAME body via `getRebookProposal` (3.3 compose path, incl. the appended per-client link) for the deep link, then logs via the SHARED `recordDispatch` (Story 2.3's `upsertMessageDraft` + `markMessageDispatched`) — NOT a parallel log/column. The deterministic per-job nonce `rebook:<jobId>` (new `rebookingDispatchNonce`, mirroring Story 2.4's `confirm:<jobId>`) makes it idempotent: a re-tap re-opens the chat but writes no second row and stamps `dispatched_at` only once. `recordDispatch`'s existing `(clientId, type, nonce)` signature already carried type+nonce, so **no dispatch-path signature change was needed** — the only call-site extension was building the rebooking deep-link body from `getRebookProposal` rather than `previewDraft` (so the appended per-client link survives into the sent message).

3. **Conversion metric = nudge-conversion ratio, derive-on-read (Task 4, Open gap #3).** New pure `rebookingConversion(messageLogs, anchorIso, windowDays=30)` in `derive.ts` computes `{ sent, booked, ratio }` over dispatched `rebooking_nudge` rows in the rolling 30-day window: `sent` = those rows, `booked` = the subset with a non-null `resulting_job_ref`, `ratio = booked/sent` (0 when sent=0). Instant (epoch-ms) comparison, consistent with `nudgeFatigueForClient`. No stored counter, no cron. **NOTE:** addendum-F repeat-booking-rate (rolling 30-day same-client follow-on off `Job.completed_at`) is a SEPARATE Epic-6 dashboard metric — NOT this; this is the FR13 nudges-that-booked / nudges-sent ratio. The Epic-6 surface that *renders* the metric is intentionally out of scope.

Task 1 predicate: new pure `needsRebookNudge(job, messageLogs)` in `derive.ts` — true iff `completion === 'completed'` AND no dispatched `rebooking_nudge` for the client with `dispatched_at ≥ completedAt`. Computed in the ACTION layer (`getOwnerJobs` now returns `JobRow` with a `needsRebookNudge` flag) so the zero-domain-import surface just reads the flag; the completed-job row shows a highlighted "Send rebooking nudge" button (same `prepareRebook` flow), which reverts to a plain "Rebook" once a nudge is dispatched. `JobListItem`/`listJobs` gained `clientId` (needed to correlate the job with the client's dispatched nudges); `DispatchedMessage`/`listDispatchedMessages` gained `resultingJobRef` (feeds the conversion derive; nudge-fatigue ignores the extra field). No call-site signature had to change on the dispatch path.

### File List

- `lib/domain/derive.ts` — added pure `needsRebookNudge` + `rebookingConversion` (+ `NudgeJob`/`NudgeLog`/`RebookingConversion` types).
- `lib/domain/compose.ts` — added `rebookingDispatchNonce(jobId)` → `rebook:<jobId>`.
- `lib/db/queries.ts` — `JobListItem`+`listJobs` gained `clientId`; `DispatchedMessage`+`listDispatchedMessages` gained `resultingJobRef`; added guarded owner-scoped `attributeRebookingNudge`; imported `inArray`.
- `app/(operator)/jobs/actions.ts` — `getOwnerJobs` now returns annotated `JobRow` (derive-on-read nudge flag); added `sendRebook` action (reuses `getRebookProposal` + shared `recordDispatch`).
- `app/(operator)/jobs/page.tsx` — completed-job highlighted "Send rebooking nudge" variant; rebook panel now posts to `sendRebook` (dispatch-logging send forms) instead of plain anchors.
- `app/book/[token]/confirm.ts` — best-effort post-commit attribution step (30-day window) via `attributeRebookingNudge`.
- `tests/nudge-tracking.test.ts` — NEW (7 tests, DB-backed, fixed-Monday fake Date).

### Review Findings

Code review 2026-07-16 (commit `32dd4bf`, 3-layer adversarial: Blind Hunter + Edge Case Hunter + Acceptance Auditor). Auditor: all ACs met, no spec/scope violations.

**Decision-needed**

- [x] [Review][Decision→Patch] `sendRebook` re-derives the proposal at send-time — can diverge from the reviewed slot — **RESOLVED (operator chose pin + detect).** The panel now sends the reviewed slot as a hidden `slot` field; `sendRebook` re-derives and, if the current open slot differs, redirects back with `?error=slot-changed` so the operator re-reviews the updated proposal instead of silently sending a date they never saw. The outgoing body is still composed server-side (client `slot` only gates, never composes — no injection). [`app/(operator)/jobs/actions.ts` `sendRebook`, `app/(operator)/jobs/page.tsx`, `lib/domain/lifecycleErrors.ts`]. *Coverage note: the divergence gate has no dedicated test (`sendRebook` is redirect-based); suite green at 218/218.*

**Patch**

- [x] [Review][Patch] Attribution UPDATE is not atomic under concurrency — **APPLIED**: added `isNull(resultingJobRef)` to the UPDATE where-clause so a nudge already attributed by a concurrent booking loses the race cleanly (0 rows) instead of being overwritten [`lib/db/queries.ts`]

**Deferred**

- [x] [Review][Defer] Attributed booking later marked cancelled/no-show still counts as a conversion (`resulting_job_ref` set-null only on delete) [`lib/domain/derive.ts`:425] — deferred, best-effort metric, surfaced only in Epic 6
- [x] [Review][Defer] `sendRebook` logs a `rebooking_nudge` for a still-`booked` (non-completed) job [`app/(operator)/jobs/actions.ts`] — deferred, REBOOKABLE={booked,completed} is 3.3 by-design; pollutes best-effort metric only, CTA only prompts on `completed`
- [x] [Review][Defer] `getOwnerJobs` loads all owner dispatched messages every render — O(jobs×messages) [`app/(operator)/jobs/actions.ts`] — deferred, scale concern only, single-operator app
- [x] [Review][Defer] Jobs surface now `redirect()`s to `sms:` scheme instead of a plain `<a href>` anchor [`app/(operator)/jobs/page.tsx`] — deferred, mirrors pre-existing `sendDraft` pattern; verify `sms:` behavior on real devices

**Dismissed (4, not persisted):** over-attribution of any booking within 30d (spec Open gap #1/#3 — LOCKED best-effort heuristic); NaN date-parse in `needsRebookNudge`/`rebookingConversion` (verified false positive — postgres `timestamptz` `+00` text form parses correctly and matches the `Z` instant); `rebookingConversion` unwired (Epic-6 render surface is an explicit scope boundary); "Send rebooking nudge" button label (cosmetic copy).
