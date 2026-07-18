---
baseline_commit: a8cd15b
---

# Story 4.4: Log inquiry with source

Status: done

## Story

As the **operator**,
I want **to log phone and walk-in inquiries with their source**,
so that **inquiry → booking conversion reflects reality, not just link visits**.

## Acceptance Criteria

1. **(FR37) Manual inquiry log with source.**
   **Given** a verbal inquiry (phone, walk-in, referral, word-of-mouth)
   **When** the operator logs it
   **Then** it is recorded as an `Inquiry` with a `source` (`phone|walk-in|referral|other`), **independent of any booking link** (no token, no visit session).

2. **(FR37, AR12) Conversion denominator dedupes to distinct inquiries.**
   **Given** an auto-logged `link` inquiry (Story 4.2) and a manual log for the **same contact**
   **When** inquiry→booking conversion is computed
   **Then** the denominator **dedupes to distinct inquiries** so that contact is **not double-counted**.

### Definition of Done (invariants)

- **AD-8:** manual inquiry writes/reads owner-scoped via session `getOwnerId()` (operator surface).
- **AR12:** `link` is a SERVER-ONLY source (auto-logged by 4.2). The manual log action must REJECT a `link` source from operator input — a hand-crafted `source=link` POST cannot forge a link inquiry.
- **AR19 alignment:** Inquiry→booking = bookings ÷ **all logged inquiries**, but the denominator counts **distinct** inquiries (AR12). This story delivers the pure dedup derive that Epic 6's FR24 dashboard will consume — NOT the dashboard itself.
- **Regression:** the 4.2 auto-`link`-inquiry path, its partial unique index, and 277 existing tests stay green.

## Tasks / Subtasks

- [x] **Task 1 — Query layer (`lib/db/queries.ts`) (AC1, AC2)**
  - [x] `insertInquiry({ ownerId, source, clientId })` → inserts an `inquiry` row with `session_nonce = null` (manual logs carry no visit session). `clientId` optional (an anonymous verbal inquiry may have no client record; a known-contact inquiry references an existing client). Owner-scoped. Returns the row.
  - [x] `listInquiries(ownerId)` → the owner's inquiries (id, source, clientId, createdAt) for the derive + tests. Owner-scoped.

- [x] **Task 2 — Pure dedup derive (`lib/domain/derive.ts`) (AC2)**
  - [x] Add a PURE function (no db, no framework) that computes the **distinct-inquiry denominator** from a list of `{ clientId: string | null }` inquiry rows. **DEV DECISION (dedup rule):** distinct = (number of distinct non-null `clientId`s) + (number of rows with a null `clientId`). Rationale: a `link` auto-log (which always carries the provisional `clientId`, Story 4.2) plus a manual log the operator attaches to that **same client** collapse to ONE distinct inquiry (AR12 "same contact"); an anonymous verbal inquiry (no client) can't be matched to anyone, so each counts once. Document this decision inline. Name it e.g. `distinctInquiryCount(rows)`.
  - [x] (Optional, if it clarifies the seam) a thin `inquiryConversion(inquiries, bookingsCount)` returning `bookingsCount / distinctInquiryCount(...)` guarded against divide-by-zero — but do NOT build the dashboard (Epic 6). Keep it a pure function with tests.

