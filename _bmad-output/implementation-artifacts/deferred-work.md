# Deferred Work

## Deferred from: code review of story-1.2 (2026-07-15)

- **No length/format bounds on name/phone/address** — schema uses unbounded `text`; `readFields` only trims + checks non-empty. NFR7 specifies minimal rules, so acceptable for v1, but a max-length guard would prevent oversized-payload storage abuse via direct POST. [app/(operator)/clients/actions.ts:40-41]
- **No duplicate detection on create** — no unique constraint on `(owner_id, phone)` or idempotency key; double-submit/back-button re-POST creates duplicate client rows. Single-operator can spot dupes in the list; revisit if it becomes a real annoyance. [app/(operator)/clients/actions.ts:76-89]
- **Last-write-wins concurrency** — `editClient` writes `updatedAt` but never checks it as a precondition; two concurrent edits silently clobber. Fine for single-operator v1; add optimistic concurrency when multi-device edit lands. [app/(operator)/clients/actions.ts:114-124]
- **Read-path error asymmetry** — `listOwnerClients`/`getOwnerClient` call `getOwnerId()` with no try/catch, unlike the write path. On an un-seeded DB the raw throw reaches RSC render as a 500. Only reachable in a deploy-invariant violation (operator always seeded), so deferred. [app/(operator)/clients/actions.ts:52-61]
