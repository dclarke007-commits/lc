---
baseline_commit: 05bc6b02e2360fb2db248ec5052e5aafa9afa872
---

# Story 3.1: Client booking surface + per-client link

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a client,
I want to open my own booking link and see real open slots,
so that I can book in seconds with no app and no account.

## Acceptance Criteria

1. **Given** a per-client signed token scoped to one client (AR7), **When** the client opens the link, **Then** they see only genuinely-open slots (day under cap AND week under 14) with no login required (FR2, FR34). [Source: epics.md#story-3-1 AC1]
2. **Given** a per-client token, **When** it is generated, **Then** it is unguessable and bound to exactly one client's `owner_id` record (FR3, AR7). [Source: epics.md#story-3-1 AC2]
3. **Given** any client-facing link, **When** accessed, **Then** access is by token only — a bearer can do exactly what the token scopes, nothing more (FR34, AR7). [Source: epics.md#story-3-1 AC3]

## Tasks / Subtasks

- [x] **Task 1 — `Token` Drizzle schema (AC: 1, 2, 3)** [Source: ARCHITECTURE-SPINE.md#AD-6, #AD-8, #Consistency-Conventions]
  - [x] `Token` table in `lib/db/`: `uuid` PK; `owner_id` FK (AD-8); `client_id` FK → Client (the one client this token is scoped to — nullable seam for the future public token, but this story creates per-client tokens only); the signed, unguessable token **string** (`token_value`, stored + unique-indexed for O(1) lookup); `capability` marker (`token_capability` pgEnum — enum chosen, stored AND carried in the signed claim). No client account, no password, no session row — the token **is** the credential (AD-6).
  - [x] `owner_id` carried on every token row and included in every token query (AD-8) — value hardcoded to the single operator seed (Story 1.1).
  - [x] Generate + apply migration. (`drizzle/0007_fair_anita_blake.sql`)
- [x] **Task 2 — Per-client token generation (AC: 2)** [Source: ARCHITECTURE-SPINE.md#AD-6, NFR6]
  - [x] A generator that produces a **signed, unguessable** token bound to exactly one `client_id` + its `owner_id` (AD-6). Scope claims: `{ clientId, ownerId, capability }`. Mechanism (dev decision): HMAC-SHA256 signed claim mirroring `lib/auth/session.ts` via the shared `lib/auth/hmac.ts`; unforgeable (server-held `CLIENT_TOKEN_SECRET`) and infeasible to guess/enumerate (verified in `clientToken.test.ts`).
  - [x] The token grants **exactly one capability** (`book-client`): view this one client's open slots (+ book that one client in 3.2). It does NOT act as the public link (`book-public` rejected), does NOT enumerate other clients, and does NOT reach any other `owner_id`'s rows (AD-6, AD-8).
  - [x] Idempotent/stable per client: DETERMINISTIC signature + `(owner, client, capability)` unique upsert → one live per-client link (re-mint returns the same token). Rotation/revocation via the DB row (delete = revoke); dev decision recorded (stable, long-lived).
- [x] **Task 3 — No-login public route resolving the token (AC: 1, 3)** [Source: ARCHITECTURE-SPINE.md#AD-1, #AD-6, Stack (proxy.ts)]
  - [x] Server-first RSC route at `app/book/[token]/`. **No client login** (FR34) — publicly reachable; authorization is the token itself. `proxy.ts` does NOT gate `app/book/**` (already excluded via `route-guard.ts` `PUBLIC_PREFIXES=['/book']` since Story 1.1; verified by `route-guard.test.ts`).
  - [x] On request: verify signature server-side, resolve `{ clientId, ownerId, capability }`, confirm the (revocable) row, scope to the client. Invalid/tampered/unknown/revoked → generic "Link not valid" (no existence leak). A valid token grants ONLY its scoped capability (AD-6).
  - [x] The bearer does exactly what the token scopes: renders one client's open-slot view. No mutation in this story (direct-confirm booking is Story 3.2).
- [x] **Task 4 — Render genuinely-open slots (reuse Story 1.7 derivation) (AC: 1)** [Source: ARCHITECTURE-SPINE.md#AD-2, #AD-7, #AD-13]
  - [x] Open-slot set = "day under per-day cap AND week under 14." **Reuses Story 1.7 `derive.weekCapacity` (`days[].open` = not past AND not `maxed` AND week under ceiling) + `nearestOpen` fallback**, over Story 1.4 `consumesSlot`. No capacity math reinvented (AD-2/AD-7). Config (caps, weekly-14, working days, operator tz) from Story 1.3 (defaults from the domain).
  - [x] Query scoped by the token's `owner_id` (AD-8); reads flow surface → `lib/domain/booking` → `queries`/`derive`; the surface never imports `lib/db` directly (AD-1).
  - [x] Phone-first RSC, `force-dynamic` — **never `use cache`** (AD-13); open slots live at view time; minimal client JS (no client component). `/book/[token]` builds as ƒ (Dynamic).
- [x] **Task 5 — Tests (AC: 1, 2, 3)**
  - [x] Valid per-client token → renders only genuinely-open slots (matches independent `derive` computation), no login required. (`booking-token.test.ts`)
  - [x] Token bound to exactly one `client_id` + `owner_id`; a token for client A resolves only A; a validly-signed token for another owner (no row) is rejected; never reaches another owner's rows.
  - [x] Tampered/forged/unknown/empty token rejected (fail closed) with a generic result; a bearer cannot exceed scope (no mutation, cross-client, cross-owner, or `book-public` capability).
  - [x] Unguessability: signed, non-enumerable — adjacent client ids yield unrelated signatures (`clientToken.test.ts`); weak-secret fails closed.

## Dev Notes

### Previous story intelligence

**First client-facing surface — no app, no account (NFR2).** This story stands up the `Token` entity + the `app/book/[token]/` public route that Stories 3.2 (known-client direct-confirm) and 3.3 (one-tap rebooking link) both consume — 3.2 mutates through this surface, 3.3 hands this per-client link to the client in a `MessageDraft`. Get the token = capability boundary exactly right here; every later client path trusts it. Reuses Story 1.1's `owner_id` seed + action contract. **Consumes, does not rebuild, the capacity math:** Story 1.7's `derive.roomLeft`/`derive.dayMaxed` and Story 1.4's `capacity.consumesSlot` are the single source of "genuinely-open" — call them, never re-derive (AD-2/AD-7). Config from Story 1.3 (caps, weekly-14, working days, operator-local clock). [Source: 1-1/1-3/1-4/1-7 …md]

### Architecture Compliance (invariants — quote-exact)

- **AD-6 — Token is capability (verbatim):** "The operator is a single authenticated session (FR33). Client links are **signed, unguessable tokens** (NFR6): a per-client token is scoped to one client; exactly one public token exists; the QR encodes the public token's URL (FR5). No client login (FR34). A bearer can do exactly what its token scopes — nothing more." [Source: ARCHITECTURE-SPINE.md#AD-6]
- **AD-8 — Tenancy seam (verbatim):** "Every Client, Job, PendingRequest, Inquiry, MessageLog, and token row carries an `owner_id` FK. The `owner_id` **filter is present in every query from v1** (value hardcoded to the single operator), not merely the column — so the future split adds a value source, never a query retrofit. **No** tenant-scoping UI and **no** multi-user auth in v1." [Source: ARCHITECTURE-SPINE.md#AD-8]
- **Genuinely-open-slot predicate (verbatim, FR2):** "Present clients a booking view showing only genuinely-open slots (day under per-day cap AND week under 14)." Derived via `derive.roomLeft = 14 − consuming jobs this week` and `derive.dayMaxed` (day at per-day cap), both over `capacity.consumesSlot` — Story 1.7/1.4. [Source: epics.md#FR2; ARCHITECTURE-SPINE.md#AD-2, #AD-7]
- **AD-1 — sole write path / SQL boundary:** surfaces reach data only via Server Actions / `derive`; only `lib/db/` speaks SQL; `app/book/[token]/` never imports `lib/db` directly. [Source: ARCHITECTURE-SPINE.md#AD-1]
- **AD-13 / AR14 — latency budget:** booking surface dynamic (never `use cache`), <2s on 4G, <60s flow, minimal client JS. [Source: ARCHITECTURE-SPINE.md#AD-13]
- **Convention — Ids/Auth:** "tokens are signed, unguessable strings"; "Operator = session; clients = token bearer (AD-6)." [Source: ARCHITECTURE-SPINE.md#Consistency-Conventions]

### Security notes (SECURITY-CRITICAL — token = capability)

- The token is the **entire** authorization decision on client surfaces. There is no login, no session, no account (FR34). Therefore: signature MUST be server-verified on every request; the signing secret lives only server-side (Vercel env); an attacker holding a token can do **only** what the token's scope claims permit — one client, one owner, view-open-slots (+ book that client in 3.2) — and nothing more (AD-6).
- Unguessable = not sequential, not derivable from `client_id`, high-entropy, and unforgeable without the secret (NFR6). A leaked/observed URL grants only that one client's booking capability; it must never widen to the public link, another client, or another owner (AD-8).
- Fail closed: any verification failure returns a generic invalid-link response and reveals nothing about client existence.

### Scope boundaries (do NOT build here)

No booking mutation / direct-confirm (Story 3.2 — `commitBooking` from this surface). No public token / QR (Epic 4, FR4/FR5). No rebooking proposal or `MessageDraft` (Story 3.3). No approval queue or inquiry auto-log (Epic 4, though a `link` Inquiry per token-visit is AD-11 — belongs with the booking mutation, not this view-only story). Do NOT reimplement `roomLeft`/`dayMaxed`/`consumesSlot` — reuse Stories 1.7/1.4.

### FR references [Source: epics.md]

- **FR2** — Present clients a booking view showing only genuinely-open slots (day under per-day cap AND week under 14). (epics.md:21)
- **FR3** — Provide per-client tokenized booking links (tied to a client record) for known inquirers and rebooking. (epics.md:22)
- **FR34** — Client-facing booking links require no client login; access is by link/token only. (epics.md:69)
- **AR7 (AD-6)** — Client links are signed, unguessable tokens: per-client token scoped to one client; exactly one public token; operator single authenticated session; no client login. (epics.md:104)
- **NFR2** — Zero client friction: no app, no account; booking under ~60s on a phone. (epics.md:81)

### Open gaps flagged to developer

1. **Token format / signing library** — signed + unguessable is mandated (AD-6/NFR6); the mechanism is unspecified. Choose: HMAC-signed opaque string, a signed JWT-style claim (`{client_id, owner_id, capability}`), or a random high-entropy token with claims stored server-side. Whichever — verify server-side, secret in Vercel env, unforgeable.
2. **Expiry / rotation policy** — AD-6 does not state whether per-client tokens expire or can be revoked/rotated. Decide (e.g. long-lived stable link vs. rotate-on-regeneration) and whether the DB row or the signature carries expiry.
3. **Route path shape** — `app/book/[token]/` per source tree; confirm the exact segment (token as path param vs. query) and that `proxy.ts` operator middleware explicitly excludes `app/book/**` (this is the sole no-login surface).
4. **`capability` representation** — enum column vs. signed claim. For v1 a single per-client capability may be implicit in the token type; keep the seam so the public token (Epic 4) is a distinct capability.
5. **Slot horizon for the client view** — FR2 says "genuinely-open slots" but not how far forward to show. Reuse a bounded future window consistent with Story 1.7 nearest-open; confirm.

### References

- [Source: epics.md#Story-3-1] (epics.md:440–458); FR2/FR3/FR34 (epics.md:21,22,69); AR7/AR14 (epics.md:104,111); NFR2/NFR3 (epics.md:81,82).
- [Source: ARCHITECTURE-SPINE.md] — AD-6 (token=capability), AD-8 (tenancy), AD-1, AD-2, AD-7 (open-slot derivation), AD-13; Consistency-Conventions (Ids, Auth); Source tree (`app/book/[token]/`), Stack (`proxy.ts`).

## Dev Agent Record

### Agent Model Used

claude-opus-4-8[1m] (Opus 4.8, 1M context)

### Debug Log References

- Full suite: **181/181** passing (14 new — `clientToken.test.ts` ×7, `booking-token.test.ts` ×7).
- `npx tsc --noEmit` clean; `npm run build` clean — `/book/[token]` emitted as **ƒ (Dynamic)**, never cached (AD-13).

### Completion Notes List

Dev decisions (Open Gaps resolved with operator on 2026-07-16):

- **Token mechanism (Gap #1):** HMAC-SHA256 signed claim `{clientId, ownerId, capability}` (mirrors `lib/auth/session.ts`) **plus** a persisted `token` row. Verify = HMAC (fail closed) + row-exists (revocation) + owner/client scope agreement. No new dependency (NFR7).
- **Expiry/rotation (Gap #2):** stable, long-lived, **deterministic** token → one live link per client (idempotent re-mint); revoke by deleting the row.
- **Capability (Gap #4):** `token_capability` pgEnum — `book-client` now, `book-public` seam for Epic 4 — stored in the row AND carried in the signed claim; verification requires both agree.
- **Slot horizon (Gap #5):** current operator-local week's open days via Story 1.7 `derive.weekCapacity`; `nearestOpen` fallback when the week has none.
- **Proxy exclusion (Gap #3):** already in place from Story 1.1 (`route-guard.ts` `PUBLIC_PREFIXES=['/book']`); verified by existing `route-guard.test.ts`. No middleware change.

Implementation notes:

- **Refactor (reuse, don't reinvent):** extracted the shared HMAC/base64url primitive to `lib/auth/hmac.ts`; `session.ts` now consumes it — token format byte-identical, `session.test.ts` still green. One audited crypto path.
- **Security:** dedicated `CLIENT_TOKEN_SECRET` (key separation from `SESSION_SECRET`), fail-closed on weak/missing; a single generic invalid-link on every failure (no existence leak); AD-8 owner-scoping on every token/client/job/settings read.
- **Scope honored:** view-only — no booking mutation (Story 3.2), no public token/QR (Epic 4); capacity math reused, never rebuilt (AD-2/AD-7).

### File List

- `lib/db/schema.ts` (M) — `tokenCapability` enum + `token` table + `Token`/`NewToken` types
- `drizzle/0007_fair_anita_blake.sql` (A) — token table migration (applied)
- `lib/auth/hmac.ts` (A) — shared HMAC-SHA256 / base64url primitive
- `lib/auth/clientToken.ts` (A) — per-client token sign/verify + `getClientTokenSecret`
- `lib/auth/session.ts` (M) — refactored onto `hmac.ts` (behavior unchanged)
- `lib/db/queries.ts` (M) — `upsertClientToken` + `findTokenByValue`
- `lib/domain/booking.ts` (A) — `ensureClientToken` + `resolveBookingView`
- `app/book/[token]/page.tsx` (M) — public no-login RSC booking surface (open-slot view)
- `.env.example` (M) / `.env` (M) — `CLIENT_TOKEN_SECRET`
- `tests/clientToken.test.ts` (A) — token crypto contract (7)
- `tests/booking-token.test.ts` (A) — mint / resolve / scope surface (7)

### Change Log

- 2026-07-16 — Story 3.1 implemented: `Token` schema + migration, per-client HMAC token (shared `hmac.ts`, `session.ts` refactored onto it), public no-login booking surface rendering genuinely-open slots (reuse Story 1.7 `derive`), fail-closed resolve chain (signature → revocation row → owner/client scope), dedicated `CLIENT_TOKEN_SECRET`. 14 new tests; tsc + build + 181/181 green. Status → review.
