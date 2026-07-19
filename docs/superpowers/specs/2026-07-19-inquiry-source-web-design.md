# Route homepage inquiries to `source='web'`

**Date:** 2026-07-19
**Branch:** `feat/inquiry-source-web`
**Status:** Design approved — ready for implementation plan

## Problem

The tokenless homepage self-serve request (`app/request/request.ts`) writes its
auto-logged inquiry with `source='link'` — the same value the per-client booking
link uses. `insertPublicBookingRequest` hardcodes it (`lib/db/queries.ts:858`) and
the homepage reuses the token path's dedup index (obs 18811: intentional at build
time).

Consequence: the Epic 6 leak-detector dashboard (FR24 inquiry→booking conversion)
**cannot distinguish website-funnel traffic from per-client-link traffic.** Both
land in `source='link'`. Analytics blind spot.

Verified live 2026-07-19: a homepage submission persists `inquiry.source='link'`,
`pending=1`, `jobs=0` (capacity untouched). Behavior is correct; only the source
label is imprecise.

## Goal

Homepage inquiries persist `source='web'`, cleanly separable from `link` (per-client
link) and manual logs, with dedup semantics preserved. Token path unchanged.

## Design

### 1. Schema — `lib/db/schema.ts`

- Add `'web'` to the `inquirySource` pgEnum (`phone, walk-in, link, referral, other, web`).
- Add a **third** partial unique index, disjoint from the existing two:

  ```
  inquiry_owner_session_web_uq  ON inquiry (owner_id, session_nonce)  WHERE source = 'web'
  ```

  Existing indexes stay:
  - `inquiry_owner_session_link_uq` … `WHERE source = 'link'`
  - `inquiry_owner_submit_manual_uq` … `WHERE source <> 'link'`

  **Caveat to resolve in the plan:** the manual index predicate is `source <> 'link'`,
  which now *also* matches `web` rows. A `web` inquiry would be arbitrated by BOTH
  `web_uq` and `manual_uq`. Two options — the plan must pick one and make it explicit:
  - **(a)** Narrow the manual index predicate to `source NOT IN ('link','web')` so the
    three scopes are truly disjoint (cleanest; matches the "disjoint per scope"
    discipline the schema comments assert). Requires a migration that drops+recreates
    the manual index.
  - **(b)** Leave manual as `<>'link'` and rely on UUID nonce uniqueness so the overlap
    never collides in practice. Less churn, but the schema comment's "disjoint" claim
    becomes false for web-vs-manual.

  Recommendation: **(a)** — the whole point of this change is clean scope separation;
  a half-disjoint index set reintroduces the muddiness we're removing.

- Update the inquiry-table doc comment (currently describes two scopes) to describe
  three: link (token visit), web (homepage submit), manual (operator log).

### 2. Migrations — two separate `drizzle-kit generate` runs

The enum `ADD VALUE` and any DDL that references `'web'` (the index predicate) cannot
share one migration transaction — Postgres rejects using a newly-added enum value in
the same tx (saved gotcha `lovescleaning-drizzle-enum-migration-gotcha`). CI runs all
pending migrations in one `migrate` batch, so they must be authored so the ADD VALUE
commits before the index is created — i.e. distinct migration files generated in
distinct runs, ADD VALUE strictly ordered first.

- `0016_*`: `ALTER TYPE inquiry_source ADD VALUE 'web';`
- `0017_*`: `CREATE UNIQUE INDEX inquiry_owner_session_web_uq …` (+ the manual-index
  drop/recreate if option (a)).

Plan must verify the batch applies cleanly on a **fresh** DB (the CI failure mode from
the saved gotcha), not just on the already-migrated dev DB.

### 3. Query — `lib/db/queries.ts::insertPublicBookingRequest`

- Add `source: 'link' | 'web'` to `PublicBookingRequestInput`, default `'link'`.
- Inquiry insert uses the `source` variable instead of the literal, and the ON CONFLICT
  arbiter predicate follows it:

  ```ts
  .values({ ownerId, clientId: c.id, source, sessionNonce })
  .onConflictDoNothing({
    target: [inquiry.ownerId, inquiry.sessionNonce],
    where: eq(inquiry.source, source),   // matches web_uq or link_uq per source
  })
  ```

- `pending_request` idempotency (target owner+nonce+date) is **source-independent** and
  unchanged — the submission stays fully idempotent regardless of inquiry source.

### 4. Callers

- `app/request/request.ts` (homepage): pass `source: 'web'` into
  `insertPublicBookingRequest`. Rewrite the stale comment at lines 7-8 (it currently
  states the homepage reuses `'link'` deliberately — no longer true).
- `app/book/[token]/request.ts` (token): pass explicit `source: 'link'` (or rely on the
  default). No behavior change; assert this in a test so a future default flip can't
  silently reroute the token path.

## Testing

Extend `tests/inquiry-log.test.ts` (+ request-path tests):

1. Homepage path (`submitPublicRequestNoToken`) writes `inquiry.source='web'`.
2. Token path still writes `inquiry.source='link'`.
3. Web double-tap (same owner+nonce) → one inquiry row (web index dedups).
4. Web + manual logs with the *same* nonce do NOT cross-dedup (distinct scopes) —
   guards the index-predicate decision from §1.
5. Fresh-DB migration batch applies (0016 then 0017) without the enum-in-same-tx error.

## Non-goals / invariants held

- No capacity path touched. AR5 holds (`jobs=0` after a public submit).
- No change to owner resolution (AR7/AD-6), rate-limit cap, or redirect-mask.
- Dashboard/derive changes to *surface* the web/link split are OUT of scope — this
  spec only makes the data separable. A follow-up wires it into FR24.

## Verification (for the eventual `/verify`)

Re-run the live flow driven this session: submit the homepage form → assert
`inquiry.source='web'`, `pending=1`, `jobs=0`. Probe: double-submit collapses to one
web inquiry; token booking still logs `link`.
