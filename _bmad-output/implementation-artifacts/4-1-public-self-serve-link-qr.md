---
baseline_commit: 356ed186df2e6b2f753311cad59df618d1587ceb
---

# Story 4.1: Public Self-Serve Link + QR

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a prospective client,
I want to scan a code or tap a link and see open slots,
so that I can request a booking without calling.

## Acceptance Criteria

**AC1 — One public token resolves to the open-slot view (FR4, AR7, AD-6)**
- **Given** exactly one public signed token exists for the operator (AR7 / AD-6)
- **When** a visitor opens its URL with no account
- **Then** they see the open-slot booking view (the surface built in Story 3.1) rendered for the public token, showing only genuinely-open slots (day under its per-day cap AND week under 14, per FR2), with no client login required (FR4, FR34).

**AC2 — QR encodes the public link (FR5, AR7)**
- **Given** the public token's URL
- **When** a QR code is generated
- **Then** the QR encodes that public link (not a per-client link) so it can be printed for physical placement — van, flyer, card (FR5, AR7).

**AC3 — Exactly one public token (AD-6, DB invariant)**
- **Given** the single-operator model
- **When** the public token is minted (or a mint is retried concurrently)
- **Then** at most one `book-public` token row can exist for the owner — enforced at the database level (a re-mint returns the same stable link; it does not create a second public token). See Task 2.

**AC4 — Durable revocation / rotation parity with the per-client link (D1, AR7)**
- **Given** an existing public token
- **When** the operator rotates or revokes it
- **Then** the old URL is permanently dead (a re-mint produces a fresh nonce → new value; the leaked link never resurrects), mirroring the Story 3.1/3.2 nonce-durable revocation model.

**AC5 — Fail-closed public resolution (AR7, AD-8)**
- **Given** a tampered, forged, unknown, empty, revoked, or wrong-capability token
- **When** it hits the public surface
- **Then** resolution fails closed to a single generic "link not valid" outcome — no existence leak, no partial state, no unmasked machine reason, and no unhandled 500 (uniform with the `/book/[token]` per-client path).

**AC6 — Operator can see & share the link + QR**
- **Given** the authenticated operator
- **When** they open the operator surface for the public link
- **Then** they see the absolute public URL (built via the shared base-URL helper) and its QR, ready to copy/print. The link surface stays dynamic (never cached).

> **Scope boundary (do NOT build here):** Stranger submission (name/phone/address → provisional `Client` + `PendingRequest`) is **Story 4.2**. The approval queue is **4.3**. Auto-logging a `link` Inquiry is **4.2/4.4**. Story 4.1 delivers the *public token surface* (mint + resolve-to-view + operator link/QR display) only. Do not create `PendingRequest` or `Inquiry` tables in this story. The public open-slot view shows availability; it does **not** yet accept a submission from a stranger.

## Tasks / Subtasks

