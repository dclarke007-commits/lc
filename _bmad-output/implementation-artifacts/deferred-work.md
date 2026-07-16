# Deferred Work

## Deferred from: code review of story-1.2 (2026-07-15)

- **No length/format bounds on name/phone/address** — schema uses unbounded `text`; `readFields` only trims + checks non-empty. NFR7 specifies minimal rules, so acceptable for v1, but a max-length guard would prevent oversized-payload storage abuse via direct POST. [app/(operator)/clients/actions.ts:40-41]
- **No duplicate detection on create** — no unique constraint on `(owner_id, phone)` or idempotency key; double-submit/back-button re-POST creates duplicate client rows. Single-operator can spot dupes in the list; revisit if it becomes a real annoyance. [app/(operator)/clients/actions.ts:76-89]
- **Last-write-wins concurrency** — `editClient` writes `updatedAt` but never checks it as a precondition; two concurrent edits silently clobber. Fine for single-operator v1; add optimistic concurrency when multi-device edit lands. [app/(operator)/clients/actions.ts:114-124]
- **Read-path error asymmetry** — `listOwnerClients`/`getOwnerClient` call `getOwnerId()` with no try/catch, unlike the write path. On an un-seeded DB the raw throw reaches RSC render as a 500. Only reachable in a deploy-invariant violation (operator always seeded), so deferred. [app/(operator)/clients/actions.ts:52-61]

## Deferred from: code review of story-1.3 (2026-07-16)

- **zonedWallToUtc drops milliseconds when measuring offset** — offset is computed at whole-second precision (`Date.UTC(...second)` omits ms), so a caller passing `ms≠0` gets a result off by up to 999ms. Latent — every current caller passes `ms=0`. Fix when a sub-second boundary caller lands. [lib/domain/clock.ts:75-83]
- **Redundant non-unique `owner_id` index** — `capacity_settings_owner_id_idx` is fully covered by the unique `capacity_settings_owner_uq` on the identical single column; pure write-amplification. Dropping needs a new migration. [lib/db/schema.ts + drizzle/0003]
- **Clock helpers throw RangeError on unvalidated tz** — none of the exported clock functions validate `tz`; an unknown zone throws from Intl. Latent now (stored tz is validated at write). Ensure Story 1.4 and later consumers only pass the validated stored tz, or add a typed guard. [lib/domain/clock.ts:28]
- **Timezone free-text on phone-first surface** — `timezone` renders as `<input type="text">`; typing an exact IANA name on a phone is error-prone (invalid only surfaces after a round-trip). A zero-JS `<select>` of common zones better fits NFR1. [app/(operator)/settings/page.tsx]
