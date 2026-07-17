---
id: SPEC-LovesCleaning
companions:
  - ../../planning-artifacts/prds/prd-LovesCleaning-2026-07-15/prd.md          # adopted — full FR1–41 / NFR1–7 literal behaviors
  - ../../planning-artifacts/prds/prd-LovesCleaning-2026-07-15/addendum.md     # adopted — metric definitions (addendum F) + design rationale cited by AD-7
  - ../../planning-artifacts/architecture/architecture-LovesCleaning-2026-07-15/ARCHITECTURE-SPINE.md  # adopted — AD-1..AD-13 invariants, layers, stack, diagrams (build substrate)
sources: []
---

> **Canonical contract.** This SPEC and the files in `companions:` are the complete, preservation-validated contract for what to build, test, and validate. The PRD holds each capability's literal per-FR behavior; the architecture spine holds the invariants (AD-1..AD-13) every unit is built from. Capability IDs here are stable; downstream cites `CAP-N` and the `binds` FRs/ADs beside each.

# LovesCleaning — Booking Engine & Leak Detector

## Why

**A pain to solve.** A solo cleaning operator (Damian) can serve **14 jobs/week** but books **5** — the book is **64% empty**. Demand is not the problem; the phone rings. Revenue leaks in the gaps between "they asked" and "they booked again." At **$200/job**, closing the gap moves the business from **~$4,000 to ~$11,000/month with no new hires and no ad spend** — the largest number in the business is self-inflicted and recoverable. The product does one job: **stop losing bookings already within reach.** It plugs three leaks — **inquiry** (asked, never booked), **rebooking** (one-time never becomes repeat), **lapse** (a regular quietly goes cold) — plus a **payment float** (~$500/month unpaid, unrecorded). It is not field-service SaaS, not a CRM, not a marketing tool.

## Capabilities

- **CAP-1 — Availability & capacity truth** · *binds FR1–2, FR9, FR26–28; AD-2, AD-3, AD-9*
  - **intent:** The system maintains one availability model (per-day cap + hard 14/week ceiling) and shows clients only genuinely-open slots, while surfacing room-left and day-maxed for the operator's accept/decline decision.
  - **success:** Two concurrent bookings on the last open slot resolve to exactly one winner (the other gets no-availability); a day at its cap reads "day-maxed" and the system offers the nearest days with room; room-left equals 14 minus capacity-consuming jobs that week.

- **CAP-2 — Booking links & new-client capture** · *binds FR3–8, FR36–37; AD-4, AD-6, AD-11, AD-12*
  - **intent:** Clients book with no app and no account via per-client, public, or QR links; a public new-client booking enters an operator approval queue that consumes no capacity until approved; inquiries are logged with a source regardless of channel.
  - **success:** A stranger completes a public booking creating a provisional client + pending request that reserves **zero** capacity; approval commits the job under a fresh cap re-check (approval into a full slot is rejected); a known client on a per-client link is confirmed directly without re-collecting identity.

- **CAP-3 — Rebooking & post-job nudges** · *binds FR10–13; AD-5, AD-7*
  - **intent:** Every job exposes a one-tap rebooking that proposes the client's next open slot (cadence interval, or soonest open for one-time) and composes a pre-filled message; completing a job prompts the nudge.
  - **success:** Marking a job complete surfaces a rebooking prompt; whether the nudge was sent and whether it produced a booking is recorded, making one-time→repeat conversion computable.

- **CAP-4 — Client records & lapse detection** · *binds FR14–18; AD-7, AD-8*
  - **intent:** Each client carries an explicit cadence; the system derives expected-next-date and flags a client "gone cold" when that date passes with no future booking, exposing a win-back draft.
  - **success:** A weekly regular past their expected date appears "gone cold" within ~1 week (biweekly ~2 weeks, monthly ~1 month — latency scales per cadence); the win-back action drafts a check-in message ready to send.

- **CAP-5 — Draft + tap-to-send messaging** · *binds FR19–21; AD-5*
  - **intent:** All outbound client communication is composed channel-agnostically and handed to the operator's WhatsApp/SMS pre-filled; the system never sends autonomously in v1.
  - **success:** A dispatch is logged **once**, only on the operator's explicit send tap (a re-tap does not double-log); message templates (confirmation, rebooking, win-back, reminder) render without any transport knowledge.

- **CAP-6 — Leak-detector dashboard** · *binds FR22–25, §2 counter-metrics; AD-7*
  - **intent:** A single phone-legible screen shows current-week utilization, repeat-vs-lapsed counts, month-over-month revenue, outstanding balance, the three leak indicators, and the counter-metrics — and nothing vanity.
  - **success:** Every element shown maps to a named leak or a capacity/cash decision; the north-star repeat-booking rate and both counter-metrics (overbooking rate, nudge-fatigue) compute from canonical rows on read, with no stored derived flags.

- **CAP-7 — Cash ledger** · *binds FR29–32; AD-7, AD-10*
  - **intent:** Each completed job carries paid/owed with an amount; outstanding aggregates onto the dashboard; each owed job exposes a payment-reminder draft; the operator marks paid when cash arrives.
  - **success:** Marking an owed job paid clears it from the outstanding total **without** altering the job's completion state; only completed jobs are ledger-eligible (no "paid no-show").

