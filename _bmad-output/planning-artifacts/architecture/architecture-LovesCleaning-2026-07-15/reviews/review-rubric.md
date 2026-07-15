# Spine Rubric Review — LovesCleaning

- **Spine:** `ARCHITECTURE-SPINE.md` (initiative altitude, server-first full-stack)
- **Reviewed:** 2026-07-15
- **Verdict:** **PASS with fixes** — a lean, well-targeted spine that nails the real concurrency/capacity/token divergence points; two concrete gaps must be closed (NFR3 latency has no home; observability is a near-silent dimension).

---

## Checklist

**1. Fixes the real divergence points for features, misses none — PASS**
The nine ADs land on exactly the forks that would otherwise splinter: sole write path (AD-1), single capacity owner (AD-2), exactly-one-winner concurrency (AD-3), queue-holds-no-capacity (AD-4), compose≠deliver seam (AD-5), token-as-capability (AD-6), derive-on-read (AD-7), tenancy seam (AD-8), one-clock schedule math (AD-9). These are the genuine "two units will disagree" points for a booking + leak-detector engine. Nothing obviously fork-worthy is left un-fixed.

**2. Every AD's Rule is enforceable and prevents its stated divergence — PASS**
Rules are concrete and mechanically checkable: single-function capacity insert (AD-2), lock-inside-transaction with caps re-evaluated inside (AD-3), consume-at-approval / first-approval-wins (AD-4), `MessageDraft` decoupling (AD-5), signed-unguessable-token scoping (AD-6), no-stored-derived-flags (AD-7), `owner_id` on every row (AD-8), UTC-store/local-compute (AD-9). AD-3 offers a choice (advisory lock on `owner_id` OR `SELECT … FOR UPDATE`) — this is appropriate latitude, not vagueness: either mechanism enforces the invariant. Each rule directly negates its stated divergence.

**3. Nothing under Deferred could let two units diverge — PASS**
Every deferred item is either fully out of scope (card processing, native app) or explicitly held behind a seam that keeps the decision single-sourced: autonomous send behind AD-5's adapter, multi-cleaner behind AD-8's `owner_id`, materialized metrics behind AD-7. The two *open* PRD questions (CSV-export sufficiency OQ-4; capacity defaults Mon–Sat/3-per-day OQ-1) cannot cause divergence because the per-day cap is a single operator-editable config read through the one `commitBooking` owner, and the weekly-14 ceiling is fixed in AD-2/AD-9.

**4. Named tech is current (note only — separate reviewer web-verifies) — PASS (note)**
Stack is explicitly labeled "Seed — web-verified current at 2026-07-15; the code owns this once it exists." Named: TypeScript 5.x, Next.js 16.x (App Router/Server Actions/RSC), React 19.x, Postgres 16+, Drizzle latest, Vercel. **Note for the web-verifier:** confirm Next.js 16.x is GA/stable (not RC) at review date and that Server Actions + RSC APIs referenced are stable in 16.x; React 19.x pairing is consistent. No action here — flagged per instructions.

**5. Covers the driving spec's capabilities (FR1–41, NFR1–7) — PARTIAL**
- **FRs: complete.** The Capability→Architecture map covers FR1–41 with no gap (FR1–2, 3–8, 9, 10–13, 14–18, 19–21, 22–25, 26–28, 29–32, 33–35, 36–37, 38–41 — all 41 accounted for).
- **NFRs: two weak/absent.**
  - NFR1 (phone-first) ✓ paradigm/surfaces. NFR4 (no double-book) ✓ AD-2/3/9. NFR5 (durability/export) ✓ Structural Seed backups + FR35 action. NFR6 (security/tokens) ✓ AD-6. NFR7 (simplicity) ✓ AD-7 + Deferred discipline.
  - **NFR3 (Fast — interactive views <~2s on 4G): NO HOME.** Not referenced by any AD, convention, or the map. It is also in latent tension with AD-7 (compute all dashboard metrics on every read): the spine defers materialization "only if read-time derivation stops being cheap at scale," which acknowledges the risk but sets no budget, no measurement seam, and no invariant. This is the sharpest miss.
  - **NFR2 (Zero client friction — no app/account, <~60s booking): implicit only.** The "no account / no client login" half is carried by AD-6 and `app/book/[token]`; the latency/friction budget half is unbound (same root cause as NFR3).

