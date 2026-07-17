---
review: technology-currency
target: ARCHITECTURE-SPINE.md (Stack table + named technologies)
reviewer: technology-currency reviewer
date: 2026-07-15
verdict: CURRENT (with one actionable clarification to protect AD-3)
---

# Technology-Currency Review — LovesCleaning Architecture Spine

Scope: the Stack table and every named technology in `ARCHITECTURE-SPINE.md` only.
Question: as of 2026-07-15, does each pinned technology still exist, is it current /
not-deprecated, is the version real and appropriate, and is the combination coherent
for a solo + AI-agent greenfield build?

## Verdict

**CURRENT — the stack is real, modern, well-maintained, and internally coherent.**
No named technology is deprecated, renamed, or abandoned. One clarification is
required in `commitBooking`'s locking implementation to keep **AD-3
(exactly-one-winner concurrency)** sound over a serverless connection pooler — see
Finding 5. This is an implementation-detail fix, not a stack change.

## Per-technology findings

### 1. Next.js 16.x — CURRENT, App Router + Server Actions are the recommended default
- Next.js 16 is shipping and stable in mid-2026. Latest line is 16.2.x
  (16.2.6 stable published 2026-05-07; 16.2.7 current as of 2026-06-10; patch
  16.2.10 referenced). Pinning `16.x` is real and appropriate.
- **App Router is the recommended default for new projects.** Pages Router remains
  supported for backward compatibility, but every new feature across the last three
  majors is App-Router-only. The spine's App-Router-first stance is correct.
- **Server Actions are stable and enabled by default** (stable since 14, fully
  stable in 16). Not deprecated, not renamed. AD-1's "Server Actions are the sole
  write path" is idiomatic for Next 16.
- Two Next 16 changes worth flagging to implementers (neither breaks the spine):
  - **Turbopack is the default bundler** in 16.
  - **Middleware file renamed `middleware.ts` → `proxy.ts`.** If the operator-auth
    session (AD-6/FR33) is enforced in middleware, it now lives in `proxy.ts`.
  - **Cache Components / `use cache` + async params** are the new caching model.
    AD-7 ("derived state computed on read, no stored flags") must ensure dashboard
    reads that depend on live Job/Client rows are dynamic (not cached), or the
    leak-detector could render stale `goneCold`/`roomLeft`. Compatible with AD-7,
    but the implementer must not wrap derive-on-read surfaces in `use cache`.
- Node.js 20+ is required by Next 16 — worth pinning in the runtime.

### 2. React 19.x — CURRENT, pairs correctly with Next 16
- **Next.js 16 requires React 19 / react-dom 19 as its minimum.** `19.x` is the
  correct, required pin. Next 16 App Router tracks React 19.2 features.
- Security note: a serialization-fix advisory (April 2026) recommends
  **React 19.2.4+ with Next.js 16.0.11+**. Pin patch floors accordingly rather than
  a bare `19.0`. RSC + Server Actions serialization is exactly this project's write
  path, so applying the patch floor is worthwhile.

### 3. TypeScript 5.x — CURRENT
- 5.x remains the current major and the expected baseline for Next 16 / React 19
  toolchains. No concern. (TypeScript 6 is not a factor for this pin.)

### 4. PostgreSQL 16+ — CURRENT and safely conservative
- As of mid-2026 the newest stable major is **PostgreSQL 18.4** (18.4/17.10/16.14/
  15.18/14.23 released together). PostgreSQL 19 is in beta (Beta 1 2026-06-04),
  targeting September 2026.
- The `16+` floor is real and supported: **PG 16 is supported until ~Nov 2028**
  (5-year policy). PG 14 goes EOL 2026-11-12; PG 13 and older are already EOL — so
  the `16+` floor correctly sits above the EOL line. Managed Neon/Supabase will
  typically provision 16/17/18; all satisfy the floor. No action needed; optionally
  target 17 or 18 for newest features, but 16+ is a sound minimum.

