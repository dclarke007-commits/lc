---
baseline_commit: 6598530
---

# Story 4.3: Operator approval queue

Status: done

## Story

As the **operator**,
I want **to review the queue of pending new-client requests and approve or decline each**,
so that **strangers never silently hold my slots, and an approved request becomes a real booking that consumes capacity**.

## Acceptance Criteria

1. **(FR36) Queue visibility + actions.**
   **Given** pending new-client requests (Story 4.2 `PendingRequest` rows, `status='pending'`)
   **When** the operator opens the queue
   **Then** they see each request (client name/phone/address + requested day) and can **approve** or **decline** it.

2. **(FR36, AR4, AR5) Approve → commit, one-winner.**
   **Given** the operator approves a request
   **When** it commits
   **Then** `commitBooking` re-checks the cap and **consumes capacity** (the ONLY place 4.x consumes it, AD-2); the **first approval on a shared slot wins** and the rest are surfaced as **no-longer-available** (not silently dropped); the request's status moves to `approved`.

3. **(FR36) Decline → slot untouched.**
   **Given** the operator declines a request
   **When** processed
   **Then** the slot is **untouched**, **no capacity changes**, and the request's status moves to `declined`.

### Definition of Done (invariants)

- **AR5/AD-2:** capacity is consumed ONLY via `commitBooking` on approve — never on decline, never on queue render. A `PendingRequest` never inserts a Job by any other path.
- **AR4 one-winner:** two pending requests targeting the same full-after-first day → the first approve commits, the second approve returns `no-availability` (day-maxed/week-full) and does NOT create a second Job. Enforced by `commitBooking`'s existing advisory-lock + cap re-check (do NOT re-implement capacity logic).
- **AD-8:** every read/write is owner-scoped via the **session** `getOwnerId()` (this is an OPERATOR surface, authenticated — NOT the public token path). A request belonging to another owner is unreachable.
- **Idempotency:** approving the same request twice yields the same Job (no double consume); a re-tap after decline does not resurrect it. Status transitions guard on the current `status`.
- **Regression:** the public 4.2 submit path, the 4.1 view, and the 3.2 known-client confirm all still work; existing 266 tests stay green.

## Tasks / Subtasks

- [x] **Task 1 — Query layer: read the queue + status transition (`lib/db/queries.ts`) (AC1, AC2, AC3)**
  - [x] `listPendingRequests(ownerId)` → the owner's `status='pending'` requests joined to `client` (name, phone, address) + `date` + request `id` + `createdAt`, owner-scoped on BOTH the request and the join (mirror `listJobs`' owner-scoped join). Order oldest-first (FIFO queue) or newest-first — pick one, document it. Projection interface `PendingRequestListItem`.
  - [x] `getPendingRequest(ownerId, id)` → one owner-scoped request row (UUID-guard like `getClient`), for the action to re-read state under the mutation.
  - [x] `setPendingRequestStatus(ownerId, id, from, to)` → guarded UPDATE: set `status=to` WHERE `owner_id=ownerId AND id=id AND status=from`, `.returning()`. Returns the row or undefined (a request already approved/declined matches zero rows → the action treats it as a stale no-op, never a double transition). This is the concurrency/idempotency guard for the status field.

- [x] **Task 2 — Approve/decline actions (`app/(operator)/requests/actions.ts`) (AC2, AC3)**
  - [x] `'use server'` module; owner from **session** `getOwnerId()` (fail-closed to `fail('owner-unresolved')` on throw, mirror `createClient`). NEVER take owner/client/date from a form field beyond the request `id`.
  - [x] `approveRequest(formData)`: read request `id`. Re-read the request owner-scoped (`getPendingRequest`); if missing or not `pending` → `fail('not-pending')` (masked). Call `commitBooking({ ownerId, clientId: req.clientId, date: req.date, override: false, idempotencyKey: 'approve:'+req.id })` — the ONE capacity path (do NOT re-check caps yourself). If commit fails with `day-maxed`/`week-full` → the slot filled since submit → surface **no-longer-available** and leave the request `pending` (operator can decline it) — do NOT mark approved. On commit success → `setPendingRequestStatus(ownerId, id, 'pending', 'approved')`, and promote the provisional client to `active` (a real booking exists now). Order matters: commit BEFORE the status flip so a failed commit leaves state clean; the idempotencyKey makes a re-tap after a partial replay the same Job.
  - [x] `declineRequest(formData)`: `setPendingRequestStatus(ownerId, id, 'pending', 'declined')` — no capacity touch. A non-pending request is a stale no-op.
  - [x] Both return the AR15 typed result to a thin wrapper OR redirect-mask like the operator surfaces do (follow whatever the existing operator actions use — likely `revalidatePath('/requests')` + return `ActionResult`, since operator surfaces render reasons rather than redirect-masking; MATCH the existing operator pattern, e.g. `createClient`).
  - [x] Consider a testable non-action core if the action file would otherwise export a raw-reason function used by tests — but operator actions already return `ActionResult` and are session-guarded (not public), so the 3.2 "second public endpoint" concern does NOT apply here. Keep it simple; match `app/(operator)/clients/actions.ts`.