**6. Every dimension the initiative altitude owns is decided/deferred/open — PARTIAL**
- Deployment / environments / infra-provider / backups — **decided.** Structural Seed: Vercel preview+prod, managed Postgres (Neon/Supabase), backups = NFR5, secrets via Vercel env, "no self-hosted infra." Strong.
- Auth — **decided.** AD-6 + Conventions (operator = session; client = token bearer).
- Error handling — **decided.** Conventions: typed `{ok,data} | {ok:false,reason}`, no thrown errors cross the action boundary, machine reasons (`day-maxed`|`week-full`).
- Data migration / seeding — **mostly silent.** Drizzle implies migrations, but there is no statement on migration ownership or on seeding the single operator/`owner_id` row that every AD-8 FK depends on. Low-risk at this altitude, but the seed of the one operator row is an unstated precondition of the whole tenancy model.
- **Observability / logging — near-silent (the one genuinely under-covered dimension).** The only logging invariant is dispatch logging at the compose→deliver boundary (AD-5/FR21) — that is message-audit, not operational observability. No decision (or explicit deferral) on application error logging, request/latency monitoring, or how NFR3/NFR4 failures would be *seen* in production. Either decide a minimal posture (e.g., "Vercel/platform logs only in v1; no app-level telemetry") or explicitly defer it — right now it reads as an accidental omission rather than a choice.

**7. Diagrams are valid mermaid and non-empty — PASS**
Three mermaid blocks, all non-empty and syntactically valid: the invariant/dependency `graph TD`, the deployment `graph LR`, and the `erDiagram`. The source tree is a fenced `text` block (correct). Minor note (non-blocking): in `graph TD`, `C[compose]` appears as a fresh node feeding `DL` even though compose is also named inside the `D[lib/domain: capacity · derive · compose]` node — cosmetically redundant but renders fine and does not affect validity.

---

## Over-specification check (NFR7 simplicity — seed masquerading as invariant?)

The spine is commendably lean; the Stack is correctly quarantined as "Seed." One item to watch:

- **Default job price `20000` (=$200), USD** in Conventions. The *money representation* (integer cents, USD) is a legitimate invariant (prevents float/unit divergence — keep). The specific **$200 default value** is a seed/config default, not an architectural invariant; it belongs in config/PRD, not the spine. Low stakes — recommend demoting to "operator-editable default (see PRD)" rather than pinning a number in the invariant layer.
- AD-3's dual lock option and the Stack seed are *correctly* latitude, not over-spec — no change.

No other invariant reads as a disguised seed. Enum sets (cadence/status/completion/payment) are true divergence points and rightly fixed.

---

## Top gaps (ranked)

1. **NFR3 (Fast, <2s/4G) has no home** and sits in unmanaged tension with AD-7's compute-on-read. Add at least a note: a latency budget or a "derive stays O(cheap) per render; re-evaluate materialization at threshold X" invariant, so features don't each invent their own caching.
2. **Observability/logging is a silent dimension.** Decide or explicitly defer app-level error/latency logging (message-dispatch logging alone does not cover it).
3. **NFR2's friction/latency half is only implicit** — folds into fix #1; confirm the no-account path (AD-6) is treated as the NFR2 home in the map.
4. **Data seeding of the single operator/`owner_id` row** is an unstated precondition of AD-8 — one line would close it.
5. **Minor:** demote the `$200` default out of the invariant layer (NFR7); cosmetic `compose` node duplication in `graph TD`.

**File:** `reviews/review-rubric.md`
