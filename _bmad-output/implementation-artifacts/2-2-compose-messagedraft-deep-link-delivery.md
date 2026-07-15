# Story 2.2: Compose → MessageDraft → deep-link delivery

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As the operator,
I want a one-tap draft that opens my WhatsApp/SMS pre-filled,
so that I send without retyping.

## Acceptance Criteria

1. **Given** `(client, slot, amount, template)`, **When** I request a draft, **Then** `compose` returns a channel-agnostic `MessageDraft{recipient, body, type}` with no transport details inside (AR6/AD-5). [Source: epics.md#story-2-2 AC1]
2. **Given** a `MessageDraft`, **When** I tap send, **Then** the `lib/delivery` adapter renders it to a `wa.me`/`sms:` deep-link and my phone opens the message pre-filled (FR19). [Source: epics.md#story-2-2 AC2]
3. **Given** v1, **When** any message is prepared, **Then** nothing sends autonomously — the operator's tap is required (FR19). [Source: epics.md#story-2-2 AC3]

## Tasks / Subtasks

- [ ] **Task 1 — `MessageDraft` shape + `compose()` in `lib/domain/compose.ts` (AC: 1)** [Source: ARCHITECTURE-SPINE.md#AD-5, #Design-Paradigm]
  - [ ] Define `MessageDraft{ recipient, body, type }` — a plain domain value. `recipient` = the client's phone (raw, un-normalized string as stored on `Client`); `body` = the resolved template text; `type` = the message kind (`booking-confirmation|rebooking-nudge|win-back|payment-reminder`), NOT a transport channel. **No `url`, no `wa.me`, no `sms:`, no channel field** lives on the draft (AD-5).
  - [ ] `compose(client, slot, amount, template)` is PURE and transport-agnostic: it consumes Story 2.1's persisted template + placeholder resolution to produce `body`, sets `recipient` from `client`, and stamps `type`. No framework imports; no `lib/delivery` import; no DB write; no deep-link string anywhere in this module.
  - [ ] Placeholder resolution reuses 2.1's contract: `{client}`/`{slot}`/`{amount}` fill from the args; a missing value resolves to empty/safe text, never a literal `{amount}` leak (2.1 AC3). `amount` renders as integer-cents → USD per Conventions.
- [ ] **Task 2 — `lib/delivery/deeplink.ts` adapter — the ONLY transport (AC: 2)** [Source: ARCHITECTURE-SPINE.md#AD-5, #Source-tree]
  - [ ] In `lib/delivery/deeplink.ts`: a v1 adapter that takes a `MessageDraft` and renders a deep-link URL. This is the **only** module in the codebase where `wa.me` / `sms:` (transport) exists (AD-5). Templates and `compose` never reference it.
  - [ ] Build the URL from `recipient` + URL-encoded `body`: WhatsApp `https://wa.me/<phone>?text=<encoded body>`; SMS `sms:<phone>?&body=<encoded body>` (or `sms:<phone>&body=…` — platform-encoding is a flagged gap, see Open gaps). Phone-number normalization to the `wa.me` E.164-digits form happens HERE, not in `compose` (see Open gaps).
  - [ ] The adapter only **renders** a link; it does not open, send, or log anything. Auto-send later = a new adapter beside this one, with zero template/compose change (AD-5, Deferred).
- [ ] **Task 3 — Tap-to-send surface (AC: 2, 3)** [Source: ARCHITECTURE-SPINE.md#AD-1, #Consistency-Conventions Messaging]
  - [ ] Operator surface renders the drafted `body` (review/preview) and a send control that navigates to the adapter's deep-link on the operator's explicit tap — the OS then opens WhatsApp/SMS pre-filled. The tap is required; nothing fires on render or on draft creation (AD-5, no-autonomous-send).
  - [ ] No dispatch logging here — `drafted_at`/`dispatched_at` are Story 2.3's job; this story renders + opens only. (Scope boundary below.)
- [ ] **Task 4 — Unit tests (AC: 1, 2, 3)**
  - [ ] `compose` returns exactly `{recipient, body, type}` with NO transport key; snapshot the object to assert no `url`/`wa.me`/`sms:` substring appears in any field. Placeholder fill + missing-value → empty (no `{amount}` leak). Purity: same inputs → same draft, no side effects.
  - [ ] Adapter renders correct `wa.me`/`sms:` URLs with URL-encoded body; phone normalization cases. A `MessageDraft` fixture round-trips to a link WITHOUT the draft itself carrying the link.
  - [ ] No-autonomous-send: assert no send/dispatch occurs without an explicit tap (render produces a link but does not follow it).

## Dev Notes

### Previous story intelligence

Consumes **Story 2.1** directly: the four persisted, `owner_id`-scoped editable templates and the `{client}`/`{slot}`/`{amount}` placeholder-resolution contract (missing value → empty/safe text). `compose` is the caller of that resolution — read 2.1's template store, never re-hardcode template text. This is the **architectural keystone of Epic 2**: the compose→deliver seam built here is reused by every downstream drafting path. **Story 2.3** wraps `drafted_at`/`dispatched_at` (a `MessageLog`) around this seam — do NOT build logging here. **Story 2.4** is the first real caller (booking-confirmation draft on commit). Epics 3 (rebooking/win-back) and 5 (payment reminders) reuse the identical seam. Get the seam clean: a leak of transport into `compose` or the draft forces a rewrite of every later template. [Source: epics.md#Epic-2 (epics.md:353–435); 2-1 …md]

### Architecture Compliance (invariants — quote-exact)

- **AD-5 — Compose ≠ deliver (verbatim):** "`compose` turns `(client, slot, amount, template)` into a channel-agnostic `MessageDraft{ recipient, body, type }`. A `lib/delivery` **adapter** renders the draft to a `wa.me` / `sms:` deep-link in v1. Templates depend only on `MessageDraft`, never on the transport. Auto-send later = a new adapter, no template change. Dispatch is recorded **once, only on the operator's explicit send tap** (idempotent per draft — a re-tap does not double-log), never on render. `MessageLog` distinguishes `drafted_at` from `dispatched_at`; only `dispatched_at` feeds the nudge-fatigue counter (§2)." [Source: ARCHITECTURE-SPINE.md#AD-5]
  - Binds: FR11, FR13, FR18, FR19, FR20, FR21, FR31. Prevents: "transport details leaking into templates; a future auto-send transport forcing a template rewrite; one tap logging two dispatches; phantom dispatches on unsent drafts." [Source: ARCHITECTURE-SPINE.md#AD-5]
- **AR6 — channel-agnostic draft (AC1):** the draft is `{recipient, body, type}` with **no transport details inside**; transport exists only in the `lib/delivery` adapter. [Source: epics.md#story-2-2 AC1; ARCHITECTURE-SPINE.md#AD-5]
- **AD-6 — Token is capability (context, not built here):** clients have no login and no app; delivery is the **operator's** own WhatsApp/SMS opening pre-filled on the operator's device (verbatim): "The operator is a single authenticated session (FR33)… No client login (FR34). A bearer can do exactly what its token scopes — nothing more." The deep-link opens on the operator's phone — this story sends nothing to a client channel directly. [Source: ARCHITECTURE-SPINE.md#AD-6]
- **No autonomous send (Consistency Conventions, verbatim):** "All outbound client comms are draft + tap-to-send (FR19); no autonomous send in v1." [Source: ARCHITECTURE-SPINE.md#Consistency-Conventions Messaging]
- **Layering (verbatim):** Domain = `lib/domain/` "`compose` — pure logic, no framework imports"; Delivery = `lib/delivery/` "Channel adapters (v1: deep-link)". Dependency direction: domain may not import delivery-above; `compose` does not import `lib/delivery`. [Source: ARCHITECTURE-SPINE.md#Design-Paradigm]

### Scope boundaries (do NOT build here)

No `MessageLog` table, no `drafted_at`/`dispatched_at`, no idempotent dispatch logging, no nudge-fatigue counter (all **Story 2.3**). No booking-confirmation trigger-on-commit wiring (**Story 2.4**). No template CRUD/settings UI (**Story 2.1** — this story only reads them). No autonomous-send adapter (Deferred). No rebooking/win-back/payment-reminder callers (Epics 3, 5). Build ONLY: `MessageDraft` shape, pure `compose()`, the `lib/delivery/deeplink.ts` render adapter, and a tap-to-send surface that opens the link.

### FR references [Source: epics.md]

- **FR19** — all outbound client comms are draft + tap-to-send; the operator's explicit tap opens the pre-filled message; nothing sends autonomously in v1.
- **FR20** — templates carry `{client}`/`{slot}`/`{amount}` placeholders (owned by 2.1; consumed here).

### Open gaps flagged to developer

1. **Phone-number normalization** — `wa.me` requires digits-only E.164 (no `+`, spaces, or dashes); `sms:` tolerates more but benefits from a canonical form. `Client.phone` is stored raw (2.1/Epic 1) with no guaranteed format. Dev decides the normalization rule (strip non-digits, prepend country code?) and where a missing/invalid number degrades gracefully. Normalization lives in the adapter (Task 2), never in `compose`.
2. **`sms:` deep-link URL format** — RFC 3966 `sms:<number>?body=…` vs the widely-compatible `sms:<number>&body=…` (and `?&body=` on some iOS versions) differ by platform. Dev picks the encoding; `wa.me/<digits>?text=<encoded>` is stable. Both bodies must be `encodeURIComponent`-escaped.
3. **Channel selection (`wa.me` vs `sms:`)** — AC2 says "WhatsApp/SMS" but does not specify how the operator chooses per-send (a toggle? an operator default? per-client preference?). `MessageDraft.type` is the message KIND, not the channel — so channel choice is an adapter/surface decision, unspecified. Dev decides; keep the choice out of `compose` and out of the draft (AD-5).
4. **`recipient` identity** — whether `recipient` carries the phone string or a `Client` reference/id is unspecified; AD-5 says `{recipient, body, type}`. Keep it transport-agnostic (a phone string is fine); normalization still happens in the adapter, not on the draft.

### References

- [Source: epics.md#Story-2-2] (epics.md:377–395); FR19, FR20 (epics.md); Epic 2 intro (epics.md:353–355).
- [Source: ARCHITECTURE-SPINE.md] — AD-5 (Compose ≠ deliver), AD-6 (token is capability); Design Paradigm (layer table, dependency direction); Consistency Conventions (Naming: `compose` domain module; Messaging: draft + tap-to-send, no autonomous send); Source tree (`lib/domain/compose.ts`, `lib/delivery/deeplink.ts`); Deferred (autonomous sending = new adapter).

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