- [x] **Task 3 — Queue surface (`app/(operator)/requests/page.tsx` + nav) (AC1)**
  - [x] RSC list surface reading `listPendingRequests` via an action (surfaces never import `lib/db`). Render each: client name, phone, address, requested day (use `formatDateKey`). Two zero-JS forms per row (approve / decline) each POSTing the request `id`.
  - [x] Success/error banners: approved / declined / `no-longer-available`. Use `Object.hasOwn` if reading an untrusted `?error=` param.
  - [x] Add a nav entry to the operator shell (match how `/clients`, `/jobs`, `/templates` are linked). Empty-state copy when no pending requests.
  - [x] Determine caching: operator surfaces — follow the existing convention (likely dynamic; check a sibling operator page). The queue must reflect live pending rows.

- [x] **Task 4 — Tests (`tests/*.test.ts`, Vitest) — one per AC + concurrency (AC1, AC2, AC3)**
  - [x] AC1: `listPendingRequests` returns only this owner's pending rows with client fields; excludes approved/declined and other owners.
  - [x] AC2 approve: a pending request → `commitBooking` creates ONE Job (capacity consumed), request → `approved`, client → `active`. Assert the Job exists with the right client/date.
  - [x] AC2 one-winner: seed a day at cap-1; two pending requests on that day; approve #1 → Job created, `approved`; approve #2 → `no-availability`, NO second Job, request #2 stays `pending`. (Fake `Date` to a fixed Monday for determinism; seed capacity settings.)
  - [x] AC2 idempotency: approve the same request twice → still ONE Job (idempotencyKey replay), still `approved`.
  - [x] AC3 decline: pending → `declined`, no Job, no capacity change; declining a non-pending request is a no-op.
  - [x] Owner isolation: another owner's request id cannot be approved/declined/read.
  - [x] `beforeEach` clears the relevant tables (job, pendingRequest, inquiry, capacitySettings, client, messageLog) in FK-safe order; reseed capacity settings for determinism.

## Dev Notes

### Reuse map (do NOT rebuild)
- **`commitBooking` (`lib/domain/capacity.ts`)** — THE one capacity-consuming insert (AD-2), with the week-scoped `pg_advisory_xact_lock`, cap re-check under lock, and idempotency replay (AD-12). Approve calls it; it already gives one-winner (AR4). Reasons: `day-maxed`, `week-full`. Do NOT re-derive caps or add a second lock.
- **`getOwnerId()` (session)** — operator surfaces resolve owner from the authenticated session; the queue is behind `proxy.ts` auth (NOT the public `app/book/**` surface). Contrast 4.2, which resolved owner from the public token.
- **`ok/fail/ActionResult` (`lib/domain/result.ts`)**, **`readFields`/`revalidatePath` patterns** — mirror `app/(operator)/clients/actions.ts`.
- **`formatDateKey` (`lib/domain/clock`)**, owner-scoped join pattern (`listJobs` in `queries.ts`).
- **`PendingRequest` + `client` tables** (Story 4.2). `pendingRequestStatus` enum = `pending|approved|declined|withdrawn`.

