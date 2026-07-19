# Public Homepage + Self-Serve Request — Design

Status: approved (brainstorm) · Date: 2026-07-18 · Project: LovesCleaning

## Purpose

LovesCleaning has no public-facing homepage. A stranger hitting the bare domain
lands on the operator sign-in screen. This adds:

1. A **public marketing homepage** at `/` describing *Love's Cleaning* — the
   cleaning **service** — to prospective customers (homeowners).
2. A **self-serve request** path: a tokenless public form that lets a new
   customer ask for a clean without the operator first handing out a booking link.

Audience decision: the homepage sells the cleaning **service** to the cleaner's
customers (not the SaaS tool to other cleaners).

## Constraints & invariants preserved

- **AD-1 layering**: surface → action → domain → db. New surfaces call actions;
  only `lib/db` speaks SQL; `lib/domain` stays pure.
- **AD-6 / AR7**: owner_id is NEVER a form field. The tokenless path derives it
  from the single operator row (single-owner v1), never from client input.
- **AR5 / AD-4**: a public request NEVER consumes capacity — no `commitBooking`,
  no Job, no lock. It only mints a provisional client + pending request + inquiry.
- **AR12**: the write is idempotent per visit-session nonce.
- **Fail-closed**: the request action masks machine reasons behind one generic
  redirect state, exactly as the existing `submitPublicRequest` does.
- **AD-13**: public surfaces stay `dynamic`, never `use cache`.

## 1. Routing

`/` currently renders the operator dashboard (`app/(operator)/page.tsx`, gated by
`proxy.ts`). To free `/` for the public homepage:

| Change | From | To |
|--------|------|----|
| Move dashboard | `app/(operator)/page.tsx` (`/`) | `app/(operator)/dashboard/page.tsx` (`/dashboard`) |
| New public home | — | `app/page.tsx` (`/`, top-level, outside `(operator)` group) |
| New request route | — | `app/request/page.tsx` (`/request`) — see §3 for form-placement note |
| Sign-in redirect | `router.replace('/')` (sign-in/page.tsx:21) | `router.replace('/dashboard')` |
| Public guard | `isPublicPath` opens `/book`, `/sign-in` | also open `/` (exact) and `/request` |

- Session cookie `path: '/'` (sign-in/actions.ts:44) stays — that's cookie scope,
  not a redirect, and must remain `/` to cover `/dashboard`.
- `proxy.ts` body is unchanged; it delegates to `isPublicPath`.
- Any other in-app links to `/` that mean "the dashboard" must be repointed to
  `/dashboard` (audit `app/(operator)/**` for `href="/"` / `redirect('/')`).

### route-guard change

```ts
const PUBLIC_PREFIXES = ['/book'];
const PUBLIC_EXACT = new Set(['/', '/sign-in', '/request']);
```

`/` must be matched as an EXACT public path — not a prefix — so it does not
accidentally open every gated route. `/dashboard` and all other `(operator)`
routes remain gated (not in the public set).

## 2. Homepage content (`/`)

Client temperament from DESIGN.md ("Instrument"): calm light surface
(`surface-base-client`), amber `signal-go` primary action, green reserved for
paid/confirmed only (not used here). Phone-first, single scrollable page,
server component, `export const dynamic = 'force-dynamic'` not required (static
content) but no `use cache`.

Sections, top to bottom:

1. **Hero** — headline "Love's Cleaning — a spotless home, no hassle." +
   sub-line + primary CTA (amber) that scrolls/links to the request form.
2. **Services** — deep clean / regular / move-out, static copy, 3 cards.
3. **Why us / trust** — 3 short trust points (reliable, insured-feel, local).
4. **How it works** — 3 steps: request → we confirm a time → we clean.
5. **Request form** — the self-serve CTA target (see §3).
6. **Footer** — service area + contact + a discreet "Operator sign-in" link to
   `/sign-in`.

All copy is static placeholder marketing prose the operator can later edit; no
CMS in v1 (YAGNI).

## 3. Self-serve request (backend)

Reuse Story 4.2's core, made **tokenless**.

### Owner derivation
New db query `getSingleOwnerId(): Promise<string | null>` in `lib/db/queries.ts`
— reads the one operator row (same deterministic `orderBy(createdAt, id)`
single-owner pattern as `seedOperator`). Returns null if unseeded (the action
then renders the generic "can't take requests right now" masked state).

owner_id flows action → core from this lookup ONLY. Never a form field.

### New core
`submitPublicRequestNoToken(formData)` — a sibling of
`submitPublicRequestResult` in `app/request/request.ts` (plain module, NOT
`'use server'`, so it is not itself a callable endpoint):

