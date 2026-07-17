# Reconciliation Review — PRD → Architecture Spine

**Scope:** finalized PRD + addendum vs. ARCHITECTURE-SPINE.md
**Question asked:** what did *not* land in the spine — especially quiet requirements (tone, constraint, guardrail) the AD structure may have dropped.
**Date:** 2026-07-15
**Reviewer stance:** report only gaps and under-serves; silent on what landed cleanly.

---

## Verdict: **GAPS**

The spine's paradigm, capacity ownership (AD-2/3/4), concurrency (NFR4), token model (AD-6), messaging seam (AD-5), tenancy seam (AD-8), and clock discipline (AD-9) all land the PRD faithfully. But the **measurement layer is under-specified against the metric definitions it claims to bind**, and **three NFRs have no architectural stance**. The most serious gap is that the north-star metric — the single most important number in the product — **cannot be computed exactly as the addendum specifies it** from the entity model as stated.

Findings are ordered most-severe first.

---

## G1 — North-star repeat-booking rate is NOT exactly computable from the stated entity model `[HIGH]`

**PRD/addendum:** Addendum F defines repeat-booking rate as: of jobs **completed** in a rolling 30-day window, the share for which the **same client has a subsequent booking created within 30 days of that job's completion date**. Denominator = completed jobs in the window; numerator = those with a qualifying follow-on booking by the same client.

**Spine claim:** AD-7 binds "metric defs (addendum F)" and asserts `derive` computes repeat-rate on read "from canonical Client/Job rows on every render." So the spine *promises* this computation.

**Gap:** The computation depends on two timestamps that the spine's entity model and Conventions do **not** surface:

1. **Booking *creation* timestamp (`Job.createdAt`).** The metric qualifies a follow-on by when the booking was *created* ("created within 30 days"), not by its scheduled service date. The spine's Conventions list generic "Timestamps stored UTC ISO-8601" but never pin a creation timestamp on Job; addendum D lists `created-at` on **Client only**, not Job. Without `Job.createdAt`, `derive` must fall back to the follow-on's scheduled `date`, which is a *different metric* — a client rebooked today for a slot 6 weeks out would be scored differently under the two readings.
2. **Completion timestamp (`Job.completedAt`) distinct from scheduled `date`.** The metric anchors on "that job's completion date." FR40 makes "mark completed" an explicit operator transition that can occur on a different day than the scheduled `date` (and reschedule, FR41, moves `date`). The spine records `completion: booked|completed|no-show|cancelled` as a *status enum* but does not record *when* the transition happened.

**Why it slipped:** The spine defers attributes to `lib/db` ("only invariant-bearing ones are ADs"). But these two timestamps ARE invariant-bearing — they are load-bearing for the north-star and for the exact definitions in addendum F. AD-7 asserts the derivation without the schema conventions guaranteeing the inputs exist. This is a binding asserted but not substantiated.

**Fix direction:** Elevate `Job.createdAt` and `Job.completedAt` to Conventions (or an AD note on AD-7) as required, non-null-on-transition fields. Note that `expectedNextDate` (FR16) can use `date`, but the north-star cannot.

---

## G2 — Counter-metrics (overbooking rate, nudge fatigue) are architecturally homeless `[HIGH]`

These are the PRD's **guardrails against gaming the north-star** (§2) — precisely the quiet, easily-dropped requirement class. The spine drops them in two ways:

**(a) Overbooking rate — missing persistence field.** §2 + FR39: an override booking "is recorded as such and counts toward the overbooking counter-metric." Overbooking rate = jobs accepted beyond a day's cap or the weekly 14. To compute it, a Job must carry a **persisted boolean marking it as an over-cap/override booking**. The spine handles the *write mechanics* well — AD-2 makes the FR39 override "a boolean argument into `commitBooking`, never a separate insert path" — but that boolean is a **function argument, not a persisted column**. Neither the Conventions table (`Job.completion`, `Job.payment` only) nor addendum D's Job shape carries an `overridden`/`overCap` flag. As stated, the override is enforced but not *recorded*, so overbooking rate is not computable. FR39's "recorded as such" is under-served.

**(b) Neither counter-metric is bound to `derive`.** AD-7's binding list is FR16, FR17, FR22, FR23, FR24, FR26, FR27, FR30 + "metric defs (addendum F)." The two counter-metrics live in PRD **§2, not addendum F**, and are not FRs — so they fall outside every AD-7 binding and outside the dashboard FRs (FR22–25). Nudge fatigue's *data* is capturable (MessageLog carries client-ref, type, timestamp — sufficient for "messages per client per week"), but no AD assigns the metric's computation a home, and the dashboard is not told to surface it. Overbooking lacks both the field and the home.

**Fix direction:** Add an `overridden` boolean to Job in Conventions; extend AD-7 (or add a note) to bind the §2 counter-metrics explicitly so `derive` owns them the way it owns the leak indicators.

---

## G3 — NFR2 (speed dimension) and NFR3 (<2s on 4G) have no architectural stance `[MEDIUM]`

**Bound NFRs:** NFR1→AD-1, NFR4→AD-2/AD-3/AD-9, NFR5→structural seed (managed-Postgres backups), NFR6→AD-6.

**Unbound:** NFR2 and NFR3 (and NFR7 — see G4).

