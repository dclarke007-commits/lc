---
baseline_commit: e10b73a32ab47af9a47bcd91ec19e5f3297afbb2
---
# Story 1.2: Create & edit client records

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As the operator,
I want to add and edit clients directly,
so that I can seed my existing regulars and add a caller on the spot.

## Acceptance Criteria

1. **Given** the client form, **When** I save name, phone, address, and cadence (`weekly|biweekly|monthly|one-time`), **Then** a `Client` row is written with my `owner_id` and `status=active` (FR38, FR14, FR15). [Source: epics.md#story-1-2 AC1]
2. **Given** an existing client, **When** I edit any field, **Then** the record updates, **And** every client query is `owner_id`-filtered from day one (AR9/AD-8). [Source: epics.md#story-1-2 AC2]
3. **Given** a missing phone or name, **When** I save, **Then** the Server Action returns `{ok:false, reason}` and nothing is written (AR15). [Source: epics.md#story-1-2 AC3]

## Tasks / Subtasks

- [x] **Task 1 — Define the `Client` Drizzle schema (AC: 1, 2)** [Source: ARCHITECTURE-SPINE.md#Consistency-Conventions, #Structural-Seed, #AD-8, #AD-9]
  - [x] Add `Client` table in `lib/db/` (schema lives ONLY here — AD-1/AR2). Entity name singular PascalCase `Client`.
  - [x] Columns: surrogate `uuid` PK; `owner_id` FK → Operator (AD-8); `name`, `phone`, `address`; `cadence` enum `weekly|biweekly|monthly|one-time` (FR15); `status` enum `active|provisional|gone-cold` — store `active`/`provisional` only, **`gone-cold` is derived, never stored** (AD-7).
  - [x] If adding `created_at`/`updated_at`, store UTC ISO-8601 (AD-9). (Timestamps on Client are NOT mandated by the spine — see Open gaps.)
  - [x] Do NOT add a Client-level payment column or `expectedNextDate`/`goneCold` column (see Scope boundaries + Open gaps).
  - [x] Generate + apply the Drizzle migration.
- [x] **Task 2 — `createClient` Server Action (AC: 1, 3)** [Source: ARCHITECTURE-SPINE.md#AD-1, #Consistency-Conventions (Errors, Naming)]
  - [x] Verb-first action in `app/(operator)/**/actions.ts` (sole write path — AD-1; client CRUD is NOT capacity-consuming, so it does NOT route through `commitBooking`).
  - [x] Validate name + phone present; on failure return `{ok:false, reason}` and write nothing (AC3/AR15). No thrown errors cross the boundary; no silent catches.
  - [x] Insert `Client` with `owner_id` = the hardcoded operator value (from the Story 1.1 seed/session), `status=active`. Return `{ok, data}`.
- [x] **Task 3 — `editClient` Server Action (AC: 2, 3)** [Source: ARCHITECTURE-SPINE.md#AD-1, #AD-8]
  - [x] Verb-first update action; same typed return contract; same name/phone validation.
  - [x] UPDATE scoped by `owner_id` AND row id — never update a row outside the operator's `owner_id`.
- [x] **Task 4 — `owner_id`-filtered reads (AC: 2)** [Source: ARCHITECTURE-SPINE.md#AD-8]
  - [x] Every Client SELECT carries `WHERE owner_id = <operator>` from day one — the value, not merely the column. Reuse the `owner_id` helper/pattern established in Story 1.1 (do not reinvent).
- [x] **Task 5 — Client form + list surface (AC: 1, 2)** [Source: ARCHITECTURE-SPINE.md#AD-1, #AD-13, NFR1]
  - [x] RSC surface under `app/(operator)/` (auth-gated by `proxy.ts` from Story 1.1). Create + edit form; phone-first, minimal client JS, dynamic (no `use cache`).
  - [x] Cadence rendered as a fixed 4-option select (`weekly|biweekly|monthly|one-time`).
  - [x] Surfaces never import `lib/db` directly — go through actions (dependency direction: surfaces → actions → domain → db).
- [x] **Task 6 — Tests (AC: 1, 2, 3)** [Source: ARCHITECTURE-SPINE.md#Consistency-Conventions]
  - [x] Create writes a `Client` with `owner_id` + `status=active`; edit updates; both actions return the typed shape.
  - [x] Missing name or phone → `{ok:false, reason}`, nothing written.
  - [x] A Client read is `owner_id`-filtered (a row under a different owner_id is not returned).

## Dev Notes

### Previous story intelligence (Story 1.1 — substrate)

Story 1.1 (auth shell + operator seed) is the direct dependency and is `ready-for-dev` (not yet implemented). It establishes what 1.2 consumes: the one-row Operator seed → the hardcoded `owner_id` value; the Next.js 16 + Drizzle/Postgres wiring; `proxy.ts` gating `(operator)` routes; and the Server Action return contract + `owner_id` filter helper. **Reuse those patterns — do not re-establish auth, DB wiring, or a second owner_id mechanism.** If 1.1 named the owner_id helper/session accessor, use it verbatim. [Source: 1-1-authenticated-shell-operator-seed.md]

### Technical Requirements (locked)

- **Stack:** as Story 1.1 — Next.js 16.x App Router + Server Actions + RSC, React 19.x, TypeScript 5.x, Drizzle ORM, managed Postgres 16+ (transaction-mode pooling), Vercel. [Source: ARCHITECTURE-SPINE.md#Stack]
- **Client CRUD is ordinary Server Actions** in `app/(operator)/**/actions.ts` — NOT capacity-consuming, so it must NOT call `commitBooking` (that's booking, Story 1.4). [Source: ARCHITECTURE-SPINE.md#AD-1, #Consistency-Conventions (Mutation)]

### Architecture Compliance (invariants)

- **AD-1 — Server-first write path:** every mutation is a Server Action; only `lib/db/` speaks SQL; surfaces never import it. [Source: ARCHITECTURE-SPINE.md#AD-1]
- **AD-8 — Tenancy seam:** `owner_id` FK on `Client`; `owner_id` filter present in EVERY create/edit/read from v1 (value hardcoded to the single operator). Prevents a future cross-tenant leak + schema-rewrite. No tenant UI. [Source: ARCHITECTURE-SPINE.md#AD-8]
- **AD-7 — Derived state computed on read:** Client stores raw `cadence` only. `expectedNextDate`, `goneCold`/`gone-cold` status are computed by `lib/domain/derive.ts` at read time — NEVER stored as columns or flags. No cron/background job. (The derivations themselves belong to Epic 3 — do not build them here, just don't block them by storing flags.) [Source: ARCHITECTURE-SPINE.md#AD-7]
- **AD-9 — One clock:** any Client timestamps stored UTC ISO-8601; cadence date math runs operator-local at read time. [Source: ARCHITECTURE-SPINE.md#AD-9]
- **AR15 — Action contract:** typed `{ok, data} | {ok:false, reason}`; no thrown errors cross the boundary; errors → Vercel platform logs. [Source: ARCHITECTURE-SPINE.md#Consistency-Conventions]
- **NFR7 — Simplicity gate:** no column or surface ships unless it serves a named leak or capacity/cash decision. Do NOT add email/notes/tags or extra fields. [Source: ARCHITECTURE-SPINE.md#Consistency-Conventions]
- **NFR1 — Phone-first;** **NFR6 — client PII** (name/phone/address) protected in transit (Vercel HTTPS) and at rest (managed Postgres). [Source: epics.md#nfrs]

### Scope boundaries (do NOT build here)

- **No payment field on Client.** FR14 lists "payment status" as part of the full client record, but the architecture models payment as `Job.payment: paid|owed`, gated by lifecycle (AD-10), and populated in Epic 5 (Cash Ledger). Story 1.2 AC-1 captures only **name, phone, address, cadence**. Do not add a Client-level payment column. [Source: ARCHITECTURE-SPINE.md#Consistency-Conventions (Cadence-status), #AD-10]
- **No booking history storage.** "Booking history" (FR14) is the relational `Client ||--o{ Job` link — populated by booking (Story 1.4), not entered on this form.
- No cadence-driven scheduling, capacity, lifecycle, or gone-cold logic (Stories 1.3–1.7, Epic 3).

### Data model reference [Source: ARCHITECTURE-SPINE.md#Structural-Seed, #Consistency-Conventions]

- Entities singular PascalCase; ids surrogate `uuid` PK; every row carries `owner_id`.
- Enums (verbatim): `cadence: weekly|biweekly|monthly|one-time`; `Client.status: active|provisional|gone-cold` (gone-cold derived, AD-7).
- ER: `OPERATOR ||--o{ CLIENT : owns`; `CLIENT ||--o{ JOB : has`; `CLIENT ||--o{ MESSAGELOG : receives`; `CLIENT ||--o| TOKEN : per-client link` (Token built later).
- Required on create: `name`, `phone` (AC-3). Address/cadence not called out as blocking.

### Testing Standards

Framework as chosen in Story 1.1 (architecture mandates none). Assert: typed action return shape, owner_id filtering, required-field rejection with nothing written. Do not over-scope coverage (NFR7). [Source: ARCHITECTURE-SPINE.md#Consistency-Conventions]

### Open gaps flagged to developer

1. Exact Client column names/types/nullability (name/phone/address) — dev decision.
2. Whether Client carries `created_at`/`updated_at` — spine names only Job/MessageLog timestamps; decide, store UTC if added.
3. Phone/name uniqueness or format validation rules — spine gives none; keep minimal, must still return `{ok:false, reason}` on invalid.
4. Exact verb-first action names (`createClient`/`editClient` suggested) — convention given, names not.
5. `active` vs `provisional` transition logic — only `gone-cold` is defined (derived); `provisional` is set by public self-booking (Epic 4), so 1.2 creates operator-added clients as `active`.

### Requirements traceability

- **FR38** — operator create/edit client directly (name, phone, address, cadence), no booking link. [Source: epics.md#fr-38]
- **FR14** — client record: name, phone, address, booking history, cadence, payment status (history + payment are relational/other-epic — see Scope). [Source: epics.md#fr-14]
- **FR15** — explicit cadence field `weekly|biweekly|monthly|one-time`. [Source: epics.md#fr-15]
- **AR9/AD-8** owner_id; **AR15** action contract; **AR1** Server Actions sole mutation path; **AR2** Drizzle in `lib/db`. [Source: epics.md#additional-requirements]

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story-1-2] — Story 1.2 ACs (epics.md:226–245); FR14/FR15/FR38 (epics.md:39,40,73); AR9/AR15 (epics.md:106,112).
- [Source: _bmad-output/planning-artifacts/architecture/architecture-LovesCleaning-2026-07-15/ARCHITECTURE-SPINE.md] — AD-1, AD-7, AD-8, AD-9, AD-10; Consistency-Conventions (Naming, Cadence-status, Ids, Errors, Mutation, Simplicity gate, Dates & money); Structural-Seed (ER, entity list).
- [Source: _bmad-output/implementation-artifacts/1-1-authenticated-shell-operator-seed.md] — substrate patterns (owner_id helper, action contract, DB wiring, proxy.ts).

## Dev Agent Record

### Agent Model Used

claude-opus-4-8[1m] (Claude Code, dev-story workflow)

### Debug Log References

- Independently verified: 21/21 tests across 2 runs (15 prior intact — no regressions; +6 new), `tsc --noEmit` exit 0, Turbopack build compiles, migration 0002 applies on Docker Postgres.

### Completion Notes List

- All 6 tasks complete; all 3 ACs satisfied. Reuses Story 1.1 substrate (getOwnerId value helper, ActionResult contract, proxy.ts gate, Drizzle/pooled-Postgres wiring) — nothing re-established.
- **AC1** `createClient` writes `Client` with `owner_id` value + `status='active'` (name/phone/address/cadence). **AC2** `editClient` updates, scoped by `owner_id AND id`; all reads (`listClients`/`getClient`) owner_id-filtered from day one. **AC3** missing name/phone → `{ok:false,reason}`, nothing written.
- Schema (AD-7/AD-8/AD-9/NFR7): `client` — uuid PK; `owner_id` FK→operator (NOT NULL, onDelete restrict); name/phone NOT NULL; address nullable; `cadence` enum `weekly|biweekly|monthly|one-time`; `status` enum `active|provisional` (**`gone-cold` deliberately absent — DB cannot store it; derived per AD-7**); created_at/updated_at timestamptz UTC; index on owner_id. No payment/expectedNextDate/goneCold/notes/email columns (NFR7 + scope).
- Surfaces: `/clients` (list + create), `/clients/[id]/edit` — RSC, `force-dynamic`, phone-first, zero client-JS forms; call actions only (never import lib/db).
- **Deviations:** (1) owner_id isolation test asserts by *value* not a decoy operator row — Story 1.1's `operator_singleton` index + hard FK make a second operator row unconstructible; test proves `getClient(otherOwner, realId)→undefined` and `listClients(otherOwner)→empty` (same AD-8 guarantee). (2) Native `<form action>` needs void return → thin `'use server'` wrappers (`addClient`/`saveClient`) wrap the typed `createClient`/`editClient`; contract + tests live on the typed actions. (3) Server-side validation only, no client-side error rendering (keeps client JS at zero); revisit if UX needs inline errors.

### File List

Created:
- `app/(operator)/clients/actions.ts`, `app/(operator)/clients/ClientForm.tsx`, `app/(operator)/clients/page.tsx`, `app/(operator)/clients/[id]/edit/page.tsx`
- `tests/client.test.ts`
- `drizzle/0002_swift_bromley.sql` (+ `drizzle/meta/0002_snapshot.json`, updated `_journal.json`)

Modified:
- `lib/db/schema.ts` (Client table + enums), `lib/db/queries.ts` (`listClients`/`getClient` owner-scoped reads)

## Change Log

| Date | Change |
|------|--------|
| 2026-07-15 | Story 1.2 implemented: `Client` schema (owner_id FK, cadence/status enums, gone-cold excluded per AD-7), `createClient`/`editClient` actions (owner_id-scoped, AR15 contract), owner_id-filtered reads, `/clients` RSC surfaces, 6 tests. 21/21 green, no regressions. Status → review. |