- **CAP-8 — Job lifecycle authority** · *binds FR40–41; AD-10, AD-12*
  - **intent:** The operator marks a job's outcome (completed / no-show) and cancels or reschedules; transitions follow one state machine; cancel releases capacity, reschedule is atomic.
  - **success:** A no-show consumes its slot but is not payment-eligible and does not advance rebooking/lapse logic; cancelling returns capacity to room-left/day-maxed; a reschedule releases the old slot and commits the new one in one transaction, never transiently double-holding or losing capacity.

- **CAP-9 — Operator access & data ownership** · *binds FR33–35, FR38–39; AD-1, AD-6, AD-8*
  - **intent:** A single authenticated operator runs every function, can seed/edit client records and record direct bookings (with an explicit cap-override), and can export all data as CSV; client links require no login.
  - **success:** The operator exports client and job data as CSV; a cap-override booking is recorded as overridden and counts toward the overbooking counter-metric; per-client tokens are unguessable and scoped to exactly one client, with exactly one public token.

## Constraints

- **Never double-book the last slot.** Concurrent public bookings on the final open slot resolve to exactly one winner via a **transaction-scoped** lock inside one DB transaction (NFR4; AD-2, AD-3). Session-scoped advisory locks are forbidden — serverless transaction-mode pooling silently breaks them.
- **Capacity has exactly one owner.** A single `commitBooking` is the only code that inserts a capacity-consuming job; a single `consumesSlot` predicate defines which job states consume, read by both the commit path and every derived read (AD-2).
- **Approval queue holds no capacity.** A pending new-client request is a distinct entity, not a job; capacity is consumed only at approval (AD-4).
- **Draft + tap-to-send only.** No autonomous message sending in v1; compose is decoupled from delivery so a future auto-send adapter needs no template change (FR19; AD-5).
- **Derived state is computed on read.** Gone-cold, room-left, repeat-rate, and counter-metrics derive from canonical rows on every render — no stored flags, no cron, no background jobs (AD-7).
- **Phone-first, zero client friction.** Every operator surface works one-handed on a phone; booking needs no install and no account and completes in **~60s**; interactive views respond in **~2s on 4G** (NFR1, NFR2, NFR3; AD-13).
- **Token is capability.** Client links are signed, unguessable, single-client-scoped tokens; no client login; the operator is one authenticated session (NFR6; AD-6).
- **One clock.** Timestamps stored UTC; all capacity/cadence/week math in the operator's single local timezone; the weekly-14 boundary is Monday–Sunday local (AD-9).
- **Tenancy seam present, not built.** Every persisted row carries `owner_id` and every query filters on it from v1 (value hardcoded to the single operator) — no multi-user auth or scoping UI in v1 (AD-8).
- **Cash only.** No card processing or auto-charge; the ledger + reminder covers the payment leak with no client behavior change.
- **Per-day caps, not clock-time slots.** v1 schedules by day capacity, not timed appointments.
- **Simplicity gate.** No structure, column, or surface ships unless it serves a named leak or a capacity/cash decision — scope creep is a defect (NFR7, FR25).
- **Money as integer cents, USD; default job price is operator config, not a hardcoded constant.**

## Non-goals

- **Card processing / auto-charge** — cash stays king; no payment-processor surface in v1.
- **Autonomous message sending** — v1 is draft + tap-to-send only (the adapter seam is kept for later).
- **Native mobile app** — the product lives on phone-web plus the operator's WhatsApp/SMS.
- **Multi-cleaner / team management, geographic routing, team forecasting** — deferred to Vision; only the `owner_id` seam exists now.
- **Advertising / lead generation** — the problem is a demand *leak*, not a drought.
- **Time-slot (clock-time) scheduling** — per-day caps only in v1.
- **Anything that does not touch a named leak or a capacity/cash decision.**

## Success signal

The operator finishes a Tuesday clean, taps **"same time next week?"**, and the client confirms **before the operator leaves the driveway** — a rebooking that would previously have leaked is captured in seconds. Across the book, utilization climbs **5 → 14 jobs/week** and revenue **~$4,000 → ~$11,000/month driven by fill, not price**; the north-star **repeat-booking rate** rises; regulars gone cold are caught **within 1 week** instead of several; and the **~$500/month payment float trends toward zero** — all without a new hire or an ad dollar.

## Assumptions

- **Capacity defaults confirmed by operator:** working days **Mon–Sat**, per-day cap **3** (OQ-1 resolved). **CSV export is sufficient** for the v1 data-ownership principle (FR35; OQ-4 resolved). All remain operator-editable.
- Remaining PRD `[ASSUMPTION]` defaults — job price **$200**, booking-flow target **~60s**, interactive-view target **~2s on 4G** — carried forward as operator-editable defaults; none is a hardcoded constant.
- The PRD and architecture spine are both **final**; this SPEC distills them without re-litigating decisions already recorded there.