- [x] **Task 3 — Log action + surface (`app/(operator)/inquiries/...` or an existing operator surface) (AC1)**
  - [x] `'use server'` action `logInquiry(formData)`: owner from session `getOwnerId()` (fail-closed). Read `source` (must be one of `phone|walk-in|referral|other` — REJECT `link` and any unknown value with a machine reason) and an optional `clientId` (validate UUID + owner-scoped existence if provided, else null). Insert via `insertInquiry`. Return the AR15 `ActionResult`; `revalidatePath`. Mirror `app/(operator)/clients/actions.ts`.
  - [x] Minimal surface: a small "Log an inquiry" form — a `source` `<select>` (the four manual sources) + an optional client picker (or leave client attachment out of the surface if that keeps it simpler and still satisfies AC1; AC2's dedup is proven by the derive tests regardless). Zero-JS. Add a nav entry OR fold the form onto an existing operator surface — match existing patterns. Success/error banner with `Object.hasOwn` on any `?error=`.
  - [x] Caching: match sibling operator surfaces (dynamic).

- [x] **Task 4 — Tests (`tests/*.test.ts`) (AC1, AC2)**
  - [x] AC1: `logInquiry` with each manual source → an `inquiry` row with that source, `session_nonce` null, owner-scoped, no token/link involved. A `source=link` (or unknown) input → rejected, nothing written.
  - [x] AC2 (pure derive, no DB needed): a `link` inquiry + a manual inquiry with the SAME `clientId` → `distinctInquiryCount` = 1. Two different clients → 2. Two null-client rows → 2. Mixed → correct sum. (Pure unit test — fast, deterministic.)
  - [x] AC2 (integration, optional): auto-log a `link` inquiry via the 4.2 path for a client, then `logInquiry` attached to the same client → `listInquiries` has 2 rows but `distinctInquiryCount` = 1.
  - [x] Regression: the 4.2 partial-unique `link` dedup still holds (a manual non-link inquiry never collides with it — different source).
  - [x] FK-safe `beforeEach` cleanup.

## Dev Notes

### Reuse (do NOT rebuild)
- **`inquiry` table + `inquirySource` enum** (`phone|walk-in|link|referral|other`) — already exist (Story 4.2). No schema change, no migration expected.
- **Owner-scoping** via session `getOwnerId()` (operator surface); **`ok/fail/ActionResult`**; **`revalidatePath`**; the `app/(operator)/clients/actions.ts` action shape; the `UUID_RE` guard + owner-scoped existence check pattern (`getClient`).
- **`lib/domain/derive.ts`** — the home of pure metric derives (gone-cold, expectedNextDate, weekCapacity, rebookingConversion). Put `distinctInquiryCount` alongside them; keep it PURE (AD-7: derive on read, no stored counters).

### Key points / gotchas
- **`link` is server-only (AR12/security):** the manual action must whitelist `phone|walk-in|referral|other` and reject `link` — otherwise an operator (or a crafted POST) could mint fake `link` inquiries and skew provenance. This is the one real input-trust concern.
- **No double-count (AR12):** the whole point — a `link` auto-log already exists for a client who self-booked; if the operator ALSO logs a manual inquiry for that same client, the conversion denominator must count them once. The dedup lives in the pure derive (`distinctInquiryCount`), not in a DB constraint (manual + link are legitimately two rows; only the METRIC dedupes).
- **Scope:** this is FR37 (log + dedup seam) only. The FR24 conversion **dashboard** is Epic 6 — do NOT build dashboard UI, leak indicators, or the other two metrics. Just: log with source + the pure distinct-inquiry denominator + tests (NFR7).

### Scope boundaries
- No dashboard (Epic 6). No editing/deleting inquiries. No analytics surface. No change to the 4.2 auto-`link` path beyond reading its rows.

### References
- [Source: epics.md#Story-4.4] (lines 608–622) — ACs; FR37 (l.30); AR12 (l.109, dedup); AR19 (l.115, Inquiry→booking = bookings ÷ all logged inquiries); FR24 → Epic 6 (l.148, dashboard NOT here).
- [Source: lib/db/schema.ts] `inquiry`, `inquirySource`; [Source: lib/db/queries.ts] `insertPublicBookingRequest` (the 4.2 auto-link path) + `getClient` guard; [Source: lib/domain/derive.ts] existing pure derives; [Source: app/(operator)/clients/actions.ts] operator action pattern.

## Dev Agent Record

### Agent Model Used

claude-opus-4-8[1m] (dev delegated to subagent, independently verified by main)

### Completion Notes List

- Manual `logInquiry` whitelists `phone|walk-in|referral|other` (rejects `link` + unknown → `source-invalid`, nothing written — `link` is server-only, AR12). `sessionNonce: null`. Optional `clientId` UUID-guarded + owner-scoped via `getClient`. Owner from session `getOwnerId()`. No schema change / migration (the 4.2 `inquiry` table + enum suffice).
- Pure `distinctInquiryCount` (`lib/domain/derive.ts`) = distinct non-null `clientId`s + count of null-client rows — the AR12/AR19 conversion denominator dedup (a `link` auto-log + a manual log for the same client collapse to one). Delivered as the pure seam Epic 6's FR24 dashboard consumes; NO dashboard built here (correct scope).
- **Review (4 lenses):** no HIGH; link-forgery / cross-owner clientId / injection / prototype-pollution all MITIGATED; partial-unique `link` index does not collide with manual rows (verified). **One MED (double-tap → duplicate manual inquiry inflates the denominator) ACCEPTED as a documented limitation** — single-operator self-only skew, derive-on-read, and a dedup fix would need a new nonce+index (schema change) against NFR7 + the LOCKED no-rate-limit precedent. Logged as an Epic-4 retro action for the FR24 dashboard (Epic 6) to dedupe manual double-logs if needed.
- **Tests (15):** AC1 (each manual source stored, `session_nonce` null, `link`/unknown rejected), AC2 pure (`distinctInquiryCount` edge cases) + integration (real 4.2 `link` auto-log + manual same client → 2 rows, distinct = 1).
- Verified independently: `tsc` clean, **292/292**, build green, `/inquiries` ƒ Dynamic.

### File List

- `lib/db/queries.ts` (UPDATE) — `insertInquiry`, `listInquiries`, `InquiryListItem`.
- `lib/domain/derive.ts` (UPDATE) — pure `distinctInquiryCount`.
- `app/(operator)/inquiries/actions.ts` (NEW) — `logInquiry`, `listOwnerInquiries`.
- `app/(operator)/inquiries/page.tsx` (NEW) — zero-JS log form + list + banners.
- `app/(operator)/page.tsx` (UPDATE) — `/inquiries` nav link.
- `tests/inquiry-log.test.ts` (NEW, 10) + `tests/derive.test.ts` (UPDATE, +5 pure cases).

## Change Log

- 2026-07-18 — Story 4.4 implemented + Epic-4 adversarial/security review (no HIGH; one MED double-submit accepted as documented limitation). tsc clean, 292/292, build green. Status → done.