- [x] **Task 1 — Public token type + sign/verify (reuse the 3.1 HMAC seam)** (AC: 1, 4, 5)
  - [x] In `lib/auth/clientToken.ts`, add a public-token claim shape that has **no `clientId`**: e.g. `interface PublicTokenClaims { ownerId: string; capability: 'book-public'; nonce: string }`. Do NOT loosen the existing `ClientTokenClaims.clientId: string` guard — add a *separate* public verifier alongside it.
  - [x] Add `signPublicToken(claims, secret)` / `verifyPublicToken(token, secret)` mirroring the client versions: canonical (deterministic) claim key order, exact-shape guard on verify (reject any token whose decoded claims don't match the public shape, incl. `capability === 'book-public'`).
  - [x] Reuse `lib/auth/hmac.ts` `signPayload`/`verifyPayload` **unchanged** (they are client/public-agnostic; `verifyPayload` already fails closed on every error path).
  - [x] Reuse `generateTokenNonce()` verbatim for the per-link random nonce.
  - [x] **Secret decision (see Dev Notes → Decisions):** default to a dedicated `PUBLIC_TOKEN_SECRET` (key separation, matches the `SESSION_SECRET` vs `CLIENT_TOKEN_SECRET` precedent) resolved through a `getPublicTokenSecret()` that reuses the same min-32-char fail-closed guard as `getClientTokenSecret()`. If the architect elects to reuse `CLIENT_TOKEN_SECRET`, capability is already in the signed+checked claim so it is defensible — but record the choice.

- [x] **Task 2 — DB: enforce exactly one public token (AC: 3)**
  - [x] The `token` table, `tokenCapability` enum (`'book-public'`), and nullable `token.clientId` **already exist** (`lib/db/schema.ts`) — use them, do not add parallel structures.
  - [x] Add a **partial unique index** guaranteeing one public token per owner: `uniqueIndex('token_owner_public_uq').on(token.ownerId, token.capability).where(sql`${token.clientId} IS NULL`)` (equivalently a `NULLS NOT DISTINCT` variant). The existing `token_owner_client_capability_uq` does **not** enforce this because Postgres treats NULL `client_id` as distinct — this is the deferred item 3-1 logged for Epic 4.
  - [x] Generate the migration via `npm run db:generate` (→ `drizzle/0010_*.sql`); apply with `npm run db:migrate`. Verify the SQL emits `WHERE client_id IS NULL` (or `NULLS NOT DISTINCT`).

- [x] **Task 3 — DB queries for the public token (AC: 1, 3, 4)**
  - [x] In `lib/db/queries.ts` add public-token helpers mirroring the client ones (prefer thin new functions over loosening existing signatures): `findPublicToken(ownerId, capability)` (owner-scoped read), a null-`clientId` `insertPublicTokenIfAbsent(...)` using race-safe `onConflictDoNothing` on the new partial-unique target, plus `rotatePublicTokenRow(...)` (`onConflictDoUpdate`) and `deletePublicToken(ownerId)` for revoke.
  - [x] **Reuse `findTokenByValue(tokenValue)` verbatim** for public-link resolution — it is intentionally NOT owner-scoped (the token string discovers the owner). Preserve that.
  - [x] Preserve owner-scoping (AD-8) on every other query and the race-safe first-mint semantics.

- [x] **Task 4 — Domain: ensure/resolve/rotate/revoke public token (AC: 1, 4, 5)**
  - [x] Add `ensurePublicToken(ownerId)` (new `lib/domain/publicToken.ts`, or extend `lib/domain/booking.ts`) copying `ensureClientToken`'s **READ-OR-CREATE** pattern: return the stored link verbatim; if the secret rotated, re-sign with the SAME persisted nonce (self-heal); mint a fresh nonce only on create.
  - [x] Add `rotatePublicToken(ownerId)` (issue-new-kill-old) and `revokePublicToken(ownerId)` (delete row → leaked URL dies).
  - [x] Add `resolvePublicTokenClaims(tokenValue)` — the ONE fail-closed chain for the public token: (1) HMAC signature valid under the public secret, (2) `capability === 'book-public'`, (3) a persisted row exists AND owner + capability + **nonce** all agree. Any failure → `null`. Mirror `resolveTokenClaims` exactly, minus the `clientId` agreement.
  - [x] Add a public open-slot view resolver (mirror `resolveBookingView`) that derives the open-slot set (Story 1.7 `weekCapacity`/`nearestOpen`) **without a single-client scope** — the public view shows the operator's genuine availability, not a named client's. Wrap slot derivation in try/catch so a corrupt `settings.timezone` fails closed (never a public 500) — this is the 3-1 P2 fix, mandatory here.

- [x] **Task 5 — Public route surface (AC: 1, 5)**
  - [x] **Prefer reusing `app/book/[token]/page.tsx`** with a capability branch over inventing a new route (Simplicity gate, NFR7): resolve the token, and if `capability === 'book-public'` render the public (client-less) open-slot view; else the existing per-client view. `/book/**` is already public in `proxy.ts` via `route-guard.ts` `PUBLIC_PREFIXES` — **no gate change needed** if you stay under `/book`. If a distinct prefix is chosen, you MUST add it to `PUBLIC_PREFIXES`.
  - [x] Keep `export const dynamic = 'force-dynamic'`. The page calls the domain resolver only — never `lib/db`/crypto directly (layer direction: surfaces → actions → domain → db).
  - [x] Single generic "link not valid" message for every failure mode (AC5). If any `?error=`/reason mapping is added, guard the lookup with `Object.hasOwn` (public surfaces take untrusted query params — the `?error=__proto__` prototype-pollution class flagged in deferred-work).

- [x] **Task 6 — Operator link + QR display (AC: 2, 6)**
  - [x] Add an operator surface (e.g. `app/(operator)/link/page.tsx` + `actions.ts`) that calls `ensurePublicToken(getOwnerId())`, builds the absolute URL, and renders the copy-able link + QR. Add a nav entry on `app/(operator)/page.tsx` (preserve existing links).
  - [x] **Reuse the base-URL helper** currently at `bookingBaseUrl()` in `app/(operator)/jobs/actions.ts` to build `${base}/book/${tokenValue}`. It fails closed in production when `APP_BASE_URL` is unset. **Recommended:** extract it to a shared module (e.g. `lib/domain/urls.ts`) and update the jobs callsite, since 4-1 is the second consumer — preserve its prod-fail-closed behavior.
  - [x] **QR generation (see Decisions):** default to adding the mature `qrcode` npm dep and rendering server-side to an inline SVG string (`QRCode.toString(url, { type: 'svg' })`) — SSR, zero client JS, printable. If the architect prefers no new dependency (NFR7), render a pure-TS QR-to-SVG encoder instead. Record the choice. Do NOT ship a client-side canvas QR (violates the minimal-JS / dynamic-surface constraints).

- [x] **Task 7 — Tests (AC: 1–6)**
  - [x] `tests/public-token.test.ts` mirroring `tests/clientToken.test.ts` + `tests/booking-token.test.ts`: valid public token → only genuinely-open slots (matched against an independent derive); wrong-capability (a `book-client` token cannot resolve on the public path and vice-versa); tampered / forged / unknown / empty / revoked → fail-closed generic result; unguessability; weak/missing secret fails closed; **re-mint after revoke yields a NEW value (durable revocation)**; **exactly-one-public-token DB invariant** (a second insert conflicts).
  - [x] Operator surface test: `ensurePublicToken` is READ-OR-CREATE (stable across calls); secret-rotation self-heal (same nonce, re-signed).
  - [x] Run `npx vitest run` (Docker Postgres for DB-backed tests) + `npx tsc --noEmit`; `npm run build` to confirm the public route emits as **ƒ Dynamic** (never cached, AD-13).

## Dev Notes

### Decisions to make/record (defaults chosen — confirm or override)

1. **Token secret** — *default:* dedicated `PUBLIC_TOKEN_SECRET` via `getPublicTokenSecret()` (reuses the min-32 fail-closed guard), matching the established `SESSION_SECRET`↔`CLIENT_TOKEN_SECRET` key-separation. *Alternative:* reuse `CLIENT_TOKEN_SECRET` (capability is in the signed+checked claim, so cross-interpretation is already blocked). Either is safe; record the pick and add the env var to any deploy/`.env.example` if choosing separation.
2. **Route** — *default:* reuse `/book/[token]` with a capability branch (Simplicity gate). *Alternative:* dedicated `/book/public` or `/b` prefix (then update `PUBLIC_PREFIXES`).
3. **QR library** — *default:* add `qrcode`, render SVG server-side. *Alternative:* pure-TS SVG encoder (no dep). This is the one net-new dependency the story may introduce; NFR7 (nothing ships unless it serves a named leak) is satisfied because the QR *is* the FR5 deliverable for the inquiry leak — but confirm the dependency is acceptable.

### Relevant architecture patterns and constraints [Source: ARCHITECTURE-SPINE.md]

- **Stack:** Next.js 16.x App Router (Server Actions, RSC, Turbopack) [Spine:142-156]; React 19.x; Node 20+; Postgres 16+ transaction-mode pooling; Drizzle ORM. Operator auth middleware is `proxy.ts` (Next 16's renamed `middleware.ts`). [Spine:142-156]
- **Layer direction (strict):** `surfaces (app/) → actions (app/**/actions.ts) → domain (lib/domain/) → db (lib/db/)`. Only `lib/db/` speaks SQL; surfaces never import `lib/db` directly. [Spine:22-48]
- **AD-6 "Token is capability":** exactly one public token exists; the QR encodes the public token's URL (FR5); signed, unguessable, no client login; a bearer does exactly what the token scopes. **This is the core AD 4-1 implements.** [Spine:80-84]
- **AD-8 "Tenancy seam present":** every row carries `owner_id`; the owner filter is present in every query, hardcoded to the single operator via `getOwnerId()`. The public token row carries `owner_id`. [Spine:92-96]
- **AD-1 write path:** every mutation is a Server Action returning `{ok,data}|{ok:false,reason}` — no thrown errors cross the boundary. [Spine:50-54,137]
- **AD-13 latency:** booking surface <2s on 4G, <60s flow; keep queries indexed & owner-scoped; **dynamic, never `use cache`.** [Spine:122-126]
- **NFR7 Simplicity gate:** nothing ships unless it serves a named leak or a capacity/cash decision — the `book-public` enum value and nullable `token.clientId` are the pre-built seam; do not invent parallel structures. [Spine:138]
- **Fail-pattern uniformity (retro Action #4, AD-8):** resolve/write paths fail **closed** (generic invalid-link, no existence leak); list/render paths may fail **open** (one bad row doesn't down the page) — but apply the choice **uniformly per surface**. The public resolve path here is fail-closed throughout.

### The 3.1/3.2 reuse seam — exact code to build on

| Reuse as-is | Add (public variant) |
|---|---|
| `lib/auth/hmac.ts` — `signPayload`, `verifyPayload` (fail-closed) | `signPublicToken` / `verifyPublicToken` (claims w/o `clientId`) |
| `generateTokenNonce()`, min-32 secret fail-closed guard | `PublicTokenClaims` type; `getPublicTokenSecret()` (if separate secret) |
| `lib/db/queries.ts` `findTokenByValue` (NOT owner-scoped, by design) | `findPublicToken`, null-`clientId` `insertPublicTokenIfAbsent`, `rotatePublicTokenRow`, `deletePublicToken` |
| `token` table + revocation model; race-safe `onConflictDoNothing` first-mint | partial unique index `WHERE client_id IS NULL` |
| `lib/domain/booking.ts` `ensureClientToken` (READ-OR-CREATE + rotation self-heal), `resolveTokenClaims` (fail-closed 3-step chain), `resolveBookingView` | `ensurePublicToken`, `rotate/revokePublicToken`, `resolvePublicTokenClaims`, public (client-less) view resolver |
| `app/book/[token]/page.tsx` conventions: `dynamic='force-dynamic'`, domain-only calls, single generic fail message | capability branch for `book-public` (client-less view) |
| `bookingBaseUrl()` (prod fail-closed on unset `APP_BASE_URL`) | operator link+QR surface; QR renderer |
| `capacity.commitBooking` (the ONLY slot-consuming insert) — booking still routes here (relevant to 4.2, not 4.1) | — |

Key file references (verify line numbers on read; code may have shifted):
- `lib/auth/hmac.ts` — HMAC-SHA256 / base64url primitive; token = `base64url(payloadJSON).base64url(HMAC)`, signed not encrypted.
- `lib/auth/clientToken.ts` — `TokenCapability = 'book-client' | 'book-public'` (public already declared); `ClientTokenClaims` requires `clientId`; `generateTokenNonce`, `getClientTokenSecret` (min-32 fail-closed), `signClientToken`/`verifyClientToken` (exact-shape guard).
- `lib/db/queries.ts` — Tokens section: `findTokenByValue`, `findClientToken`, `insertClientTokenIfAbsent` (race-safe), `rotateClientTokenRow`, `deleteClientToken`.
- `lib/domain/booking.ts` — `ensureClientToken`, `rotateClientToken`, `revokeClientToken`, `resolveTokenClaims` (fail-closed chain), `resolveBookingView`.
- `app/book/[token]/{page.tsx,confirm.ts,actions.ts}` — public RSC surface; note the deliberate split: `confirm.ts` is NOT `'use server'` (an inner testable core), `actions.ts` is the only `'use server'` wrapper. Mirror this split if the public path grows an action (4.2).
- `lib/auth/route-guard.ts` — `PUBLIC_PREFIXES = ['/book']`; `/book/**` already open.
- `lib/db/schema.ts` — `token` table (`clientId` nullable "seam for Epic 4"), `tokenCapability` enum (`'book-public'` reserved), `client.status` enum (`active|provisional`, `provisional` reserved for Epic 4), `token_owner_client_capability_uq` (does NOT enforce single public token — see Task 2).

### Source tree components to touch

- **UPDATE** `lib/auth/clientToken.ts` — add public claims/sign/verify. *Preserve:* min-32 secret fail-closed guard; exact-shape verify guards; canonical claim order (deterministic signature). Do not weaken the client `clientId: string` guard.
- **UPDATE** `lib/db/schema.ts` — add partial unique index. *Preserve:* existing `token` columns/indexes.
- **UPDATE** `lib/db/queries.ts` — add public-token helpers. *Preserve:* `findTokenByValue` non-owner-scoped; race-safe first-mint; owner-scoping elsewhere.
- **UPDATE** `lib/domain/booking.ts` (or **NEW** `lib/domain/publicToken.ts`) — public ensure/resolve/rotate/revoke + view resolver. *Preserve:* the fail-closed chain semantics and the nonce-agreement revocation check if extending in place.
- **UPDATE** `app/book/[token]/page.tsx` — capability branch. *Preserve:* `force-dynamic`, domain-only calls, single generic fail message.
- **NEW** `app/(operator)/link/page.tsx` (+ `actions.ts`) — operator link/QR surface.
- **UPDATE** `app/(operator)/page.tsx` — add nav link (preserve existing).
- **UPDATE/EXTRACT** `bookingBaseUrl()` — extract to `lib/domain/urls.ts`, update the `app/(operator)/jobs/actions.ts` callsite. *Preserve:* prod fail-closed on unset `APP_BASE_URL`.
- **UPDATE** `lib/auth/route-guard.ts` — ONLY if a non-`/book` prefix is chosen.
- **NEW** `drizzle/0010_*.sql` — the partial unique index migration.
- **NEW** `tests/public-token.test.ts`.
- **Optional** `lib/db/seed.ts` — seed the single public token (preserve existing seed).

### Testing standards summary

- **Vitest** (`npx vitest run`); tests flat in `/tests/*.test.ts`. DB-backed tests run against **Docker Postgres**; pure derive logic gets pure unit tests. [Source: 3-1/3-2 Debug-Log]
- Each AC gets an explicit test; **crypto/token contract tests split from surface/resolve tests**; adversarial cases (tampered/forged/unknown/empty/revoked/cross-capability, weak-secret fail-closed) are **mandatory** for a token surface.
- Also run `npx tsc --noEmit`; `npm run build` to confirm the public route is **ƒ Dynamic**.
- **Project verify discipline (MEMORY):** independently re-run `tsc` + full suite on any "green" build — it has caught real bugs. Never trust a delegated green without re-running.
- **Security cadence (retro Action #5):** re-apply the 3-1 rigor — 3-layer adversarial review (Blind Hunter / Edge Case Hunter / Acceptance Auditor) + a dedicated security review — because the public self-serve surface widens the token attack surface.

### Pitfalls carried forward (bit prior stories) [Source: deferred-work.md, epic-3-retro]

- **DST / timezone:** only pass the *validated stored* IANA tz to clock helpers; wrap slot derivation in try/catch (a corrupt `settings.timezone` would otherwise 500 the public route — 3-1 P2). Fake Date to a fixed Monday in tests for determinism.
- **Prototype-pollution on `?error=`:** guard any reason/error mapping with `Object.hasOwn` — the public surface takes untrusted query params.
- **Spoofable GET-param banners** (`?booked=1`): inherent to the zero-JS design; a real fix needs per-request flash/session — out of scope for 4.1, note if the operator surface uses any success param.
- **Advisory-lock / pool starvation under public load:** `commitBooking` pins a connection for the whole txn on `(owner, week-monday)`; public traffic raises real concurrency. Not triggered by 4.1 (no commit here) but relevant once 4.2/4.3 approvals commit — flag, don't fix here.
- **`consumesSlot` reuse drift:** a predicate that "looks reusable" isn't automatically correct for a new consumer — add explicit per-consumer intent checks. (Relevant to the availability derive the public view reuses.)
- **Nonce keying (retro Action #2):** idempotency nonces key on the *event instance*, never a bare entity id — relevant when 4.2 logs pending requests / `link` inquiries.

### Project Structure Notes

- Aligns with the enforced layer direction (surfaces → actions → domain → db). The public token is additive on pre-planted seams (`book-public` capability, nullable `token.clientId`, `client.status='provisional'`) — no new architecture, consistent with NFR7.
- One net-new dependency is *possible* (`qrcode`) — the only Simplicity-gate exception in scope, justified because the QR is the FR5 deliverable. Confirm before adding (see Decisions).
- Variance to resolve: the existing `token_owner_client_capability_uq` cannot enforce AD-6's single public token (Postgres NULL-distinct) — the partial unique index in Task 2 is the intentional fix, logged by 3-1 for exactly this moment.

### References

- Story + ACs: [Source: epics.md#Story-4.1]; Epic 4 overview & FR set: [Source: epics.md#Epic-4-Client-Self-Booking]
- FR4/FR5/FR2/FR34, NFR2/NFR3/NFR6: [Source: prds/.../prd.md#5.1-Booking-Engine, #5.8, #6]; token/QR shape: [Source: prds/.../addendum.md#D-Client-Data-Model]
- AR7/AR9/AR14: [Source: epics.md#Additional-Requirements]
- AD-6/AD-8/AD-1/AD-13, stack, layer direction: [Source: architecture/.../ARCHITECTURE-SPINE.md]
- 3.1 token seam, durable revocation (nonce), P2 fail-closed derive: [Source: 3-1-client-booking-surface-per-client-link.md; deferred-work.md#story-3-1]
- 3.2 action split, capacity commit, slot re-derive guard: [Source: 3-2-known-client-direct-confirm-booking.md]
- Carry-forward Action Items #2/#3/#4/#5, single-public-token deferred fix: [Source: epic-3-retro-2026-07-17.md#Action-Items; deferred-work.md]

## Dev Agent Record

### Agent Model Used

claude-opus-4-8[1m] (Opus 4.8, 1M context)

### Debug Log References

- Full suite green: 253/253 (`pnpm test`), tsc clean (`pnpm run typecheck`), `pnpm run build` compiles; `/book/[token]` and `/link` both emit **ƒ (Dynamic)** (AD-13, never cached).
- Test-isolation defect caught by re-running the FULL serial suite (not just the file in isolation, where it passed 8/8): prior test files (`capacity`/`rebook`) intentionally leave an invalid `capacity_settings.timezone` for the shared owner to prove fail-closed derive. Fixed by clearing `job` + `capacitySettings` in the story test's `beforeEach` so `deriveOwnerOpenWeek` uses valid `DEFAULT_CAPACITY`.
- Drizzle API: `onConflictDoNothing` takes `where` (not `targetWhere`) for the partial-index arbiter; `onConflictDoUpdate` takes `targetWhere`.

### Completion Notes List

- **Defaults applied as approved:** dedicated `PUBLIC_TOKEN_SECRET` (key separation), reused `/book/[token]` with a capability branch (public resolved first, per-client fallback), `qrcode` dep with server-side inline SVG.
- **Reused the 3.1 seam:** `hmac.ts` (`signPayload`/`verifyPayload`) and `generateTokenNonce` unchanged; `findTokenByValue` unchanged; the D1 durable-nonce revocation model carried into the public token. The `book-public` capability + nullable `token.clientId` pre-planted seams used directly (no parallel structures, NFR7).
- **Keystone constraint (AC3):** added partial unique index `token_owner_public_uq ON (owner_id, capability) WHERE client_id IS NULL` (migration `0010`) — the existing `(owner,client,capability)` unique cannot enforce one public token because Postgres treats NULL `client_id` as distinct. DB-level test proves a second client-less insert conflicts.
- **Fail-closed uniformity (AD-8, retro Action #4):** public resolve chain (signature → capability → revocation row w/ owner+capability+nonce agreement AND `client_id IS NULL`) mirrors `resolveTokenClaims`; the shared `deriveOwnerOpenWeek` fails closed (null → generic invalid-link) on a corrupt timezone, no public 500.
- **Cross-capability isolation proven:** a per-client token never resolves on the public path and vice-versa (distinct secret + capability guard), both directions tested.
- **De-dup, not duplicate:** extracted the open-week derive into `lib/domain/openWeek.ts` so client + public views share ONE capacity computation (avoids the week-math duplication that caused a prior HIGH bug). Existing 3.1/3.2 tests guarded the `resolveBookingView` refactor.
- **Scope honored:** public surface is view-only (read-only open-day list). Stranger submission → provisional `Client` + `PendingRequest` is Story 4.2 — no commit path, no new tables here.
- **Prototype-pollution guard:** operator `/link` `?error` lookup uses `Object.hasOwn` (public/untrusted query params).
- **Operator UX:** `/link` shows the stable public URL + printable QR + a Rotate control (D1 durable reissue for a leaked link); added "Public link" to dashboard nav.
- **Follow-ups for review:** (a) `dangerouslySetInnerHTML` renders the qrcode-lib SVG built from our own token URL (no user input) — safe, documented inline; (b) carry the retro Action #5 rigor: run the 3-layer adversarial review + dedicated security review on this public surface before merge.

### File List

**New**
- `lib/domain/openWeek.ts` — shared owner open-week derive (fail-closed), used by both booking views.
- `lib/domain/publicToken.ts` — public token lifecycle (ensure/rotate/revoke/resolve) + `resolvePublicBookingView`.
- `lib/domain/urls.ts` — shared `bookingBaseUrl()` (extracted from jobs/actions.ts).
- `app/(operator)/link/page.tsx` — operator public link + QR surface.
- `app/(operator)/link/actions.ts` — `getPublicBookingLink` (link+QR) + `rotatePublicLink`.
- `drizzle/0010_condemned_christian_walker.sql` — partial unique index (one public token per owner).
- `tests/public-token.test.ts` — mint/one-public-token/view/fail-closed/cross-capability/durable-revocation/rotation.

**Modified**
- `lib/auth/clientToken.ts` — `PublicTokenClaims`, `getPublicTokenSecret`, `signPublicToken`, `verifyPublicToken`.
- `lib/db/schema.ts` — `token_owner_public_uq` partial unique index.
- `lib/db/queries.ts` — `findPublicToken`, `insertPublicTokenIfAbsent`, `rotatePublicTokenRow`, `deletePublicToken`.
- `lib/domain/booking.ts` — `resolveBookingView` now uses shared `deriveOwnerOpenWeek`; `OpenSlot` re-exported from `openWeek.ts`.
- `app/book/[token]/page.tsx` — public token resolved first (read-only view), per-client fallback.
- `app/(operator)/jobs/actions.ts` — import shared `bookingBaseUrl` (local copy removed).
- `app/(operator)/page.tsx` — "Public link" nav entry.
- `.env`, `.env.example` — `PUBLIC_TOKEN_SECRET`.
- `package.json` — `qrcode` + `@types/qrcode`.

## Change Log

| Date | Change |
|------|--------|
| 2026-07-17 | Story 4.1 implemented: public self-serve booking token + QR. Reused 3.1 HMAC/nonce seam; added `book-public` sign/verify, partial-unique one-public-token index (migration 0010), client-less open-slot view, operator link/QR surface with durable rotation. 253/253 tests green, tsc + build clean, routes Dynamic. Status → review. |
| 2026-07-17 | Code review (3-layer adversarial + security pass): all 6 ACs MET. Applied 5 findings — F1 (MED, security): guard `resolvePublicTokenClaims` DB lookup so a transient fault fails closed, no public-route 500 (AC5); F2 (concurrency): heal-vs-rotate clobber fixed via `setWhere` guard; F3 (race): drop `undefined as Token` cast; F4: added mandated weak/missing-secret test; F5: distinct `qr-failed` operator error. 254/254 green, tsc + build clean. Status → done. |