### 5. Drizzle ORM (latest) — CURRENT and maintained; a good fit — with a caveat on AD-3
- **Drizzle is actively maintained and its sustainability concern is resolved:**
  PlanetScale hired the entire Drizzle core team full-time (as of March 2026). It is
  a legitimate, current choice vs Prisma for Postgres in 2026. For this project's
  profile — serverless, small bundles, fast cold starts, SQL-level control (the
  spine wants precise transactional locking) — Drizzle is arguably the *better* fit
  than Prisma. (Prisma 7, Nov 2025, is also fine: TS/WASM engine, edge support.)
- Drizzle supports `db.transaction()` with isolation levels
  (read committed / repeatable read / **serializable**), access mode, and
  deferrable. It supports `SELECT ... FOR UPDATE` (via `.for('update')`), and
  advisory locks are reachable through the raw `sql` template tag. All primitives
  AD-2/AD-3 need are available.
- **Caveat (does not change the pin):** `SELECT FOR UPDATE` is under-documented in
  Drizzle (open issues #2875, #4009). Implementers should expect to write the lock
  with the `sql` tag and cover it with a concurrency test rather than rely on docs.

## Critical cross-cutting finding — AD-3 over a serverless connection pooler

**This is the load-bearing finding.** AD-3 serializes concurrent last-slot claims
with "an **advisory lock on `owner_id`**, or `SELECT … FOR UPDATE` on the day row,"
both caps re-evaluated inside the locked transaction. On Vercel serverless, the app
talks to Postgres through a **transaction-mode connection pooler** (Supabase
Supavisor / the Supabase pooler on port 6543, or Neon's pooled endpoint) — this is
the *only* viable pooling mode for serverless/edge because it returns the backend to
the pool at each COMMIT.

Transaction-mode pooling has a well-known limitation directly relevant to AD-3:

- **Session-scoped state does not survive across transactions** — no persistent
  `SET`, no `LISTEN/NOTIFY`, and critically **`pg_advisory_lock()` (session-scoped)
  is unsafe.** A session advisory lock acquired on one borrowed backend may be
  released to the pool while still held, or the paired `pg_advisory_unlock()` can
  land on a *different* backend. Over a transaction pooler this silently breaks the
  mutual-exclusion guarantee AD-3 depends on → the double-book guard fails exactly
  under the concurrency it exists to stop.

**Therefore, to keep AD-3 sound, the implementation MUST use transaction-scoped
locking that is released automatically at COMMIT/ROLLBACK:**

1. **Preferred: `SELECT … FOR UPDATE` on the operator's day row** inside a single
   `db.transaction()`. Row locks are inherently transaction-scoped, so they are
   fully compatible with transaction-mode pooling. This is the safest AD-3 path.
   (Ensure a day row exists to lock — lock the schedule/day row, or use the
   canonical owner-day row; `FOR UPDATE` on zero rows locks nothing.)
2. **If an advisory lock is chosen instead, it MUST be `pg_advisory_xact_lock()`
   (transaction-scoped), never `pg_advisory_lock()` (session-scoped).**
   `pg_advisory_xact_lock` auto-releases at end of transaction and is safe over the
   pooler.
3. Do the entire cap re-check + insert inside one `db.transaction()` (a single
   pooled transaction). Do not split lock acquisition and the write across two
   Server Action round-trips or two `db` calls.

**Recommended spine edit:** tighten AD-3's wording from "advisory lock on `owner_id`"
to "**transaction-scoped** advisory lock (`pg_advisory_xact_lock`) on `owner_id`, or
`SELECT … FOR UPDATE` on the day row" — and note the pooler constraint so no unit
reaches for session-scoped `pg_advisory_lock`. With that clarification, **AD-3 is not
threatened**: both approaches work correctly on Vercel serverless + Supabase/Neon
transaction pooling.

Secondary durability note: on Supabase, transaction-mode poolers can hand out a
"contaminated" backend carrying leftover session state (e.g. a stuck read-only
transaction state), producing *intermittent* failures. This reinforces rule (3):
keep each Server Action's DB work in one clean `db.transaction()` and avoid relying
on any connection-level state.

## Coherence for a solo + AI-agent greenfield build

The combination is coherent and low-operator-burden:
- Next 16 (App Router + Server Actions + RSC) on Vercel with managed Postgres is a
  first-class, heavily-documented path — ideal for an AI agent generating code and a
  solo operator running it. No self-hosted infra (matches the spine's Structural
  Seed). Vercel is current and the intended host.
- Neon and Supabase are both current managed-Postgres options with serverless
  pooling and backups (satisfies NFR5 durability). Either works; the AD-3 pooler
  caveat above applies identically to both.
- Drizzle + Postgres gives the SQL-level transactional control AD-2/AD-3 require,
  which a higher-abstraction ORM would obscure. Good match for a spine that pins its
  correctness on explicit transactional locking.

## Actions

- **[Required, protects AD-3]** Specify transaction-scoped locking in
  `capacity.commitBooking`: prefer `SELECT … FOR UPDATE` on the day row, or
  `pg_advisory_xact_lock` — never session-scoped `pg_advisory_lock` — all inside one
  `db.transaction()`. Add a concurrency test for the last-slot race.
- **[Recommended]** Tighten AD-3's wording per the edit above.
- **[Recommended]** Pin security patch floors: React ≥ 19.2.4, Next ≥ 16.0.11 (or
  latest 16.2.x).
- **[Awareness]** Next 16 specifics: Turbopack default; middleware is now `proxy.ts`;
  keep AD-7 derive-on-read surfaces dynamic (do not wrap in `use cache`); require
  Node 20+.

## Sources

- Next.js 16 release / status — https://nextjs.org/blog/next-16
- Next.js 16 upgrade guide (React 19 min, Node 20+, proxy.ts) — https://nextjs.org/docs/app/guides/upgrading/version-16
- Next.js minimum React version — https://nextjs.org/docs/messages/react-version
- Next.js Server Actions config / mutating data — https://nextjs.org/docs/app/getting-started/mutating-data
- Next.js current stable (16.2.x, 2026) — https://abhs.in/blog/nextjs-current-version-march-2026-stable-release-whats-new
- React versions — https://react.dev/versions
- Next 16 + React 19.2 production guide (serialization security note) — https://dev.to/x4nent/complete-guide-to-nextjs-16-react-192-in-production-rsc-security-view-transitions-turbopack-5090
- PostgreSQL versioning policy — https://www.postgresql.org/support/versioning/
- PostgreSQL 18.4/17.10/16.14 release — https://www.postgresql.org/about/news/postgresql-184-1710-1614-1518-and-1423-released-3297/
- PostgreSQL endoflife — https://endoflife.date/postgresql
- Drizzle vs Prisma 2026 (PlanetScale hired Drizzle team) — https://www.bytebase.com/blog/drizzle-vs-prisma/ ; https://makerkit.dev/blog/tutorials/drizzle-vs-prisma
- Drizzle transactions — https://orm.drizzle.team/docs/transactions
- Drizzle SELECT FOR UPDATE issues — https://github.com/drizzle-team/drizzle-orm/issues/4009 ; https://github.com/drizzle-team/drizzle-orm/issues/2875
- Supabase transaction-pooler limitations / contaminated backend — https://supabase.com/docs/guides/troubleshooting/resolving-cannot-execute-update-in-a-read-only-transaction-on-transaction-pooler-connections-ef582c ; https://supabase.com/docs/guides/troubleshooting/supavisor-and-connection-terminology-explained-9pr_ZO
- Neon connection pooling (transaction mode) — https://neon.com/docs/connect/connection-pooling
- pg_advisory_xact_lock (transaction-scoped, pooler-safe) — https://runebook.dev/en/docs/postgresql/functions-admin/pg_advisory_xact_lock ; https://oneuptime.com/blog/post/2026-01-25-use-advisory-locks-postgresql/view
- Supabase pooling on Vercel serverless — https://dev.to/mahdi_benrhouma_fe1c6005/supabase-connection-pooling-with-pgbouncer-on-vercel-serverless-1o33
