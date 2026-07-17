---
baseline_commit: 86b5c39afd6f4d50df84e7180969d0fc75c46f0e
---

# Story 3.6: Win-back action

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As the operator,
I want a one-tap win-back for a cold regular,
so that reviving them is effortless.

## Acceptance Criteria

1. **Given** a gone-cold client, **When** I tap win-back, **Then** a check-in `MessageDraft` is composed via the win-back template, ready to send through Epic 2 (FR18). [Source: epics.md#story-3-6 AC1]
2. **Given** the win-back message, **When** I tap send, **Then** it dispatches and logs once via the messaging engine (FR18, AR6). [Source: epics.md#story-3-6 AC2]

## Tasks / Subtasks

- [x] **Task 1 — Win-back entry point on a gone-cold client (AC: 1)** [Source: ARCHITECTURE-SPINE.md#AD-7, #AD-1]
  - [x] Surface a one-tap win-back control on a client the operator sees flagged gone-cold. The gone-cold input is Story 3.5's **view-time** derivation (`derive.goneCold` / `expectedNextDate`) — read it, never re-derive lapse logic or store a flag here (AD-7). This story adds NO capacity, booking, or lapse-detection logic.
  - [x] The surface is a phone-first RSC control under `app/(operator)/`, minimal client JS, dynamic (no `use cache`, AD-7/AD-13); it never imports `lib/db` (AD-1). **DEV DECISION — win-back entry-point surface** (see Open gaps): the dashboard gone-cold list vs. the client-detail view; either is acceptable so long as it acts on a 3.5-derived gone-cold client. → **Chose the clients list** (`app/(operator)/clients/page.tsx`): gone-cold clients (derived via `listOwnerClientsWithLapse`) show a "Win back" link to `?winback=<id>`. No Epic 6 dashboard exists yet; the clients list is the natural client-detail-adjacent home.
- [x] **Task 2 — Compose the win-back `MessageDraft` via Story 2.2 `compose` (AC: 1)** [Source: ARCHITECTURE-SPINE.md#AD-5]
  - [x] Verb-first Server Action (e.g. `draftWinBack`) in `app/(operator)/**/actions.ts` (sole write path, AD-1). It calls Story 2.2's pure `compose(client, slot, amount, template)` with the **win-back template** (Story 2.1's `win_back` type) to produce a channel-agnostic `MessageDraft{ recipient, body, type: 'win-back' }`. A win-back is a check-in — there is no slot/amount to sell; pass empty/safe values so unfilled `{slot}`/`{amount}` placeholders blank out (Story 2.1 AC3), never a literal `{token}` leak. → Implemented as `getWinBackDraft(clientId)` composing with `slot=''`, `amount=null`; `draft.type === 'win_back'`.
  - [x] The draft is **compose-only, no autonomous send** (compose ≠ deliver): producing the draft dispatches nothing. Transport (`wa.me`/`sms:`) exists only in Story 2.2's `lib/delivery/deeplink.ts` adapter, never in this action or the template.
  - [x] Reuse the existing seam end-to-end: this story writes NO new `compose` logic, NO new template, and NO new delivery adapter — it is a caller of 2.1/2.2.
- [x] **Task 3 — Tap send → dispatch + log once via Story 2.3 (AC: 2)** [Source: ARCHITECTURE-SPINE.md#AD-5, #AD-1]
  - [x] On the operator's explicit send tap, route through Story 2.2's tap-to-send surface (opens the pre-filled WhatsApp/SMS deep-link) and Story 2.3's dispatch logging: `drafted_at` is set at compose time; `dispatched_at` is recorded **once per draft** on the send tap; a re-tap does NOT double-log (idempotent per draft, AD-5). The dispatched win-back feeds the nudge-fatigue counter (`MessageLog.dispatched_at` only, AD-7). → `sendWinBack` calls the shared `recordDispatch(clientId, 'win_back', winBackDispatchNonce(clientId))`.
  - [x] This story adds **NO new logging** — it reuses Story 2.3's `MessageLog` + idempotent `markDispatched`. Do not introduce a second dispatch path or a win-back-specific log table.
- [x] **Task 4 — Tests (AC: 1, 2)**
  - [x] Tapping win-back on a 3.5-derived gone-cold client composes a `MessageDraft` with `type: 'win-back'`, the win-back template body, and no transport key (assert no `url`/`wa.me`/`sms:` substring). Unfilled `{slot}`/`{amount}` blank out — no literal `{token}` reaches output.
  - [x] Composing does not dispatch (no `dispatched_at`, no autonomous send). Send tap sets `dispatched_at` once; a re-tap does not produce a second dispatch (reuses 2.3's idempotency). Assert the win-back reuses the existing `compose`/adapter/`MessageLog` seam (no new module). → `tests/win-back.test.ts`, 9 tests.

## Dev Notes

### Previous story intelligence

Win-back is a **pure consumer of the Epic 2 messaging spine** and the **closing story of Epic 3** — it wires Story 3.5 → Stories 2.1/2.2/2.3, adding no new spine. Consumes **Story 3.5**'s gone-cold / expected-next-date **view-time** derivation as its input (a gone-cold client); rely on 3.5's `derive` output, do not re-implement lapse logic. Calls **Story 2.2**'s pure `compose(client, slot, amount, template)` with **Story 2.1**'s `win_back` template to produce the `MessageDraft`; the operator's send tap rides **Story 2.2**'s deep-link adapter and **Story 2.3**'s idempotent dispatch logging. Reuses **Story 1.1**'s `owner_id` seam + typed Server-Action contract. This is the same seam Story 3.3 (rebooking draft) already calls — mirror it; the only differences are the template kind (`win_back`) and the input (gone-cold client, not a completed/upcoming job). Get nothing new: a leak of transport or a bespoke log path here would fork the spine Epic 2 exists to own. [Source: 3-5/2-1/2-2/2-3/1-1 …md]

### Architecture Compliance (invariants — quote-exact)

- **AD-5 — Compose ≠ deliver (verbatim):** "`compose` turns `(client, slot, amount, template)` into a channel-agnostic `MessageDraft{ recipient, body, type }`. A `lib/delivery` **adapter** renders the draft to a `wa.me` / `sms:` deep-link in v1. Templates depend only on `MessageDraft`, never on the transport. Auto-send later = a new adapter, no template change. Dispatch is recorded **once, only on the operator's explicit send tap** (idempotent per draft — a re-tap does not double-log), never on render. `MessageLog` distinguishes `drafted_at` from `dispatched_at`; only `dispatched_at` feeds the nudge-fatigue counter (§2)." [Source: ARCHITECTURE-SPINE.md#AD-5]
- **AR6 — dispatch-once via the messaging engine (verbatim, AC2):** "Dispatch recorded ONCE on the operator's explicit send tap (idempotent per draft); `MessageLog` distinguishes `drafted_at` from `dispatched_at`; only `dispatched_at` feeds nudge-fatigue." The win-back send reuses this — one tap, one `dispatched_at`, re-tap is a no-op. [Source: epics.md:103; ARCHITECTURE-SPINE.md#AD-5]
- **No autonomous send (Consistency Conventions, verbatim):** "All outbound client comms are draft + tap-to-send (FR19); no autonomous send in v1." Composing the win-back draft sends nothing; only the operator's tap dispatches. [Source: ARCHITECTURE-SPINE.md#Consistency-Conventions Messaging]
- **AD-7 — Derived state computed on read (verbatim):** "`goneCold` is a view-time computation surfaced when the operator opens the dashboard." The win-back's gone-cold input comes from this derivation — no stored flag, no cron. [Source: ARCHITECTURE-SPINE.md#AD-7]
- **AD-1 / AR15 — sole write path:** the draft + send actions are Server Actions returning typed `{ok,data}|{ok:false,reason}`; only `lib/db` speaks SQL; surfaces never import it; no thrown errors cross the action boundary. [Source: ARCHITECTURE-SPINE.md#AD-1, #Consistency-Conventions]
- **AD-8 — tenancy seam:** every `MessageLog` row (written by 2.3) carries `owner_id`; the filter is present in every query from v1. [Source: ARCHITECTURE-SPINE.md#AD-8]

### What this story wires (not builds)

| Concern | Owned by | This story |
| --- | --- | --- |
| Gone-cold / expected-next-date derivation | Story 3.5 (`derive`, AD-7) | reads it (input) |
| `win_back` template (editable, placeholders) | Story 2.1 (`MessageTemplate`) | selects it |
| `compose` → `MessageDraft` | Story 2.2 (`lib/domain/compose.ts`) | calls it |
| `wa.me`/`sms:` deep-link | Story 2.2 (`lib/delivery/deeplink.ts`) | reuses it |
| `drafted_at`/`dispatched_at`, idempotent dispatch, nudge-fatigue | Story 2.3 (`MessageLog`, `derive`) | reuses it |
| Win-back entry point + `draftWinBack` action | **this story** | builds (thin caller) |

### Scope boundaries (do NOT build here)

NO new capacity/booking logic (win-back is a check-in message, not a booking — it commits no Job; contrast Story 3.3's rebooking which proposes a slot). NO new lapse-detection or gone-cold derivation (Story 3.5). NO new `compose`, `MessageDraft` shape, template, or `lib/delivery` adapter (Stories 2.1/2.2). NO new `MessageLog`, dispatch, or idempotency mechanism (Story 2.3). NO autonomous send (FR19). NO nudge-fatigue UI (Epic 6). Build ONLY: the win-back entry-point control on a gone-cold client and the thin `draftWinBack` Server Action that calls the existing spine.

### FR references [Source: epics.md]

- **FR18** — Win-back action: one-tap check-in message to a gone-cold client, composed from the win-back template and sent via the Epic 2 messaging engine (draft + tap-to-send). (epics.md:43)
- **FR19** (context) — all outbound client comms are draft + tap-to-send; nothing sends autonomously in v1. (epics.md:46)
- **AR6** — dispatch recorded once on the operator's explicit send tap (idempotent per draft); `drafted_at` vs `dispatched_at`; only `dispatched_at` feeds nudge-fatigue. (epics.md:103)

### Open gaps flagged to developer

1. **Win-back entry-point surface (dev decision)** — whether the one-tap win-back lives on the dashboard gone-cold list vs. the client-detail view is unspecified. Either is acceptable; the only invariant is that it acts on a Story-3.5-derived gone-cold client and routes through the Epic 2 seam. Pick one, record it.
2. **`{slot}`/`{amount}` for a check-in** — a win-back sells no specific slot or price, so those placeholders have no value. Per Story 2.1 AC3 they must blank out safely (never a literal `{token}`). Whether the default `win_back` copy even references them is a Story 2.1 copy decision, not this story's — but if it does, this story must pass empty/safe values.
3. **`resulting_job_ref` attribution** — a win-back that later leads to a booking could feed conversion (FR13); populating `MessageLog.resulting_job_ref` for win-backs is out of scope here (the column exists per Story 2.3; wiring is deferred to the conversion-metric work).

### References

- [Source: epics.md#Story-3-6] (epics.md:536–550); FR18 (epics.md:43); FR19 (epics.md:46); AR6 (epics.md:103); Epic 3 intro (epics.md:436–438); Story 3.5 gone-cold derivation (epics.md:516–534).
- [Source: ARCHITECTURE-SPINE.md] — AD-5 (Compose ≠ deliver: `MessageDraft`, dispatch-once, no autonomous send), AD-7 (derive-on-read: `goneCold` view-time), AD-1/AR15 (sole write path), AD-8 (tenancy seam); Consistency-Conventions (Messaging: draft + tap-to-send, no autonomous send); Source tree (`lib/domain/compose.ts`, `lib/delivery/deeplink.ts`, `app/(operator)`).
- [Source: 2-1/2-2/2-3 …md] — `win_back` template + `resolveTemplate`; `compose`/`MessageDraft`/deep-link adapter; `MessageLog` `drafted_at`/`dispatched_at` idempotent dispatch. [Source: 3-5 …md] — gone-cold / expected-next-date view-time derivation.

## Dev Agent Record

### Agent Model Used

claude-opus-4-8 (1M context) — bmad-dev-story workflow, 2026-07-17.

### Debug Log References

- `npx vitest run tests/win-back.test.ts` → 9/9 pass.
- `npx tsc --noEmit` → clean.
- `npx vitest run` (full regression) → 25 files, 243/243 pass (234 prior + 9 win-back).

### Completion Notes List

Closing story of Epic 3 — a thin CONSUMER wiring Story 3.5 → Stories 2.1/2.2/2.3. Added NO new spine (no compose/template/adapter/log). Files:

- **`lib/domain/compose.ts`** — added `winBackDispatchNonce(clientId)` = `winback:<clientId>` (keyed on client, not a job — a win-back has no anchor). Mirrors `rebookingDispatchNonce`.
- **`app/(operator)/clients/actions.ts`** — added `ClientRow` (Client + derived `goneCold`), `listOwnerClientsWithLapse()` (annotates each client with `derive.goneCold` computed in the action layer over canonical rows, AD-7), `getWinBackDraft(clientId)` (AC1: gone-cold gate + `compose('win_back', slot='', amount=null)`), `sendWinBack(formData)` (AC2: re-derive gate → `deepLink` → shared `recordDispatch` → redirect).
- **`app/(operator)/clients/page.tsx`** — gone-cold clients show a highlighted "Win back" link → `?winback=<id>` renders `WinBackPanel` (composed draft + WhatsApp/SMS zero-JS send forms, mirrors the jobs `RebookPanel`). The stored `active/provisional` label is overridden by the derived `gone-cold` badge.
- **`lib/domain/clientErrors.ts`** — added win-back reason messages (`not-gone-cold`, `no-phone`, `win-back-failed`, dispatch reasons).
- **`tests/win-back.test.ts`** — 9 DB-backed tests (mirror `rebook.test.ts`).

**Dev decisions:**
1. **Entry point (Open gap 1):** the clients list (`clients/page.tsx`). No Epic 6 dashboard exists; the clients list is the natural home and acts strictly on a 3.5-derived gone-cold client.
2. **`{slot}`/`{amount}` (Open gap 2):** a check-in sells nothing → `compose` gets `slot=''`, `amount=null`; `resolveTemplate` blanks the tokens (2.1 AC3). A test with a custom `{slot}`/`{amount}` template asserts no residual braces. NO booking link appended (contrast 3.3's FR11 rebooking).
3. **`resulting_job_ref` attribution (Open gap 3):** out of scope — deferred to the conversion-metric work.

**Security / correctness:** `sendWinBack` re-derives gone-cold server-side via `getWinBackDraft` (the UI button is cosmetic) — a hand-typed `?winback=<activeClientId>` fails `not-gone-cold`, never dispatches. Deep link is built BEFORE `recordDispatch` (Story 2.3 P1 — no phantom dispatch): a phoneless tap returns `no-phone` and stamps nothing. Re-tap is idempotent (one `win_back` MessageLog row, `dispatched_at` stamped once) via the `winback:<clientId>` nonce.

**Scope honored:** built ONLY the entry point + `getWinBackDraft`/`sendWinBack` callers. No new capacity/booking/lapse logic, no new compose/template/adapter/MessageLog, no autonomous send (FR19), no nudge-fatigue UI (Epic 6).

### File List

- `lib/domain/compose.ts` — added `winBackDispatchNonce` (additive).
- `app/(operator)/clients/actions.ts` — added `ClientRow`, `listOwnerClientsWithLapse`, `getWinBackDraft`, `sendWinBack` + widened query/import list (additive).
- `app/(operator)/clients/page.tsx` — gone-cold flag + "Win back" control + `WinBackPanel`.
- `lib/domain/clientErrors.ts` — added win-back reason messages (additive).
- `tests/win-back.test.ts` — new: 9 win-back tests.

## Change Log

- 2026-07-17 — Story 3.6 implemented: win-back action (FR18) — `getWinBackDraft` + `sendWinBack` on the clients surface, wiring Story 3.5 gone-cold → 2.1/2.2 compose → 2.3 idempotent dispatch; gone-cold flag + Win-back control on the clients list. 9 new tests, full suite 243/243 green, tsc clean. Closes Epic 3. Status → review.
