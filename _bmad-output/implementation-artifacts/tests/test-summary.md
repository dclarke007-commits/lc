# Test Automation Summary — LovesCleaning

_Generated 2026-07-18 by `bmad-qa-generate-e2e-tests`. Both layers independently re-verified (tsc + full run) by the orchestrator, not trusted on subagent report._

Two layers were added on top of the existing 33-file Vitest unit suite:

1. **Integration (Vitest, DB-backed)** — multi-step **cross-action flow sequences** that span several server actions / domain functions end-to-end at the data layer. Deliberately does **not** duplicate the single-action logic the 33 unit tests already cover.
2. **E2E (Playwright, chromium)** — real-browser happy paths driven through the live UI against a booted `pnpm dev` server + seeded Docker Postgres.

## Generated Tests

### Integration — `tests/integration/` (4 files, 9 cases)
- [x] `public-booking-flow.test.ts` (2) — public request → `listPendingRequests` → `approveRequest`→`commitBooking` → `markCompleted` → `markPaid`; provisional→active client, pending→approved, request-holds-no-capacity → Job-consumes-slot; + two same-day submits at cap-1 (first approval wins, second `no-availability`).
- [x] `operator-booking-lifecycle.test.ts` (3) — `authenticateOperator` → `createClient` → `commitBooking` → `markCompleted`/`markCancelled` → `markPaid`; dashboard derives (weekCapacity, roomLeft, dayMaxed, monthlyRevenue, outstanding) track each transition; per-day cap + FR39 override; cancel-frees-slot.
- [x] `rebooking-winback-flow.test.ts` (2) — completed basis → `getWinBackDraft` (gone-cold) → `sendWinBack` (idempotent dispatch) → `ensureClientToken` → `confirmBookingResult` (token rebook → new Job) → derive re-fires; nudge holds no capacity.
- [x] `ledger-export-flow.test.ts` (2) — `commitBooking`×3 across paid/owed/booked → `exportJobsCsv`/`exportClientsCsv` reflect state; CWE-1236 formula-injection guard neutralizes a `=cmd,inject` client name in both exports.

### E2E — `tests/e2e/` (4 specs + 1 auth setup)
- [x] `public-booking.spec.ts` (no auth) — `/book/<token>`: fill name/phone/address, pick offered day, submit → confirmation visible.
- [x] `operator-dashboard.spec.ts` (auth) — dashboard capacity visible → create booking (`/bookings` → "Booked.") → mark completed (`/jobs` → "Updated.").
- [x] `rebooking.spec.ts` (auth) — `/jobs` rebook control on completed job → "Rebooking proposal" + proposed slot + send affordance.
- [x] `ledger-export.spec.ts` (auth) — dashboard "Export jobs (CSV)" → `download` event fires with `.csv`.
- Infra: `playwright.config.ts` (chromium, `pnpm dev` webServer, setup→operator/public projects), `tests/e2e/global-setup.ts` (seed + clean-slate + mint public token → `.state/e2e-state.json`), `tests/e2e/auth.setup.ts` (one real UI sign-in → storageState).

## Coverage
- 4 target flows (public self-booking · operator dashboard+booking · rebooking+win-back · ledger+CSV export): **all covered across both layers.**
- Vitest: **37 files, 364 tests passed / 0 failed** (was 355; +9). tsc clean.
- Playwright: **5 passed / 0 failed** (~17s), dev server boots via Turbopack.

## Findings surfaced by E2E (real gaps, not test defects)
1. **`markJobPaid` has no UI.** The action exists in `app/(operator)/ledger/actions.ts` but is wired to no page/control. E2E seeds a paid job and drives only the reachable CSV export. → Product gap: mark-paid is currently unreachable from the browser.
2. **Rebooking send is an external deep link** (`wa.me`/`sms:`); no network in sandbox, so the spec asserts the dispatch-ready draft state rather than following the external link. Expected boundary.

## Coverage boundaries (documented in-file, not faked)
- Integration flow 2: `signIn`'s `cookies().set` half is not callable outside a Next request scope; the auth core (`authenticateOperator`) is exercised instead. E2E covers the real cookie sign-in.
- Integration flow 3: historical past-completed lapse basis inserted directly (`commitBooking` legitimately refuses past dates), matching the existing win-back unit test.

## How to run
```bash
pnpm test                    # Vitest unit + integration (needs Docker Postgres up)
pnpm exec playwright test    # E2E (auto-boots pnpm dev; needs Docker Postgres up)
```

## Next Steps
- Wire `markJobPaid` to a UI control, then extend `ledger-export.spec.ts` to drive mark-paid through the browser.
- Add these to CI (Vitest job + Playwright job with a Postgres service).
- Add error-path E2E (invalid token, capacity-full day) as coverage deepens.
