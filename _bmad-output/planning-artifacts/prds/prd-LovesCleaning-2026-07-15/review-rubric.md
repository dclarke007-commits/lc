# PRD Quality Review — LovesCleaning v1

## Overall verdict

This is a strong, well-disciplined PRD: a clear thesis (a leak detector, not field-service SaaS), honest trade-offs, thresholded NFRs, and an FR set that is mostly atomic and testable — exactly the shape a solo operator building with AI agents needs. What holds up: strategy, scope honesty on the things it chose to exclude, and the approval/capacity concurrency design (FR6/FR9/FR36), which is genuinely well thought through. What's at risk: the PRD specifies the *client-link* booking flow completely but never gives the **operator** a way to create a booking or client directly, and it never defines **marking a job complete** — the state transition half the downstream FRs depend on. Those two gaps, plus a TBD window on the north-star metric and a total absence of cancellation, are implementation blockers an agent would hit on day one. Fixable, but they must be fixed before build.

## Decision-readiness — strong

Decisions are stated as decisions, not buried. §7 Out is a real exclusions list with rationale pointers; the addendum (A) records what was rejected and why (card processing, auto-send, native app, time-slot scheduling) so they aren't re-litigated. Open Questions are genuinely open (OQ-1 capacity defaults, OQ-4 export sufficiency) and the resolved ones (OQ-2, OQ-3, inquiry capture) are marked resolved with the FR that settled them. The approval-queue trade-off ("a small operator-facing 'slot just filled' moment for zero stranger-held phantom reservations," addendum C) is the kind of named trade-off the rubric rewards.

### Findings
- **low** Overbooking counter-metric has no decision behind it (§2) — see Strategic coherence; it reads as a guardrail for a scenario FR9 forbids, so the decision-maker can't act on it. *Fix:* either add the manual-override FR that makes overbooking possible, or drop the counter-metric.

## Substance over theater — strong

No persona theater: three audiences, one of them explicitly deferred, each driving real requirements (client audience → no-app/no-account, which becomes NFR2 and FR34). NFRs carry product-specific thresholds (≤60s client booking, ~2s interactive on 4G, never-double-book) rather than "scalable/secure/reliable" boilerplate. NFR7 ("scope creep is a defect") is an earned constraint, not furniture, and it's actually enforced by FR25. Vision is specific to this business (franchise-in-a-box, compounding owned client-history moat), not swappable boilerplate.

### Findings
_None. This dimension is clean._

## Strategic coherence — strong

The thesis — *stop losing bookings already within reach* — is stated and the feature set follows from it: three named leaks (inquiry, rebooking, lapse) plus a payment leak, each mapped to a capability group. Success metrics validate the thesis (repeat-booking rate as north-star, not DAU/vanity), and counter-metrics exist. One coherence crack:

### Findings
- **medium** Overbooking counter-metric measures an event the system prevents (§2 vs FR9) — FR9 forbids *confirming* beyond the per-day cap or weekly 14, so "jobs accepted beyond cap" is zero by construction. Either a required capability is missing (operator manual-booking that can exceed cap — see Done-ness) or the metric is vestigial. *Fix:* if manual/override booking is in scope, add the FR and the metric measures its use; otherwise remove the counter-metric so it doesn't imply a capability that doesn't exist.
- **medium** One-time cadence undercuts the rebooking thesis (FR10, FR15, FR16) — FR10 proposes "the client's next open slot consistent with their cadence," but a `one-time` client has no cadence interval and FR16 computes expected-next only for "regular" clients. The one-time→repeat conversion is the core of the rebooking leak, yet the rebooking action's behavior for a one-time client is undefined. *Fix:* specify what slot FR10 proposes for a `one-time` client (e.g., "next open working day" with no cadence math), so the thesis's headline conversion is actually reachable.

## Done-ness clarity — thin

This is the weak dimension and the reason the gate is not a clean pass. Most FRs are admirably atomic and testable (FR2, FR9, FR26, FR27 each have a verifiable consequence). But several load-bearing state transitions and one core metric are undefined, and an agent implementing literally would stall.

- **No operator-initiated booking or client-creation path.** Every booking-creation FR is client-link-driven: FR6 (public link → provisional record + pending request), FR7 (per-client link → confirmed). There is **no FR** for the operator to create a booking or a client directly. Yet the current dominant channel is the phone (§1, UJ-4 "a caller asks for Thursday," UJ-5), and the operator must seed the existing 5 regulars. FR37 logs a phone *inquiry* but explicitly does not create a booking or client. So the phone caller in UJ-4 has no path from "offer Friday" to a recorded job. For a phone-first product this is a launch blocker.
- **No "mark job complete" FR.** FR12 ("after a job is marked complete"), FR16 ("last completed job"), FR13, FR29/FR32 all depend on a completion transition, and the addendum data model has `completion-status` — but no FR governs the operator marking a job done. Lapse detection, the post-job nudge, and the ledger all hang off a transition that isn't a requirement.
- **North-star metric is not buildable as written.** Repeat-booking rate (§2) is "share of completed jobs that lead to a rebooking"; addendum F pins the window as "TBD — suggest 30 days" and never defines *when* a completed job "leads to" a rebooking (ever? within the window? same client only?). The single most important number on the dashboard cannot be implemented from this spec.

