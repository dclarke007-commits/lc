<!-- Powered by BMAD-CORE™ -->

# Story 6.4: CSV export

**Status:** done

## Story

As the operator,
I want to export my clients and jobs,
So that I own my data, not rent it.

## Acceptance Criteria

**AC1 — Server Action streams the owner's rows as CSV**
**Given** a signed-in operator
**When** I request an export
**Then** a Server Action streams the owner's client and job rows as CSV (FR35, AR17).

**AC2 — Owner-scoped only**
**Given** the export
**When** it runs
**Then** it returns only rows scoped to my `owner_id` (FR35, AR9).

## Tasks / Subtasks

- [x] **Task 1 — Pure serializer** — `lib/domain/csv.ts`: `escapeCsvField` (RFC-4180 quote-wrap + double-quote escaping) + `toCsv(headers, rows)` (CRLF-terminated). Isolated so the escaping is unit-proven.
- [x] **Task 2 — Owner-scoped export query** — `listJobsForExport(ownerId)` in `lib/db/queries.ts` (id, client_name, date, completion, payment, price_cents, timestamps); owner-scoped on job filter AND client join (AR9). Clients reuse `listClients`.
- [x] **Task 3 — Export Server Actions** — `exportClientsCsv()` / `exportJobsCsv()` in `app/(operator)/export/actions.ts`; owner resolved fail-closed to the AR15 contract; date-stamped filename in operator tz.
- [x] **Task 4 — Download trigger** — `ExportButtons.tsx` client component (Blob + transient anchor). Wired into an "Own your data" dashboard section.
- [x] **Task 5 — Tests + gate** — `tests/csv.test.ts` (10 tests: comma/quote/newline/null/number escaping, column-shift safety, CRLF). `vitest`/`tsc`/`next build` green.

## Dev Notes

### "Streaming" (AR17) interpretation

v1 is a single operator with modest row counts, so the action materializes the full CSV string and hands it to the client, which triggers a browser download. A true chunked stream would be a Route Handler; not needed yet. This keeps the export a Server Action (AR17) with SQL confined to `lib/db` (AD-1) and serialization to `lib/domain/csv` (AD-7).

### Owner-scoping (AR9/AC2)

Both reads are owner-scoped on the VALUE: `listClients` filters `client.ownerId`; `listJobsForExport` filters `job.ownerId` AND joins `client` on `client.ownerId` — no other tenant's row is reachable. Owner resolved fail-closed (AR15): a user-triggered export never surfaces a raw 500; it returns a reason the UI shows.

### CSV correctness (the load-bearing bit)

`escapeCsvField` quote-wraps any field containing a comma, double-quote, CR, or LF and doubles internal quotes — so a client name `Doe, Jane` or a multi-line address never shifts downstream columns. `null` → empty field (never the literal "null"). Integer `price_cents` serialize exactly (no float formatting). Proven in `tests/csv.test.ts`.

### Architecture guardrails

- **AD-1** — only `lib/db` speaks SQL; the action calls the query, never inline SQL.
- **AD-7** — `csv.ts` is pure (no db, no framework, no `Date.now()`); the filename date is stamped in the action via `localDateKey`.
- **AR15** — `{ ok, data } | { ok, reason }`; no thrown error crosses the action boundary.

## Dev Agent Record

### Agent Model Used
claude-opus-4-8[1m]

### Completion Notes List
- Pure `csv.ts` serializer + `listJobsForExport` owner-scoped query + two export Server Actions + `ExportButtons` client download trigger + dashboard "Own your data" section.
- **Verification**: tsc clean, 346/346 tests (10 new csv), `next build` green.

### File List
- `lib/domain/csv.ts` (escapeCsvField, toCsv) — new
- `lib/db/queries.ts` (listJobsForExport + JobExportRow)
- `app/(operator)/export/actions.ts` (exportClientsCsv, exportJobsCsv, CsvExport) — new
- `app/(operator)/export/ExportButtons.tsx` (client download trigger) — new
- `app/(operator)/page.tsx` ("Own your data" section)
- `tests/csv.test.ts` (10 tests) — new

### Change Log
- 2026-07-18: Story 6.4 implemented, all gates green. Status → done.
