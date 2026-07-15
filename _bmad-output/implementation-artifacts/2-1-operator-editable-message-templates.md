# Story 2.1: Operator-editable message templates

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As the operator,
I want editable message templates,
so that outbound texts sound like me and carry the right details.

## Acceptance Criteria

1. **Given** template settings, **When** I view them, **Then** four templates exist — booking confirmation, rebooking nudge, win-back check-in, payment reminder — as editable text with `{client}`/`{slot}`/`{amount}` placeholders (FR20). [Source: epics.md#story-2-1 AC1]
2. **Given** I edit a template, **When** I save, **Then** it persists per `owner_id` and later composes use it. [Source: epics.md#story-2-1 AC2]
3. **Given** a placeholder with no value, **When** composed, **Then** it resolves to empty/safe text, never a literal `{amount}` leak. [Source: epics.md#story-2-1 AC3]

## Tasks / Subtasks

- [ ] **Task 1 — `MessageTemplate` Drizzle schema keyed by `(owner_id, type)` (AC: 1, 2)** [Source: ARCHITECTURE-SPINE.md#AD-8, #AD-5, #Consistency-Conventions]
  - [ ] `MessageTemplate` table in `lib/db/` (Drizzle): `uuid` PK; `owner_id` FK (AD-8, present in every query from v1); `type` enum `booking_confirmation | rebooking_nudge | win_back | payment_reminder`; `body` text (the editable template string); `updated_at` UTC ISO-8601 (AD-9). Unique constraint on `(owner_id, type)` — exactly one template per type per owner (the four are a fixed, closed set, not user-addable).
  - [ ] Entity naming singular PascalCase (`MessageTemplate`), consistent with `Client`/`Job`/`MessageLog` (Consistency-Conventions: Naming).
  - [ ] Generate + apply migration.
- [ ] **Task 2 — Seed the four default templates (AC: 1)** [Source: ARCHITECTURE-SPINE.md#Structural-Seed, epics.md FR20]
  - [ ] Seed migration (or seed step riding the Operator-seed row, Story 1.1) inserts one row per `type` for the operator `owner_id`, each with sensible default copy containing the relevant `{client}`/`{slot}`/`{amount}` placeholders. The four types are exactly: booking confirmation, rebooking nudge, win-back check-in, payment reminder (FR20). Idempotent — re-running seed does not duplicate rows (rely on the `(owner_id, type)` unique constraint / upsert-on-conflict-do-nothing).
  - [ ] Default copy is a dev decision (see Open gaps) but MUST use only the three sanctioned placeholder tokens and read as the operator's own voice.
- [ ] **Task 3 — Placeholder-resolution helper (never leaks a `{token}`) (AC: 3)** [Source: ARCHITECTURE-SPINE.md#AD-5]
  - [ ] In `lib/domain/compose.ts` (co-located with `compose`, AD-5), export a pure `resolveTemplate(body, values)` helper: substitutes `{client}`, `{slot}`, `{amount}` with provided string values; a placeholder whose value is `undefined`/`null`/empty resolves to **empty/safe text**, never a literal `{amount}` (or any `{token}`) leak (AC3).
  - [ ] Recognize ONLY the three sanctioned tokens; any unknown `{foo}` token in a body is likewise stripped/blanked so no raw brace-token can ever reach a client. Whitespace-collapse after blanking is a dev decision (see Open gaps).
  - [ ] Pure function, no framework/db imports — `lib/domain` may not import a layer above it (dependency direction: surfaces → actions → domain → db). This helper is the seam 2.2's `compose` consumes.
- [ ] **Task 4 — View + edit templates surface + Server Action (AC: 1, 2)** [Source: ARCHITECTURE-SPINE.md#AD-1, #Consistency-Conventions (Errors)]
  - [ ] RSC settings surface under `app/(operator)/` (auth-gated, consistent with Story 1.3's capacity settings). Lists all four templates with their current `body` (defaults on first load), phone-first, minimal client JS, dynamic (no `use cache`). Surface never imports `lib/db` (AD-1).
  - [ ] Verb-first Server Action (e.g. `saveMessageTemplate`) in `app/(operator)/**/actions.ts` — the sole write path (AD-1). Scoped by `owner_id`; upserts the row for the given `type`. Typed return `{ ok, data } | { ok:false, reason }` (AR15); no thrown errors cross the action boundary.
  - [ ] On save, the template persists per `owner_id` and becomes the single source later composes read (Story 2.2's `compose` and Story 2.4's booking-confirmation both consume it — never re-hardcode message copy downstream).
- [ ] **Task 5 — Unit tests (AC: 1, 2, 3)**
  - [ ] Four types seeded; `(owner_id, type)` uniqueness enforced; edit persists and re-reads the new body scoped to `owner_id`.
  - [ ] `resolveTemplate`: all placeholders filled → fully substituted; missing/empty value → blank, no literal `{token}`; unknown `{token}` → stripped, never leaks; body with no placeholders → unchanged.

## Dev Notes

### Previous story intelligence

Reuses Story 1.1's `owner_id` seam + typed Server-Action contract and Story 1.3's settings-surface pattern (RSC view + edit under `app/(operator)/`, verb-first action, defaults-on-first-load) — mirror those, don't reinvent. **This is the first story of Epic 2 and the keystone of the compose→deliver spine:** it establishes the `MessageTemplate` data model + the `resolveTemplate` placeholder helper that Stories 2.2 (compose → `MessageDraft`), 2.4 (booking-confirmation), and the Epic 3/5 draft actions (FR11, FR18, FR31) all consume. Get the placeholder contract right — it is the only thing standing between the operator and a `{amount}` leaking to a client. [Source: 1-1/1-3 …md]

### Architecture Compliance (invariants — quote-exact)

- **AD-5 — Compose ≠ deliver (verbatim):** "`compose` turns `(client, slot, amount, template)` into a channel-agnostic `MessageDraft{ recipient, body, type }`. A `lib/delivery` **adapter** renders the draft to a `wa.me` / `sms:` deep-link in v1. Templates depend only on `MessageDraft`, never on the transport. Auto-send later = a new adapter, no template change. Dispatch is recorded **once, only on the operator's explicit send tap** (idempotent per draft — a re-tap does not double-log), never on render. `MessageLog` distinguishes `drafted_at` from `dispatched_at`; only `dispatched_at` feeds the nudge-fatigue counter (§2)." [Source: ARCHITECTURE-SPINE.md#AD-5] — *This story owns the `template` half of the compose input: templates are data, transport-agnostic; no `wa.me`/`sms:`/deep-link concern appears anywhere here (that is Story 2.2/2.3).*
- **AD-8 — Tenancy seam present (verbatim):** "Every Client, Job, PendingRequest, Inquiry, MessageLog, and token row carries an `owner_id` FK. The `owner_id` **filter is present in every query from v1** (value hardcoded to the single operator), not merely the column… **No** tenant-scoping UI and **no** multi-user auth in v1." [Source: ARCHITECTURE-SPINE.md#AD-8] — *`MessageTemplate` is a persisted row: it carries `owner_id` and every read/write filters on it. AC2's "persists per `owner_id`" is exactly this.*
- **AD-1 — Server-first write path (verbatim):** "Every mutation is a Server Action. No separate API tier; no client-side data store. Only `lib/db/` issues SQL; surfaces never import it directly." [Source: ARCHITECTURE-SPINE.md#AD-1]
- **AD-6 — Token is capability (context, verbatim):** "A bearer can do exactly what its token scopes — nothing more." [Source: ARCHITECTURE-SPINE.md#AD-6] — *Relevant because resolved template text is what ultimately reaches a token-bearing client; a placeholder leak would expose more than intended. Template editing itself is operator-session-only (no client path here).*
- **AR15 — typed return:** Server Actions return `{ ok, data } | { ok:false, reason }`; no thrown errors cross the action boundary, no silent catches. [Source: ARCHITECTURE-SPINE.md#Consistency-Conventions (Errors)]
- **Messaging convention (verbatim):** "All outbound client comms are draft + tap-to-send (FR19); no autonomous send in v1." [Source: ARCHITECTURE-SPINE.md#Consistency-Conventions (Messaging)] — *Nothing in this story sends; it only stores/edits templates and resolves placeholders.*
- **Simplicity gate (verbatim):** "no structure, column, or surface ships unless it serves a named leak or a capacity/cash decision." [Source: ARCHITECTURE-SPINE.md#Consistency-Conventions] — *Four fixed template types only; do not build a user-addable template system.*

### Data model

`MessageTemplate` (new, `lib/db/`):

| Field | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` PK | Surrogate PK (Consistency-Conventions: Ids). |
| `owner_id` | FK | AD-8; present in every query, hardcoded to operator in v1. |
| `type` | enum | `booking_confirmation \| rebooking_nudge \| win_back \| payment_reminder` — the four FR20 templates, a closed set. |
| `body` | text | Editable template string with `{client}`/`{slot}`/`{amount}` placeholders. |
| `updated_at` | timestamp | UTC ISO-8601 (AD-9). |

Unique `(owner_id, type)` — one template per type per owner. Sanctioned placeholder tokens (the ONLY three): `{client}`, `{slot}`, `{amount}`.

### Scope boundaries (do NOT build here)

No `compose` → `MessageDraft` construction (Story 2.2 — but DO build `resolveTemplate` here, which 2.2 calls). No `lib/delivery` adapter / `wa.me`/`sms:` deep-links (2.2). No `MessageLog`, `drafted_at`/`dispatched_at`, or dispatch/idempotency (2.3). No booking-confirmation wiring to a committed Job (2.4). No rebooking/win-back/payment-reminder draft *actions* (Epics 3/5) — this story only supplies the template rows + resolver they will consume. No user-addable/removable template types (Simplicity gate).

### FR references [Source: epics.md]

- **FR20** — Provide message templates: booking confirmation, rebooking nudge, win-back check-in, payment reminder. Operator-editable text with client/slot/amount placeholders. (epics.md:47)
- **FR19** (context) — draft + tap-to-send; no autonomous send in v1. This story sends nothing. (epics.md:46)
- **FR8/FR11/FR18/FR31** (downstream consumers) — booking-confirmation, rebooking, win-back, and payment-reminder drafts all reference FR20 templates; they are later stories. (epics.md:27,34,43,64)

### Open gaps flagged to developer

1. **Default template copy** — the exact default wording of the four seeded templates is unspecified. Dev writes concise, operator-voice defaults using only `{client}`/`{slot}`/`{amount}`. Not an invariant — just don't invent new tokens.
2. **`{slot}`/`{amount}` value formatting** — this story defines the *resolver contract* (substitute or blank), not how a date becomes a `{slot}` string or how integer cents (AR16) become a display `{amount}`. That formatting belongs to the caller (Story 2.2's `compose`, which owns `(client, slot, amount)`). `resolveTemplate` takes already-stringified values.
3. **Blank-collapse behavior** — whether a missing placeholder leaves a double space / dangling punctuation (e.g. `"$" + {amount}`) is a dev decision. Minimum bar: no literal `{token}` reaches output (AC3); reasonable whitespace tidy-up is encouraged but not mandated.
4. **Enum vs. lookup for `type`** — modeled as a Postgres enum here; a small reference table is an acceptable equivalent so long as the four types stay a closed, seeded set with `(owner_id, type)` uniqueness.

### References

- [Source: epics.md#Story-2-1] (epics.md:357–375); FR20 (epics.md:47); FR19 (epics.md:46); AR6 (epics.md:103), AR15.
- [Source: ARCHITECTURE-SPINE.md] — AD-5 (Compose ≠ deliver), AD-8 (tenancy seam), AD-1 (server-first write path), AD-6 (token is capability), AD-9 (one clock); Consistency-Conventions (Naming, Ids, Errors, Messaging, Simplicity gate); Structural Seed (`lib/domain/compose.ts`, `lib/db/`).

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
