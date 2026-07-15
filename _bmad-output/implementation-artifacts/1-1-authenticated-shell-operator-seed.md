---
baseline_commit: cff814eaaa5dd249e06cfaaa330b618d263a2aff
---
# Story 1.1: Authenticated shell + operator seed

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As the operator,
I want to log into my own private dashboard,
so that only I can touch the book.

## Acceptance Criteria

1. **Given** a fresh deploy, **When** the app boots, **Then** a one-row Operator seed migration establishes the `owner_id` every table will reference (AR9/AD-8), **And** secrets load from Vercel env (AR18). [Source: epics.md#story-1-1 AC1]
2. **Given** the Next.js 16 App Router scaffold with Drizzle→Postgres wired (AR1, AR2), **When** an unauthenticated visitor hits an `(operator)` route, **Then** `proxy.ts` redirects to sign-in and only the seeded operator's session is accepted (FR33). [Source: epics.md#story-1-1 AC2]
3. **Given** a signed-in operator, **When** the dashboard renders, **Then** it is an empty authenticated shell, server-rendered (RSC), with no client login for anyone else. [Source: epics.md#story-1-1 AC3]

## Tasks / Subtasks

- [x] **Task 1 — Scaffold the greenfield Next.js 16 app (AC: 2, 3)** [Source: ARCHITECTURE-SPINE.md#AD-1, #Stack, AR1]
  - [x] Init Next.js 16.x (≥16.0.11) App Router + React 19.x (≥19.2.4) + TypeScript 5.x, Node 20+, Turbopack default. NO starter template (AR1 — greenfield).
  - [x] Create the canonical `lib/` tree: `lib/db/`, `lib/domain/` (capacity, lifecycle, derive, compose stubs optional), `lib/delivery/`. Surfaces live under `app/`.
  - [x] Create route groups: `app/(operator)/` (auth-protected) with an empty server-rendered dashboard page; `app/book/[token]/` placeholder (public, unprotected — no login, FR34).
  - [x] Enforce dependency direction from file one: `surfaces → actions → domain → db`. No REST/route-handler mutation tier, no client-side data store, no `lib/db` import from a component (AD-1).
  - [x] Keep operator surfaces dynamic — never wrap in `use cache` (AD-7/AD-13); ship minimal client JS, phone-first (NFR1).
- [x] **Task 2 — Wire Drizzle → managed Postgres, transaction-mode-pooling-safe (AC: 1, 2)** [Source: ARCHITECTURE-SPINE.md#AR2, #AD-3, #AD-8]
  - [x] Add Drizzle ORM (latest) targeting managed Postgres 16+ (Neon or Supabase). `lib/db/` is the ONLY module that speaks SQL (AD-1/AR2).
  - [x] Configure the Drizzle client against the **transaction-mode pooled** connection string (pgBouncer). Do NOT rely on session-scoped connection state across queries — this keeps the later `commitBooking` lock correct (AD-3). `pg_advisory_lock()` (session-scoped) is forbidden project-wide.
  - [x] Define the Operator/owner table: surrogate `uuid` PK, timestamps stored UTC ISO-8601 (AD-9). This row is the `owner_id` FK target every later entity references (AD-8).
  - [x] Set up Drizzle migration flow (generate + apply on deploy).
- [x] **Task 3 — Operator seed migration (AC: 1)** [Source: ARCHITECTURE-SPINE.md#AD-8, #Structural Seed; epics.md AR9]
  - [x] One-row seed migration creating exactly ONE operator row → establishes the hardcoded `owner_id` value the whole app filters on.
  - [x] Seed operator identity + hashed passphrase from Vercel env (do not hardcode credentials). Idempotent: re-running must not create a second operator row.
  - [x] `owner_id` filter is present in every query from v1 (value, not just column) — establish the helper/pattern now so later stories add a value source, never a query retrofit (AD-8).
- [x] **Task 4 — Single-operator auth + `proxy.ts` gate (AC: 2, 3)** [Source: ARCHITECTURE-SPINE.md#AD-6, #Stack note, FR33, NFR6]
  - [x] Implement a minimal signed, HTTP-only, `Secure` session cookie for the single operator (verify passphrase against the seeded hash). No auth library is mandated — keep it minimal (NFR7).
  - [x] Sign-in surface: accept only the seeded operator's credentials; establish session on success.
  - [x] Create `proxy.ts` at project root (Next 16's renamed `middleware.ts` — the file MUST be named `proxy.ts`). It protects `app/(operator)/**`, redirects unauthenticated hits to sign-in, and leaves `app/book/[token]/**` open (FR34).
  - [x] No client login anywhere — operator = session; clients = token bearer (two distinct mechanisms, never conflated) (AD-6).
- [x] **Task 5 — Server Action conventions + error shape (AC: 2)** [Source: ARCHITECTURE-SPINE.md#Consistency Conventions, AR15]
  - [x] Establish the Server Action return contract: typed `{ ok, data } | { ok: false, reason }`. No thrown errors cross the action boundary; no silent catches. Errors land in Vercel platform logs (no APM in v1).
  - [x] Verb-first action naming (e.g. `signIn`). Entities singular PascalCase; domain modules lowercase.
- [x] **Task 6 — Deploy config + smoke tests (AC: 1, 2, 3)** [Source: ARCHITECTURE-SPINE.md#Stack, #Deferred]
  - [x] Vercel project (preview + prod). Env: Postgres transaction-mode pooled connection string, operator seed credentials, session/cookie secret. Managed-Postgres backups satisfy durability (NFR5).
  - [x] Smoke test: unauthenticated hit to an `(operator)` route redirects to sign-in; seeded operator can sign in and see the empty shell; seed produces exactly one owner row. (Test framework unspecified by architecture — pick a minimal one; no coverage bar mandated, do not over-scope per NFR7.)

## Dev Notes

### Technical Requirements (locked — do not deviate)

- **Stack (web-verified current at 2026-07-15):** Next.js **16.x (≥16.0.11)** App Router + Server Actions + RSC + Turbopack default; React **19.x (≥19.2.4)**; TypeScript **5.x**; Node **20+**; Postgres **16+** (Neon or Supabase, managed, transaction-mode pooling); Drizzle ORM **latest**; Vercel host. [Source: ARCHITECTURE-SPINE.md#Stack]
- **Middleware file name:** `proxy.ts` at root, NOT `middleware.ts` (renamed in Next 16). [Source: ARCHITECTURE-SPINE.md#Stack note]
- **Auth library:** none mandated — the architecture specifies only the capability model (AD-6). Implement a minimal signed HTTP-only cookie session. Do not pull in a heavy auth framework (NFR7 simplicity gate). [Source: ARCHITECTURE-SPINE.md#AD-6]

### Architecture Compliance (invariants this foundation story must set up correctly)

- **AD-1 — Server-first write path `[ADOPTED]`:** every mutation is a Server Action; no separate API tier; no client-side data store; only `lib/db/` issues SQL. Establish this from file one. [Source: ARCHITECTURE-SPINE.md#AD-1]
- **AD-3 — Exactly-one-winner concurrency (pooling hazard):** even though booking isn't built here, the DB connection you wire MUST be transaction-mode-pooling-safe. Vercel serverless + Neon/Supabase pgBouncer run transaction-mode pooling, under which **session-scoped `pg_advisory_lock()` silently breaks mutual exclusion**. Configure Drizzle for the transaction-mode pooled string and never rely on session-scoped state. [Source: ARCHITECTURE-SPINE.md#AD-3]
- **AD-6 — Token is capability:** operator is a single authenticated session (FR33); clients are token bearers (NFR6); no client login (FR34). Build only the operator-session half here; keep the two mechanisms distinct. [Source: ARCHITECTURE-SPINE.md#AD-6]
- **AD-8 — Tenancy seam present, not built `[ADOPTED]`:** every entity carries an `owner_id` FK; the `owner_id` filter (the value, hardcoded to the single operator) is present in every query from v1. No tenant UI, no multi-user auth. The operator seed is the source of that value. [Source: ARCHITECTURE-SPINE.md#AD-8]
- **AD-9 — One clock:** timestamps stored UTC ISO-8601; all schedule math later runs in operator-local tz. Store UTC now. [Source: ARCHITECTURE-SPINE.md#AD-9]
- **AD-13 — Latency budget:** operator surfaces target <2s interactive on 4G; stay dynamic (no `use cache`), minimal client JS. [Source: ARCHITECTURE-SPINE.md#AD-13]
- **NFR7 simplicity gate:** no structure, column, or surface ships unless it serves a named leak or capacity/cash decision. Scope creep is a defect — this story is infrastructure ONLY. [Source: ARCHITECTURE-SPINE.md#Consistency Conventions]

### Scope boundaries (do NOT build here)

Client CRUD (1.2), availability/caps (1.3), booking + `commitBooking` (1.4), lifecycle/outcomes (1.5), cancel/reschedule (1.6), forecasting (1.7), messaging (Epic 2), client booking surfaces/tokens (Epic 3+). Story 1.1 delivers: scaffold, DB wiring, operator seed + `owner_id` seam, operator auth + `proxy.ts` gate, empty RSC shell. Nothing more. [Source: epics.md#story-1-1 note]

### Project Structure Notes

Canonical source tree (reproduce exactly) [Source: ARCHITECTURE-SPINE.md#Structural Seed]:

```text
app/
  (operator)/        # authenticated dashboard, ledger, scheduling — AUTH-GATED
  book/[token]/      # client booking surface — public, NO login (build placeholder only)
  **/actions.ts      # Server Actions — sole write path (AD-1)
proxy.ts             # operator auth middleware at ROOT (Next 16 renamed middleware.ts)
lib/
  domain/            # capacity, lifecycle, derive, compose — pure, NO framework imports
  delivery/          # channel adapters (v1: deep-link) — later
  db/                # Drizzle schema + queries — the ONLY module that speaks SQL
```

- Dependency direction (hard rule): `surfaces → actions → domain → db`. Nothing lower imports a layer above; nothing bypasses actions to reach db from a surface.
- Naming: entities singular PascalCase (`Client`, `Job`…); Server Actions verb-first (`signIn`, `commitBooking`); domain modules lowercase; ids surrogate `uuid` PK; every row carries `owner_id`; tokens are signed unguessable strings (later).
- No cron, no background job, no materialized/derived flags anywhere (AD-7). [Source: ARCHITECTURE-SPINE.md#Deferred]

### Testing Standards

Architecture defines no test framework, directory, or coverage bar. Pick a minimal framework. Tests to include: (a) `proxy.ts` gates `(operator)` routes and leaves `book/[token]` open; (b) seed produces exactly one owner row and is idempotent; (c) any Server Action returns the typed `{ ok, data } | { ok:false, reason }` shape (no thrown errors cross the boundary). Do not invent coverage scope beyond NFR7. [Source: ARCHITECTURE-SPINE.md#Consistency Conventions]

### Requirements traceability

- **FR33** — Authenticate a single operator for all dashboard/ledger/scheduling functions; single-operator, single-business tenancy in v1; no multi-user roles. [Source: epics.md#fr-33]
- **FR34** (adjacent) — client-facing links require no client login; access by token only. Honored by leaving `book/[token]` open. [Source: epics.md#fr-34]
- **AR1** greenfield scaffold; **AR2** Drizzle/Postgres in `lib/db`; **AR9/AD-8** operator seed + `owner_id`; **AR18** Vercel host + env + `proxy.ts`; **AR15** action return contract. [Source: epics.md#additional-requirements]
- NFRs: **NFR1** phone-first, **NFR3** <2s on 4G, **NFR5** durability via managed backups, **NFR6** authenticated operator + PII protection, **NFR7** simplicity gate. [Source: epics.md#nfrs]

### Deployment / Env

Vercel preview + prod, Turbopack build. Env vars to wire: Postgres transaction-mode pooled connection string; operator seed credentials (identity + passphrase); session/cookie signing secret. No self-hosted infra; no APM in v1. [Source: ARCHITECTURE-SPINE.md#Stack, #Deferred]

### Open gaps flagged to developer

1. Auth library unspecified — architecture gives capability model only; choose minimal signed-cookie session. 2. Test framework/coverage unspecified — pick minimal, no bar. 3. Exact env var names unspecified beyond "secrets via Vercel env" — derive from the list above.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Epic-1] — Operator's Book foundation; Story 1.1 ACs (epics.md:205–224); ARs (epics.md:88–115); NFRs (epics.md:80–86); FR33/FR34 (epics.md:68–69).
- [Source: _bmad-output/planning-artifacts/architecture/architecture-LovesCleaning-2026-07-15/ARCHITECTURE-SPINE.md] — Stack, Structural Seed (source tree, ER, operator seed), AD-1/AD-3/AD-6/AD-8/AD-9/AD-13, Consistency Conventions (auth, errors, naming, simplicity gate), Deferred.
- [Source: _bmad-output/planning-artifacts/prds/prd-LovesCleaning-2026-07-15/prd.md] — FR33 authentication; NFR6 security/privacy.

## Dev Agent Record

### Agent Model Used

claude-opus-4-8[1m] (Claude Code, dev-story workflow)

### Debug Log References

- Verification caught a bug the initial build missed: DB-backed test files (`seed.test.ts`, `action.test.ts`) each called `pool.end()` in `afterAll` on the process-wide singleton pool. Under `fileParallelism:false` + `singleFork` (required so writes to the shared Docker Postgres `operator` table don't interleave), whichever file finished first killed the pool; the next file's `beforeAll` truncate threw `Cannot use a pool after calling end on the pool`, surfacing as nondeterministic "skipped" suites (3→1 varying). Fix: removed per-file `pool.end()`; vitest terminates the single worker at run end. Verified deterministic 11/11 across 3 consecutive runs.
- LSP flagged missing modules (`next`/`react`/`pg`/`process`) after scaffold — stale (indexed before `pnpm install`); real `tsc --noEmit` exits 0.

### Completion Notes List

- All 6 tasks complete; all 3 ACs satisfied. Stack installed: next 16.2.10, react/react-dom 19.2.7, drizzle-orm 0.44.7 (drizzle-kit 0.31.10), pg 8.22.0, vitest 3.2.7; Node 22.22, pnpm 10.33.
- **AC1** operator seed: one-row, idempotent (`onConflictDoNothing` on unique email + existence guard), env-driven creds, scrypt hash; `getOwnerId()` establishes the AD-8 owner_id-value seam. **AC2** `proxy.ts` (root, Next 16) gates `(operator)/**`, redirects `/sign-in`, leaves `/book/[token]` + `/sign-in` open (FR34); only seeded operator's HMAC-signed HttpOnly session accepted. **AC3** empty server-rendered dashboard (`force-dynamic`, no `use cache`), no client login.
- Invariants honored: AD-1 (surfaces→actions→domain→db; only `lib/db` speaks SQL), AD-3 (Drizzle bound to pgBouncer transaction-mode pooled port; no session-scoped state; `pg_advisory_lock` unused), AD-6 (operator session ≠ client token), AD-8 (owner_id seam), AD-9 (UTC timestamptz), AD-13 (dynamic surfaces, minimal client JS), AR15 (`{ok,data}|{ok:false,reason}` action contract; no throws cross boundary).
- Deviations from spec's "web-verified" pins: types `@types/react`/`@types/react-dom` pinned `^19` (registry has no 19.2.4 types); pgBouncer image `edoburu/pgbouncer:latest`; session HMAC uses WebCrypto `crypto.subtle` (runtime-portable HMAC-SHA256, verifies in both proxy + Node action runtimes); cookie `Secure` gated to production so http localhost sign-in works. All within NFR7 (no heavy auth dep).
- Tests: 11/11 pass (route-guard 4, session HMAC 3, seed idempotency 1, signIn contract 3); `tsc --noEmit` clean; Turbopack build succeeds.
- **Deferred for reviewer/deploy:** production `DATABASE_URL` (pooled) + `DIRECT_URL` (migrations) + `OPERATOR_EMAIL` + `OPERATOR_PASSPHRASE` + `SESSION_SECRET` (≥32 chars) must be set in Vercel; run `drizzle-kit migrate` (via DIRECT_URL) then seed on deploy. Local dev/CI uses `docker-compose.yml` (Postgres 16 + pgBouncer transaction mode).

### File List

Created:
- Config: `package.json`, `tsconfig.json`, `next.config.ts`, `vitest.config.ts`, `drizzle.config.ts`, `docker-compose.yml`, `.env.example`
- Middleware: `proxy.ts`
- Surfaces: `app/layout.tsx`, `app/(operator)/page.tsx`, `app/(operator)/sign-in/page.tsx`, `app/(operator)/sign-in/actions.ts`, `app/book/[token]/page.tsx`
- Domain: `lib/domain/result.ts`, `lib/domain/capacity.ts`, `lib/domain/lifecycle.ts`, `lib/domain/derive.ts`, `lib/domain/compose.ts` (stubs)
- Delivery: `lib/delivery/deeplink.ts` (stub)
- Auth: `lib/auth/session.ts`, `lib/auth/passphrase.ts`, `lib/auth/route-guard.ts`, `lib/auth/operator.ts`
- DB: `lib/db/schema.ts`, `lib/db/client.ts`, `lib/db/queries.ts`, `lib/db/seed.ts`; `drizzle/0000_married_pandemic.sql` (+ meta)
- Tests: `tests/setup.ts`, `tests/route-guard.test.ts`, `tests/session.test.ts`, `tests/seed.test.ts`, `tests/action.test.ts`

Modified (this verification pass):
- `vitest.config.ts` — added `fileParallelism:false` + `poolOptions.forks.singleFork` (serialize DB-backed files on shared Postgres)
- `tests/seed.test.ts`, `tests/action.test.ts` — removed per-file `pool.end()` teardown (shared-singleton double-end bug)
- `.gitignore`

## Change Log

| Date | Change |
|------|--------|
| 2026-07-15 | Story 1.1 implemented: greenfield Next.js 16 + Drizzle/Postgres scaffold, operator seed + owner_id seam, HMAC signed-cookie operator auth + `proxy.ts` gate, empty RSC shell, Docker Postgres+pgBouncer, 11 passing tests. Status → review. |
| 2026-07-15 | Fixed nondeterministic test suite: removed shared-pool per-file teardown, serialized DB-backed files. Deterministic 11/11 across 3 runs. |