- **NFR2 "zero client friction, <60s booking":** The *no-account* half is served by AD-6 (token, no login). The **<60s / zero-friction performance** half has no stance — no statement about round-trip count in the booking flow, no payload budget, no "booking surface is minimal."
- **NFR3 "<2s on 4G":** Completely silent. No caching strategy, no payload/latency budget, no edge/CDN posture beyond naming Vercel as host. Notably, the chosen paradigm — **server-first RSC with Server Actions as the *only* data path** — is exactly the area where a mobile-data latency target needs an explicit position (streaming, static shell for the public booking view, cache posture for read-heavy availability). The spine neither leverages nor addresses this tension. A pure server-round-trip model on 4G is where a <2s target is won or lost, and the spine is quiet.

**Fix direction:** Add an AD (or NFR-budget note) taking a position on the public booking surface's load path and a latency/payload budget; at minimum acknowledge NFR3 as an accepted constraint on the RSC data path rather than leaving it silently dropped.

---

## G4 — NFR7 simplicity-as-a-defect-gate is only half-reflected `[MEDIUM]`

NFR7 has two faces: (a) an *implementation* simplicity preference, and (b) a *governance gate* — "No feature ships that doesn't touch a named leak or a capacity/cash decision. Scope creep is a defect."

- Face (a) **lands**: AD-7 ("no stored derived flags, no cron, no background job") and the Deferred section are scope discipline in action; the Capability→Architecture map traces every FR to a home.
- Face (b) **does not land as a rule**: NFR7's *defect gate* — the enforcement stance that any unit/feature not tracing to a named leak is rejected — is never elevated to an invariant. AD-7 references NFR7 only for derivation simplicity. There is no rule a downstream builder can point to that says "this new surface has no leak → reject." For a spine whose whole job is to keep everything built from it consistent, the one governance guardrail the PRD names as a *defect classification* is left implicit.

Relatedly, **FR25's "exclude vanity metrics; every dashboard element must map to a leak or a capacity/cash decision"** is a tone/constraint that the spine gestures at (derive owns dashboard metrics) but does not encode as a filter — the exclusion principle itself isn't stated.

**Fix direction:** Add a short invariant capturing NFR7-(b) as a build-time gate (e.g. "AD-0: every surface/action traces to a named leak or capacity/cash decision; untraceable scope is a defect"), giving downstream units something enforceable.

---

## G5 — FR13 "whether the nudge resulted in a booking" has no attribution linkage `[LOW]`

FR13: "record whether a rebooking nudge was sent **and whether it resulted in a booking**." The spine's MessageLog captures the *sent* half (client-ref, type, timestamp; dispatch logged at the compose→deliver boundary, AD-5/FR21). The **"resulted in a booking"** half requires attributing a subsequent Job to a preceding nudge — no linkage (e.g. MessageLog→Job reference, or a documented time-order inference rule) is modeled.

Note: the *aggregate* one-time→repeat conversion (addendum F) is defined without needing per-nudge attribution, so the headline metric survives. But FR13's literal record-keeping ("whether it resulted in a booking") is under-served. Minor, but it is the kind of quiet "and also" that the PRD's reader-note explicitly warned implementers about.

**Fix direction:** Either add a MessageLog→resulting-Job attribution field, or state the inference rule `derive` will use, or downscope FR13 explicitly.

---

## Items checked and found FAITHFUL (no action)

- **Double-book / NFR4:** AD-2 (single `commitBooking` owner) + AD-3 (Postgres lock, caps re-evaluated inside the locked txn) directly serve NFR4 and FR9. Strong.
- **Approval queue holds no capacity (FR6/FR36):** AD-4 matches the PRD and addendum C precisely, including first-approval-wins.
- **No autonomous send guardrail (FR19):** covered by AD-5, Conventions (Messaging row), and Deferred — the "system does not send autonomously in v1" constraint is well protected, and the compose≠deliver seam preserves the addendum B "keep composition decoupled from delivery" instruction.
- **Token capability / no client login (FR3, FR4, FR34, NFR6):** AD-6 is faithful, including QR→public-token (FR5).
- **Tenancy seam (Vision):** AD-8 plants `owner_id` without building multi-tenant logic — matches PRD §8/Vision and addendum E.
- **Clock/timezone (FR1 Mon–Sun local, FR16/FR17 cadence math):** AD-9 is faithful.
- **No-show vs cancelled capacity semantics (FR40 vs FR41):** Job.completion enum distinguishes `no-show` (slot stays consumed) from `cancelled` (capacity released) — consistent with the PRD.
- **Data ownership / durability (FR35, NFR5, OQ-4):** CSV export Server Action + managed-Postgres backups; OQ-4 correctly left open.

---

## Summary table

| ID | Item | Severity | Nature |
| --- | --- | --- | --- |
| G1 | North-star not exactly computable — missing `Job.createdAt` (booking-created time) and `Job.completedAt` | HIGH | Data model insufficient for a metric AD-7 claims to compute |
| G2 | Counter-metrics dropped — no `overridden` flag on Job; neither overbooking nor nudge-fatigue bound to `derive`/dashboard | HIGH | Quiet guardrail (§2) unhomed |
| G3 | NFR2 speed + NFR3 (<2s/4G) have no architectural stance | MEDIUM | NFR silently dropped |
| G4 | NFR7 defect-gate (scope-creep-is-a-defect) + FR25 vanity-exclusion not encoded as a rule | MEDIUM | Governance constraint half-reflected |
| G5 | FR13 "resulted in a booking" attribution not modeled | LOW | Literal FR "and also" under-served |

**Bottom line:** the spine is structurally sound on the transactional core but thin on the **measurement contract**. Two of the five metric families it is responsible for (the north-star's exact form, and both counter-metrics) are not fully computable from the entity model and bindings as written, and the PRD's quiet guardrails (counter-metrics as anti-gaming, NFR7 as a defect gate, NFR3 as a hard latency target) are the specific things that thinned out.