### Key decisions / gotchas
- **Approve when slot full:** commit fails → surface `no-longer-available`, KEEP the request `pending` (do not auto-decline — the operator decides). AC2 says "surfaced as no-longer-available," not auto-rejected.
- **Idempotency key** `approve:<pendingRequestId>` — deterministic per request, so a double-approve replays the same Job (like the `book:<client>:<date>` key in 3.2, but keyed on the request instance per the Epic-3 nonce-keying action item: key on the event instance, never a bare entity id — the request id IS the event instance here).
- **Status guard** prevents double transitions: `setPendingRequestStatus(..., from='pending', to=...)` matches zero rows if already moved — the concurrency backstop for the status field (the capacity backstop is `commitBooking`'s lock).
- **Promote provisional client → active on approve:** a real booking now exists; leaving it `provisional` would wrongly keep it out of the active book. Scope it owner+id.
- **Order:** commit first, then status flip + client promote. A failed commit must leave `status='pending'` and the client `provisional` (clean rollback of intent). If the status flip itself fails after a successful commit, the idempotencyKey means a retry re-commits to the same Job (no double consume) then flips — safe.
- **Fail direction:** operator surfaces may fail-open on pure reads (render unannotated) but the approve/decline WRITES fail-closed with a typed reason (AR15). No thrown error crosses the boundary.

### Scope boundaries
- Does NOT build the public submit (4.2, done) or manual inquiry logging (4.4). Does NOT add bulk approve, filters, or notifications (NFR7). Just: list pending, approve (→commit), decline.

### References
- [Source: epics.md#Story-4.3] (lines 588–606) — ACs; FR36 (l.29); AR4/AD-3 (l.101, one-winner); AR5/AD-4 (l.102); AR3/AD-2 (l.100, commitBooking is the only Job insert).
- [Source: lib/domain/capacity.ts] `commitBooking`; [Source: lib/db/queries.ts] `listJobs` join + `getClient` UUID guard; [Source: app/(operator)/clients/actions.ts] operator action pattern; [Source: lib/db/schema.ts] `pendingRequest`, `pendingRequestStatus`, `client`.

## Dev Agent Record

### Agent Model Used

claude-opus-4-8[1m] (dev delegated to subagent, independently verified by main)

### Completion Notes List

- Approve routes through `commitBooking` (the ONLY capacity path, AD-2); `override:false`; idempotencyKey `approve:<requestId>` (event-instance keyed). Decline never touches capacity. Owner from session `getOwnerId()`.
- **Review (4 lenses, no HIGH) — 3 findings fixed:** rewrote `approveRequest` to a race-safe, self-healing flow — (1) **elect the winner first** (guarded `pending→approved`) so a concurrent decline can never coexist with a committed Job (fixes phantom-booking race); (2) commit, and on capacity failure **roll status back to pending** so the request stays actionable; (3) promote the provisional client to `active` AFTER commit — a `status='approved'` **resume path** re-drives commit (idempotent, same Job) + promote, so a DB fault mid-sequence self-heals instead of stranding the client provisional; (4) map the slot-no-longer-bookable reasons (`day-maxed`,`week-full`,`date-past`,`non-working-day`) to a single `no-longer-available` banner instead of a misleading "try again".
- **Tests (11):** AC1 list/fields/exclusions/owner-isolation; AC2 approve→one Job+approved+client active, one-winner (loser → no-availability, no 2nd Job, stays pending), idempotent double-approve; AC3 decline; plus the 3 review-fix regressions (date-past & non-working-day → no-availability; self-heal re-approve promotes with one Job; decline-after-flip no-op).
- Verified independently: `tsc` clean, **277/277**, build green, `/requests` ƒ Dynamic. No migration (schema unchanged — reads/updates existing `pending_request`/`client`).

### File List

- `lib/db/queries.ts` (UPDATE) — `listPendingRequests`, `getPendingRequest`, `setPendingRequestStatus`, `PendingRequestListItem`.
- `app/(operator)/requests/actions.ts` (NEW) — `listOwnerPendingRequests`, `approveRequest` (race-safe/self-healing), `declineRequest`.
- `app/(operator)/requests/page.tsx` (NEW) — queue surface + zero-JS approve/decline + banners.
- `app/(operator)/page.tsx` (UPDATE) — `/requests` nav link.
- `tests/approval-queue.test.ts` (NEW) — 11 tests.

## Change Log

- 2026-07-18 — Story 4.3 implemented + Epic-4 adversarial/security review (no HIGH; 3 findings fixed: self-healing approve, one-winner-elect-first, banner accuracy). tsc clean, 277/277, build green. Status → done.
