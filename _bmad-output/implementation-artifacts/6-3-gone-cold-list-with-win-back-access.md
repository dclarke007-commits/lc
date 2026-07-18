<!-- Powered by BMAD-CORE™ -->

# Story 6.3: Gone-cold list with win-back access

**Status:** done

## Story

As the operator,
I want the cold regulars listed with a direct win-back,
So that acting on a lapse is one tap from the dashboard.

## Acceptance Criteria

**AC1 — Cold clients listed with direct win-back**
**Given** gone-cold clients (from Story 3.5)
**When** the dashboard renders
**Then** they are listed with direct access to the win-back action from Story 3.6 (FR23).

## Tasks / Subtasks

- [x] **Task 1 — Pure selection derive** — `goneColdList(clients, today)` in `lib/domain/derive.ts`: every client gone-cold now (reuse `goneCold`/`expectedNextDate`, Story 3.5), longest-overdue first, carrying `{ id, name, expectedNextDate }`.
- [x] **Task 2 — Dashboard action** — `getGoneColdList()` in `app/(operator)/actions.ts`; SHARED cached reads with the other dashboard actions; FAIL-OPEN to `[]` on a derivation throw so a bad timezone never 500s the dashboard.
- [x] **Task 3 — Surface** — a "Gone cold · win them back" section in `app/(operator)/page.tsx`; each row links to `/clients?winback=<id>` (the existing Story-3.6 panel). Empty state shows the positive "no regulars cold" message.
- [x] **Task 4 — Tests + gate** — `tests/derive.test.ts`: sort order (longest-overdue first), non-cold/one-time exclusion, empty. `vitest`/`tsc`/`next build` green.

## Dev Notes

### Reuses the win-back panel; adds no authorization

The Story-3.6 win-back already lives at `/clients?winback=<id>` and **re-derives the gone-cold gate server-side on the tap** (`deriveWinBack` → `goneCold`; a hand-typed `?winback=<activeClientId>` yields `not-gone-cold`). So 6.3 is pure surfacing: the dashboard `goneColdList` derive SELECTS + ORDERS the cold set and the surface LINKS to that panel. The list is a convenience, never a credential — the gate is enforced where the send happens, not by trusting this list.

### Ordering decision

Longest-overdue first (oldest missed `expectedNextDate` first): the most-neglected regular surfaces at the top. The FRESH-lapse subset (missed within 7 days) is the separate 6.2 `caughtColdThisWeek` count; this list is the full act-now set, not just the fresh ones.

### Architecture guardrails

- **AD-7 / AD-13** — pure derive; action is the only domain+db seam; page imports only `./actions`; `dynamic = 'force-dynamic'` stays.
- **AR9** — owner-scoped reads (`listJobsForMetrics` / `listClients`), shared via request-scoped `cache()`.
- **Fail-open** — the gone-cold panel is secondary; a derivation throw renders it empty (logged) rather than taking the dashboard down (mirrors `listOwnerClientsWithLapse`). Owner-unresolved still fails loud (deploy invariant).

### Scope boundaries (held)

- 6.3 = the list + link only. **CSV export** is Story 6.4.

## Dev Agent Record

### Agent Model Used
claude-opus-4-8[1m]

### Completion Notes List
- `goneColdList` pure derive + `getGoneColdList` action + dashboard section linking each cold regular to the existing win-back panel.
- **Verification**: tsc clean, 336/336 tests (2 new for 6.3), `next build` green.

### File List
- `lib/domain/derive.ts` (goneColdList + LapseClient/GoneColdRow types)
- `app/(operator)/actions.ts` (getGoneColdList)
- `app/(operator)/page.tsx` (gone-cold section)
- `tests/derive.test.ts` (2 new tests)

### Change Log
- 2026-07-18: Story 6.3 implemented, all gates green. Status → done.