### Findings
- **critical** No operator-initiated booking / client-creation capability (§5.1, gap vs UJ-4/UJ-5, §1) — the phone channel, which is today's primary channel and the seed path for existing regulars, has no way to record a booking or create a client; all creation FRs are client-link-initiated. An agent building literally ships a product the operator cannot use for phone callers. *Fix:* add FRs for "operator creates a client record" and "operator books a job directly" (with cap behavior specified — see overbooking metric), and reconcile with FR6/FR7.
- **high** No FR defines marking a job complete (FR12/FR13/FR16/FR29/FR32 all depend on it) — the completion transition is referenced five times and modeled in the addendum but never required. *Fix:* add an FR: "The operator shall mark a job complete, which sets completion status and enables payment-status entry and rebooking-nudge surfacing."
- **high** North-star metric window and "leads to a rebooking" undefined (§2, addendum F) — window is "TBD"; attribution ("leads to") has no time bound or same-client rule. Not buildable. *Fix:* define the rolling window (pick one, not "suggest 30 days") and the attribution rule: a completed job counts if the same client has a subsequent booking created within N days of completion.
- **medium** Payment-status lifecycle vs. future bookings undefined (FR29, FR30) — FR29 records paid/owed "per job," but a confirmed *future* booking has no meaningful payment state; if future jobs default to `owed` they inflate the outstanding balance (FR22/FR30). *Fix:* state that payment status applies only to completed jobs, and that the outstanding total (FR30) counts completed-and-owed jobs only.
- **medium** "Calendar week" boundary and start-of-week undefined (FR1, FR26) — the weekly-14 cap and "room-left-this-week" depend on where the week starts; Mon–Sat working days doesn't fix the boundary. *Fix:* specify the week boundary (e.g., Monday 00:00 operator-local, consistent with the single-timezone assumption in §8).

## Scope honesty — adequate

Non-Goals are explicit and load-bearing (§7 Out, with "deliberate exclusions, not oversights" and per-item rationale in addendum A). Assumptions are tagged inline throughout with `[ASSUMPTION]`. The gap is one silent omission and the lack of a consolidated index.

### Findings
- **high** Cancellation / reschedule / no-show is silently omitted — it is neither an FR nor a listed Non-Goal. For a booking engine this is a real hole: if a confirmed booking is cancelled, does capacity free up (interacts with FR9/FR26)? Does removing a future booking flip a regular to gone-cold (FR17 keys off "no future booking on file")? A no-show — does it count as a completed job for the north-star? *Fix:* either add cancellation/no-show FRs (with capacity-release and gone-cold semantics), or add an explicit `[NON-GOAL for MVP]` in §7 acknowledging bookings are treated as immutable in v1 and stating the manual workaround.
- **low** No consolidated Assumptions Index (§ reader note promises `[ASSUMPTION]` discipline) — tags exist inline but there's no end-of-doc roundtrip index, so "resolve these before architecture" has no single checklist. *Fix:* add an Assumptions Index listing each inline tag and its resolution owner.

## Downstream usability — adequate

This PRD feeds architecture (addendum already sketches data model, feeds FR14–FR17). Domain nouns — `gone-cold`, `cadence`, `provisional`, `pending request`, `confirmed`, `day-maxed`, `room-left` — are used consistently across FRs, UJs, and the addendum, which is most of what a glossary buys. UJs each carry a named protagonist (Rosa, Maria) with context inline. FR IDs are unique across 1–37 and cross-references resolve. The physical ordering is unusual (FR36/FR37 sit inside §5.1 after FR9) but that follows the stated append-only policy and is fine.

### Findings
- **low** No Glossary section despite ~7 coined domain terms — consistency is currently carried by discipline, not a definition source; downstream story creation would benefit from one authoritative list (especially `pending request` vs `provisional record` vs `confirmed booking`, which are distinct states). *Fix:* add a short Glossary, or promote the addendum-D state names to a canonical status enum in the PRD.

## Shape fit — strong

Correctly shaped as a single-operator capability spec. UJs are kept light (five short journeys, used to motivate FRs rather than to carry heavy interaction design) — appropriate for a solo tool and not over-formalized. SMs are operational (utilization, float, repeat rate) rather than performative. No forced enterprise ceremony. The one shape tension is that UJ-4/UJ-5 imply an operator-driven phone workflow the FRs don't actually provide (see Done-ness critical finding) — the journeys are slightly ahead of the requirements.

### Findings
_Covered under Done-ness; no separate shape finding._

## Mechanical notes

- **ID continuity:** FR1–FR37 unique, no duplicates; FR36/FR37 appended out of physical order per the append-only policy — acceptable, but a reader scanning §5.1 meets FR9 then jumps to FR36. Consider a one-line pointer.
- **Assumptions roundtrip:** inline `[ASSUMPTION]` tags present (FR1, FR5, FR8, FR17, FR20, FR31, FR33, FR35, NFR2, NFR3, §8) but not indexed; no orphan index entries since there is no index.
- **OQ numbering:** OQ-1, OQ-4 open; OQ-2, OQ-3 resolved — non-contiguous but intentional (resolved items retained for history). Fine.
- **Glossary drift:** none observed; terms are used identically. The only near-synonym cluster is the three booking states (provisional/pending/confirmed), which are actually distinct — worth pinning in a glossary rather than a drift to fix.
- **Cross-refs:** all "(see FRxx)" pointers resolve to existing FRs.
