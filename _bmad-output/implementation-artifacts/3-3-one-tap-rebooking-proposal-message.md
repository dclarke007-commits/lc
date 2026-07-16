# Story 3.3: One-tap rebooking proposal + message

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As the operator,
I want a one-tap rebooking action that proposes the right next slot,
so that repeat business happens before I leave the driveway.

## Acceptance Criteria

1. **Given** a completed or upcoming job, **When** I tap rebook, **Then** for a cadenced client it proposes the slot at their cadence interval, and for a one-time client the soonest open slot (FR10, AR8). [Source: epics.md#story-3-3 AC1]
2. **Given** the proposed slot, **When** the action fires, **Then** it composes a rebooking `MessageDraft` pre-filled with the slot and the client's per-client link, ready to send via Epic 2 (FR11). [Source: epics.md#story-3-3 AC2]
3. **Given** no open slot at the target cadence, **When** I tap rebook, **Then** the nearest open alternative is proposed rather than a failure. [Source: epics.md#story-3-3 AC3]

## Tasks / Subtasks

- [x] **Task 1 — `derive.proposeRebookSlot(client, fromJob)` slot proposal (AC: 1, 3)** [Source: ARCHITECTURE-SPINE.md#AD-7, #AD-2, #AD-9]
  - [x] In `lib/domain/derive.ts` (the single derive module, AD-7): compute the proposed next slot on read from canonical rows — **no stored flag, no cron** (AR8/AD-7).
  - [x] **Cadenced client** (`Client.cadence ∈ weekly|biweekly|monthly`, Conventions): propose the slot at the cadence interval **after the anchor job's date** (interval math in operator-local tz, AD-9). **One-time client** (`cadence = one-time`): propose the **soonest open slot** (FR10).
  - [x] Openness is `derive`'s existing capacity read (Story 1.7): a day is proposable only if **not day-maxed AND the week is under the weekly-14 ceiling** — computed via `capacity.consumesSlot` (Story 1.4). Do NOT re-implement which Job states consume capacity, and do NOT reinvent the nearest-open scan.
  - [x] Reuse Story 1.7's **nearest-open derivation** for both the one-time "soonest open" and the AC3 fallback — same forward scan over working days (config from Story 1.3), skipping non-working / day-maxed / week-full days.
- [x] **Task 2 — AC3 nearest-open fallback (never errors) (AC: 3)** [Source: ARCHITECTURE-SPINE.md#AD-7; epics.md FR10, #story-3-3 AC3]
  - [x] When the cadence-interval target day is not open (day-maxed or week-full), return the **nearest open alternative** via the Story 1.7 scan rather than failing. A cadenced client whose ideal slot is full still gets a concrete proposed slot.
  - [x] The proposal is best-effort and **must not throw**: it returns a proposed slot (or a typed empty/no-slot-in-window result the surface renders gracefully — see Open gaps). AC3 is "propose the nearest alternative, not a failure."
- [x] **Task 3 — Rebooking draft Server Action → `compose` (AC: 2)** [Source: ARCHITECTURE-SPINE.md#AD-5, #AD-1, #Consistency-Conventions Messaging]
  - [x] Verb-first Server Action in `app/(operator)/**/actions.ts` (sole write path, AD-1): given a job/client, calls Task 1 to get the proposed slot, then calls Story 2.2's **`compose(client, slot, amount, template)`** with the **`rebooking_nudge`** template (Story 2.1) to produce a `MessageDraft{recipient, body, type}`.
  - [x] The draft body is **pre-filled with the proposed slot and the client's per-client link** (Story 3.1's signed per-client token URL) via the template placeholders (FR11). The link is passed as a resolved placeholder value into `compose`/`resolveTemplate` — see Open gaps for which token (`{slot}` carries the link, or an added value) — never a new transport concern.
  - [x] **`MessageDraft` only — no autonomous send** (compose ≠ deliver, AD-5): this action composes and returns the draft ready for the operator's tap-to-send via Epic 2's `lib/delivery` adapter (Story 2.2). It does NOT open, send, or log a dispatch. Typed return `{ok,data}|{ok:false,reason}` (AR15).
- [x] **Task 4 — One-tap rebook surface (AC: 1, 2)** [Source: ARCHITECTURE-SPINE.md#AD-1, #AD-13]
  - [x] Expose a one-tap **rebook** action on each **completed or upcoming** job (trigger surface a dev decision — see Open gaps). RSC under `app/(operator)/`, phone-first, minimal client JS, dynamic (no `use cache`, AD-13). Surface reads via `derive`, writes via the action; never imports `lib/db` (AD-1).
  - [x] Tapping surfaces the proposed slot and the ready-to-send draft; sending is the operator's explicit tap (Epic 2), not part of this action.
- [x] **Task 5 — Unit tests (AC: 1, 2, 3)**
  - [x] Cadenced client → slot at cadence interval past the anchor (weekly/biweekly/monthly). One-time client → soonest open slot. Cadence target day-maxed/week-full → nearest open alternative returned, **never an error/throw** (AC3). All values recompute on read (no persisted proposal).
  - [x] Draft: `compose` called with the `rebooking_nudge` template; returned `MessageDraft` body contains the proposed slot + the per-client link; no transport/`wa.me`/`sms:` key on the draft; no dispatch logged (send is a later tap).

### Review Findings

3-layer adversarial review (2026-07-16, no HIGH). 6 patches applied, 2 dismissed, 2 confirmed:

- [x] **P1 — Fail-closed `getRebookProposal` (AR15).** Wrapped the whole body (after owner resolution) in try/catch mirroring `resolveBookingView`: any throw (corrupt `settings.timezone` → Intl `RangeError`, db fault) → `console.error` + `fail('rebook-failed')` instead of a 500. Added `rebook-failed` to the jobs reason→text map.
- [x] **P2 — Enforce rebookable state.** After loading the job, `job.completion ∉ {booked, completed}` → `fail('not-rebookable')` (enforced in BOTH `getRebookProposal` and `prepareRebook`). Added `not-rebookable` to the map. The UI `REBOOKABLE` gate is now cosmetic-only; a hand-typed `?rebook=<cancelledId>` cannot produce a draft.
- [x] **P3 — Moved the link WRITE off the GET read path (AD-1).** New POST Server Action `prepareRebook(formData)` resolves owner+job fail-closed, enforces P2, calls `ensureClientToken` (the mint), then `redirect('/jobs?rebook=<id>')`. `getRebookProposal` is now PURE: reads the existing link via `findClientToken(...,'book-client')` → `fail('link-not-ready')` when absent. `page.tsx` Rebook control is now a zero-JS `<form action={prepareRebook}>` (was a GET `<Link>` that made `<Link>` prefetch mint token rows). Inaccurate "GET is correct — no mutation" comments corrected.
- [x] **P4 — `APP_BASE_URL` hardening.** `bookingBaseUrl()` strips a trailing slash and, when the var is unset AND `NODE_ENV==='production'`, returns `fail('base-url-unset')` (no localhost link to a real client); dev/test keeps the `http://localhost:3000` default. Added `base-url-unset` to the map; `.env.example` comment now states it is REQUIRED in production.
- [x] **P5 — Unmapped-cadence guard in `proposeRebookSlot`.** If `cadence !== 'one-time'` and `CADENCE_INTERVAL_DAYS[cadence]` is undefined (enum grew without the map), falls back to the one-time soonest-open path instead of `addDaysToDate(anchor, undefined)` → `"NaN-NaN-NaN"`.
- [x] **P6 — Tests.** Added: cancelled job → `not-rebookable`; corrupt `timezone: 'Bogus/Zone'` → typed `rebook-failed` (no throw); one-time with today at cap → later nearest-open slot; `prepareRebook` mints the link + GET returns the draft (and `link-not-ready` before the mint). MessageLog stays 0 rows throughout.
- Dismissed (1): **client-name debrace** — pre-existing Story 2.1 behavior, out of scope here.
- Dismissed (2): **raw reason shown to operator** — accepted as operator-facing; the panel now routes all reasons through `lifecycleErrorMessage` for friendly copy.
- Confirmed (1): **`CADENCE_INTERVAL_DAYS.monthly = 28`** — intentional stable 4-week interval (shared with Story 3.5 lapse math), NOT a calendar month.
- Confirmed (2): **one-time proposal includes `today` itself when open** — intentional "soonest open" reading of FR10.

## Dev Notes

### Previous story intelligence

**This is the first cross-epic consumer of the Epic 2 messaging engine.** It composes but does not extend it. It stitches together three already-built seams — do NOT reinvent any of them:

- **Story 1.7 (`derive` nearest-open / room-left / day-maxed):** the openness test and the forward nearest-open scan already exist. `proposeRebookSlot` reuses them; it must not re-derive capacity math or which states consume (that is `capacity.consumesSlot`, Story 1.4, via AD-2's one predicate).
- **Story 2.1 (templates):** the `rebooking_nudge` template row (owner-scoped, `{client}`/`{slot}`/`{amount}` placeholders) + `resolveTemplate` — read it, never re-hardcode rebooking copy.
- **Story 2.2 (`compose` → `MessageDraft`):** call `compose(client, slot, amount, template)` exactly as-is; it returns the channel-agnostic draft. No transport, no send, no log here.
- **Story 3.1 (per-client link):** the client's signed per-client token URL is the link pre-filled into the draft (FR11). Consumes 1.1's `owner_id` + action contract and `Client.cadence` (Story 1.2 / Conventions).

Note the seam split: **Story 3.5** owns `derive.expectedNextDate`/`goneCold` (lapse detection); **this** story owns the forward *rebooking proposal*. They both live in `derive` and both key off cadence — keep the cadence-interval helper reusable, but do not build gone-cold here. **Story 3.4** wraps the post-completion nudge + conversion tracking around this action — do NOT build the nudge trigger or `MessageLog` tracking here. [Source: 1-2/1-4/1-7/2-1/2-2/3-1 …md]

### Architecture Compliance (invariants — quote-exact)

- **AR8 / AD-7 — Derived state computed on read (verbatim):** "A single `derive` module computes `expectedNextDate`, `goneCold`, `roomLeft` (via `consumesSlot`, AD-2), `dayMaxed`, all dashboard metrics, **and the §2 counter-metrics** … from canonical rows on every render… No stored derived flags, no cron, no background job." [Source: ARCHITECTURE-SPINE.md#AD-7] — *The rebooking-slot proposal (cadence interval → proposed slot; soonest-open for one-time) is a `derive` read: computed on tap from canonical rows, never a stored/cron'd forecast.*
- **AR8 (epics, verbatim):** "A single `derive` module computes `expectedNextDate`, `goneCold`, `roomLeft`, `dayMaxed`, all dashboard metrics, and §2 counter-metrics from canonical rows on every render. No stored derived flags, no cron, no background job." [Source: epics.md:105]
- **AD-5 / AR6 — Compose ≠ deliver (verbatim):** "`compose` turns `(client, slot, amount, template)` into a channel-agnostic `MessageDraft{ recipient, body, type }`. A `lib/delivery` **adapter** renders the draft to a `wa.me` / `sms:` deep-link in v1. Templates depend only on `MessageDraft`, never on the transport. Auto-send later = a new adapter, no template change. Dispatch is recorded **once, only on the operator's explicit send tap** (idempotent per draft — a re-tap does not double-log), never on render. `MessageLog` distinguishes `drafted_at` from `dispatched_at`; only `dispatched_at` feeds the nudge-fatigue counter (§2)." [Source: ARCHITECTURE-SPINE.md#AD-5] — *This story produces a `MessageDraft` and stops. No send, no dispatch log, no transport string. The tap-to-send + `drafted_at`/`dispatched_at` belong to Story 2.2/2.3/3.4.*
- **AD-2 — Capacity has one owner (context):** openness of a proposed slot is judged with the **same** `capacity.consumesSlot` predicate `roomLeft`/`dayMaxed` use — "Both `commitBooking` and `derive.roomLeft` call this one predicate." Never re-define consuming states to test proposability. [Source: ARCHITECTURE-SPINE.md#AD-2]
- **AD-9 — One clock (verbatim):** "Timestamps are stored in UTC; **all** capacity, cadence, and week arithmetic is computed in the operator's single local timezone." Cadence-interval math for the proposed slot is operator-local. [Source: ARCHITECTURE-SPINE.md#AD-9]
- **AD-1 — Server-first write path:** the rebooking-draft action is a Server Action; surfaces read via `derive` and never import `lib/db`. Typed return `{ok,data}|{ok:false,reason}` (AR15). [Source: ARCHITECTURE-SPINE.md#AD-1, #Consistency-Conventions (Errors)]
- **Messaging convention (verbatim):** "All outbound client comms are draft + tap-to-send (FR19); no autonomous send in v1." — *This action drafts only; it sends nothing.* [Source: ARCHITECTURE-SPINE.md#Consistency-Conventions (Messaging)]
- **AD-6 — Token is capability (context):** the per-client link pre-filled into the draft is Story 3.1's **signed, unguessable** per-client token, "scoped to one client." The draft carries that link; it grants exactly what the token scopes, nothing more. [Source: ARCHITECTURE-SPINE.md#AD-6]

### Scope boundaries (do NOT build here)

- No new capacity math and no new nearest-open algorithm — **reuse Story 1.7** (`derive` room-left/day-maxed/nearest-open) and Story 1.4 `consumesSlot`.
- No `compose`/`MessageDraft`/adapter changes — **call Story 2.2 as-is**; no new template — **use Story 2.1's `rebooking_nudge`**.
- **No send, no dispatch, no `MessageLog`, no `drafted_at`/`dispatched_at`, no nudge-fatigue counter** (Story 2.3 / 3.4). This story ends at a returned `MessageDraft`.
- No post-completion nudge trigger and no one-time→repeat **conversion tracking** (Story 3.4, FR12/FR13).
- No `expectedNextDate`/`goneCold` lapse detection (Story 3.5) and no win-back (Story 3.6).
- No actual booking mutation — proposing a slot is not committing it; `commitBooking` fires only when the client confirms the pre-filled link (Story 3.2).

### FR references [Source: epics.md]

- **FR10** — "Each completed/upcoming job exposes a one-tap rebooking action proposing the client's next open slot. Cadenced clients → slot at cadence interval; one-time clients → soonest open slot (this is the one-time→repeat conversion mechanism)." (epics.md:33)
- **FR11** — "The rebooking action composes a message pre-filled with the proposed slot + the client's per-client link, ready to send (FR20)." (epics.md:34)

### Open gaps flagged to developer

1. **Cadence source & interval units** — `proposeRebookSlot` needs the cadence interval as a concrete day-count. `Client.cadence` is the enum `weekly|biweekly|monthly` (Conventions), but the exact day mapping (biweekly = 14d; monthly = calendar-month vs 28/30d) and the **anchor** date (last `completed` job's `date`, or the tapped job's `date` when rebooking from an *upcoming* job) are unspecified. Dev picks a sensible operator-local mapping (align with Story 3.5's `expectedNextDate` interval so lapse and rebooking agree). Confirm.
2. **"Upcoming vs completed" trigger surface** — FR10 says the action lives on **both** completed and upcoming jobs, but where the one-tap control renders (job row in the ledger, the day view, a post-outcome prompt — the latter is Story 3.4's nudge) and which job date anchors the interval when rebooking from an upcoming job is unspecified. Dev decides the surface placement; keep the *proposal* logic surface-independent in `derive`.
3. **Where the per-client link lands in the template** — Story 2.1 sanctions only `{client}`/`{slot}`/`{amount}` tokens. FR11 needs the per-client link in the body. Dev decides: fold the link into the `{slot}` value string, or add a sanctioned `{link}` token to the resolver contract (Story 2.1) — do NOT invent an unstripped raw token (2.1 AC3: no `{token}` may leak). Flag if the template contract must grow.
4. **No-slot-in-window result** — AC3 forbids a *failure*, but if the bounded nearest-open scan window (Story 1.7's horizon) contains no open day at all, the action still must not throw. Dev decides the graceful degrade (typed `{ok:true, data:{slot:null}}` the surface renders as "no open slot in range," or widen the scan). Minimum bar: never error.
5. **`{amount}` for a rebooking draft** — `compose` takes an `amount`; the rebooking nudge may or may not quote a price. Dev decides the amount source (default job price from capacity config, Story 1.3) or an empty/blank amount (resolver blanks it safely, 2.1 AC3).

### References

- [Source: epics.md#Story-3-3] (epics.md:480–498); FR10, FR11 (epics.md:33–34, 134–135); AR8 (epics.md:105), AR6 (epics.md:103); Epic 3 intro (epics.md:436–438).
- [Source: ARCHITECTURE-SPINE.md] — AD-7 (derive on read), AD-5/AR6 (compose ≠ deliver), AD-2 (`consumesSlot` one owner), AD-9 (one clock), AD-1 (server-first), AD-6 (token is capability); Consistency-Conventions (Cadence enum, Messaging, Errors); Capability→Architecture Map (Rebooking + nudges → `compose`, `app/(operator)` actions; AD-5, AD-7).
- Reused stories: 1.4 (`commitBooking`/`consumesSlot`), 1.7 (`derive` room-left/day-maxed/nearest-open), 2.1 (`rebooking_nudge` template + `resolveTemplate`), 2.2 (`compose`→`MessageDraft`), 3.1 (per-client link).

## Dev Agent Record

### Agent Model Used

Claude Opus 4.8 (1M context) — `claude-opus-4-8[1m]`.

### Debug Log References

- `npx tsc --noEmit` → **0 errors** (clean).
- `npx vitest run tests/rebook.test.ts` → **10 passed** (10 tests, 1 file).
- `npx vitest run` (full suite) → **207 passed** across **22 files** (0 failures), incl. the new `tests/rebook.test.ts`.
- Docker Postgres already up; **no migration** — this story is pure derive + read-action + surface + tests (no schema change).

### Completion Notes List

Five locked dev decisions, as implemented:

1. **`derive.proposeRebookSlot` (pure, `lib/domain/derive.ts`).** Exports `CADENCE_INTERVAL_DAYS = { weekly:7, biweekly:14, monthly:28 }` and `type Cadence`. Cadenced: `target = addDaysToDate(anchorDate, CADENCE_INTERVAL_DAYS[cadence])`, `start = max(target, today)` (lexical = calendar for `YYYY-MM-DD`, so a past ideal never surfaces). One-time: `start = today`. Both route through a private `proposeFromStart(jobs, config, start)` that judges the start day's openness via **derive's own `weekCapacity(...).days` `open` flag** (working-day AND not day-maxed AND week-under-ceiling, already computed via `capacity.consumesSlot`) and falls back to **`nearestOpen(jobs, config, start)[0]`** (Story 1.7's forward scan, which starts the day AFTER `start`) — together covering "at/after start". No capacity math and no scan were re-implemented. Returns `{ slot: string | null }`; `null` only when the bounded window has no open day. **Never throws** (all inputs are pure/bounded) → AC3. *Note:* one-time includes `today` itself when open (soonest-open, the more correct product behavior), still via the same scan seam.

2. **Read action `getRebookProposal(jobId)` (`app/(operator)/jobs/actions.ts`).** Mirrors `getConfirmationDraft`: owner resolved fail-closed via `getOwnerId()` (`owner-unresolved`); `getJob` (→ `job-not-found`), `getClient` (→ `client-not-found`); config = `getCapacitySettings` or `DEFAULT_CAPACITY`; `today = localDateKey(new Date(), config.timezone)`; `jobs = listJobsFrom(ownerId, weekRangeOfDate(today).monday)` (same window the dashboard/booking-view use). Calls `proposeRebookSlot({ cadence: client.cadence, anchorDate: job.date, jobs, config, today })`. `slot === null` → `ok({ slot:null, draft:null })` (never an error, AC3). Else composes the owner's **`rebooking_nudge`** template (default body from `messageTemplateConfig` if unseeded) via unchanged `compose(client, formatDateKey(slot), config.defaultJobPriceCents, template)`. Typed AR15. Does NOT send / log dispatch / touch `MessageLog` / `drafted_at` / `dispatched_at`.

3. **Per-client link append (FR11).** `token = ensureClientToken(ownerId, client.id)` (Story 3.1's stable read-or-create link); `bookingUrl = ${APP_BASE_URL}/book/${encodeURIComponent(token)}`. Appended as `draft.body = ${draft.body}\n\n${bookingUrl}` — **compose/`resolveTemplate`/template contract UNCHANGED** (no `{link}`/`{token}` placeholder added, so no raw token can leak; Story 2.1 AC3 preserved). **`APP_BASE_URL`**: read from `process.env.APP_BASE_URL` (fallback `http://localhost:3000`); no base-url env existed, so `APP_BASE_URL=http://localhost:3000` was ADDED to both `.env` and `.env.example` (commented).

4. **Surface (`app/(operator)/jobs/page.tsx`, Task 4).** Zero-JS/dynamic (AD-13). Each **completed OR booked** row gets a GET `Rebook` link → `/jobs?rebook=<jobId>` (a derive READ, so GET is correct — no mutation). When `searchParams.rebook` is present, `<RebookPanel>` calls `getRebookProposal` and renders: the proposed slot (or "No open slot in range." when null; a small typed-reason error when the action fails), the composed draft body, and WhatsApp + SMS tap-to-send **plain anchors** via `deepLink(draft,'whatsapp')`/`deepLink(draft,'sms')` (like `/draft`, but anchors not form-POSTs — sending is the operator's explicit tap, **no dispatch recorded**). Surface reads only via the action; never imports `lib/db`.

5. **Tests (`tests/rebook.test.ts`, DB-backed, serial).** Fake-Date-to-fixed-Monday trick (`vi.useFakeTimers({ toFake:['Date'] })` + `vi.setSystemTime` in `beforeAll`, `vi.useRealTimers()` in `afterAll`), `process.env.APP_BASE_URL` set for the link assertion. Covers: weekly/biweekly/monthly → slot at interval past anchor; one-time → soonest open; past cadence target clamps to today; **day-maxed cadence target → nearest open ALTERNATIVE** (asserts it differs from the maxed target and does not throw); empty window → `{ slot:null }` (no throw); action returns a `rebooking_nudge` draft whose body contains the formatted slot AND `/book/<token>` link, carries only `{recipient,body,type}` (no `wa.me`/`sms:` key), and leaves `MessageLog` at **0 rows**; null-path (no workable day) → `ok({slot:null,draft:null})` with `MessageLog` still 0; unknown job id → typed `{ok:false,reason:'job-not-found'}`.

**Unsure / flagged:** (a) `CADENCE_INTERVAL_DAYS.monthly = 28` (a stable 4-week interval, NOT a calendar month) — chosen so Story 3.5's `expectedNextDate` lapse math can share the same constant; confirm this is the intended monthly semantics. (b) one-time proposal includes `today` itself when open (see note 1) rather than strictly the day-after — this is the "soonest open" reading of FR10; flag if a strictly-future slot is preferred.

### File List

- `lib/domain/derive.ts` — added `Cadence`, `CADENCE_INTERVAL_DAYS`, `proposeFromStart` (private), `ProposeRebookInput`, `proposeRebookSlot` (modified).
- `app/(operator)/jobs/actions.ts` — added `RebookProposal` interface + `getRebookProposal` read action; imports extended (modified).
- `app/(operator)/jobs/page.tsx` — added `RebookPanel`, `REBOOKABLE`, per-row `Rebook` link, `rebook` searchParam (modified).
- `.env` — added `APP_BASE_URL` (modified).
- `.env.example` — added `APP_BASE_URL` (modified).
- `tests/rebook.test.ts` — new DB-backed test suite (10 tests).

## Change Log

- **2026-07-16** — 3-layer adversarial code review (no HIGH). Applied 6 fixes: fail-closed `getRebookProposal` (P1), rebookable-state enforcement (P2), moved the per-client link mint off the GET render into a new `prepareRebook` POST action (P3, AD-1 no write-on-render), `APP_BASE_URL` prod hardening (P4), unmapped-cadence guard in `proposeRebookSlot` (P5), and 4 new tests (P6). Dismissed 2 (pre-existing client-name debrace; operator-facing raw reason). Confirmed 2 (monthly=28d; one-time includes today). Files: `app/(operator)/jobs/actions.ts`, `app/(operator)/jobs/page.tsx`, `lib/domain/derive.ts`, `lib/domain/lifecycleErrors.ts`, `tests/rebook.test.ts`, `.env.example`.