- Validate via the existing `readPublicFields` (name/phone required, address
  optional, date required, `MAX_FIELD=200`, mints visit nonce if blank).
- Resolve `getSingleOwnerId()`; if null → typed fail (masked).
- The `date` is accepted as the customer's *preferred* date; unlike the
  token path there is no per-client open-slot set to validate against, so the
  date is stored as free preference on the pending request (no capacity check).
- Write provisional client + pending_request + inquiry (`source: 'web'`) via
  the existing `insertPublicBookingRequest` write, idempotent on the
  `(owner, visit-nonce)` partial-unique (AR12).
- Enforce the provisional-row cap (`PROVISIONAL_MAX_PER_WINDOW=30` /
  `PROVISIONAL_WINDOW_MS=10min`, per owner) via `countRecentPendingRequests`.
- Returns typed `ActionResult` (`ok`/`fail(reason)`), never surfaced raw.

If `insertPublicBookingRequest` cannot accept a null/absent client-token context,
add a tokenless overload or a thin `insertPublicRequestForOwner(ownerId, ...)`
that shares the same transactional body (provisional client + pending + inquiry)
minus token resolution. Keep ONE transactional path if practical.

### Action
`submitPublicRequest(formData)` in `app/request/actions.ts` (`'use server'`):
calls the core, then `redirect` to a masked thank-you state on both success and
failure (e.g. `/request?sent=1`) — identical machine-reason masking to the
existing token action. Only this function is an exported Server Action.

### Form placement
Request form is rendered **on the homepage** (§2 section 5) as a zero/low-JS
`<form action={submitPublicRequest}>`, plus reachable directly at `/request`.
Submit redirects to a thank-you state (`?sent=1`) rendered inline. Rationale:
one page for a phone visitor; `/request` exists so the guard/opening and a
deep link both work.

## 4. Security (new public write surface)

This is a new UNAUTHENTICATED write. Reuse the defense-in-depth primitives
already shipped:

- **Rate limit**: `rateLimit` keyed on `requestIp` (platform-trusted header
  first, x-forwarded-for only as fallback — per the shipped hardening).
- **Provisional-row cap**: per-owner soft cap (30 / 10 min) via
  `countRecentPendingRequests` — bounds a scripted flood; capacity's advisory
  lock remains the one hard invariant (untouched here).
- **Bounded fields**: `MAX_FIELD=200` on name/phone/address (already in
  `readPublicFields`) — the columns are unbounded `text`.
- **Fail-closed masking**: no endpoint leaks whether an owner/record exists.
- **Gate**: `/` and `/request` are the ONLY new open paths; everything under
  `(operator)` stays gated.

A dedicated security review pass is required before merge (project discipline —
every public-write change has had one).

## 5. Data model

- **Inquiry source enum**: add value `web` alongside existing `link` → one
  Drizzle migration (`drizzle/0013_*.sql`). Rationale: keeps the dashboard's
  inquiry-leak conversion honest by distinguishing homepage self-serve from
  operator-shared-link inquiries. No other schema change — provisional client,
  pending_request, and inquiry tables are reused as-is from Story 4.2.

## 6. Testing

- **Unit** (`app/request/request.test.ts` or extend existing): valid submit →
  provisional client + pending_request + inquiry(`web`) written; idempotent on
  repeat visit nonce; provisional cap trips at limit; NO capacity/Job/lock write
  (AR5); unseeded owner → masked fail.
- **Guard** (`tests/route-guard.test.ts`): `/` and `/request` public;
  `/dashboard` and other operator paths gated.
- **Owner query**: `getSingleOwnerId` returns the seeded owner; null when empty.
- **Redirect mask**: action redirects on both ok and fail; raw reasons never
  exposed (mirror the existing token-action test).

## 7. Out of scope (v1 / YAGNI)

- No CMS / editable marketing copy (static prose).
- No multi-operator owner resolution (single-owner v1 lookup only).
- No capacity offering / slot selection on the homepage (that stays the
  token-gated `/book/[token]` surface for known clients).
- No email/SMS notification of a new request (operator sees it in the existing
  requests/inquiries surface).

## File touch list (indicative)

- `app/page.tsx` — NEW public homepage
- `app/request/page.tsx`, `app/request/actions.ts`, `app/request/request.ts` — NEW
- `app/(operator)/page.tsx` → `app/(operator)/dashboard/page.tsx` — MOVE
- `app/(operator)/sign-in/page.tsx` — redirect target `/` → `/dashboard`
- `lib/auth/route-guard.ts` — open `/`, `/request`
- `lib/db/queries.ts` — `getSingleOwnerId`; tokenless insert path
- `lib/db/schema.ts` + `drizzle/0013_*.sql` — `web` inquiry source
- tests as §6
