---
title: LovesCleaning — Product Requirements Document
status: final
created: 2026-07-15
updated: 2026-07-15
---

# LovesCleaning PRD

> **Reader note.** This PRD is written for a solo operator building with AI implementation agents. Functional requirements are phrased to be implemented literally: each has a stable ID, a single testable behavior, and no hidden "and also." Where a decision was inferred rather than stated in the brief, it carries an `[ASSUMPTION]` tag — resolve these before architecture.

## 1. Overview

LovesCleaning is a phone-first booking engine and leak-detector dashboard for a solo cleaning operator. The operator can serve **14 jobs/week** but currently books **5** — the book is **64% empty**. Demand exists; revenue leaks in the gaps between "they asked" and "they booked again." At **$200/job**, closing the gap moves the business from **~$4,000/month to ~$11,000/month** with no new hires and no ad spend.

The size of the prize is concrete: at $200/job, the gap between 5 and 14 jobs is **~$1,800/week** — roughly **~$7,000/month of idle capacity** the operator can already serve. It is not a demand problem; the phone rings. The largest number in the business is self-inflicted, and it is recoverable without hiring or advertising.

The product does one job: **stop losing bookings that are already within reach.** It is not field-service SaaS, not a CRM, not a marketing tool. It makes the open slots visible, makes rebooking a single tap, and catches regulars going cold before the slot is lost.

**Three revenue leaks it plugs:**
1. **Inquiry leak** — people ask but never get booked (phone tag, "text me later").
2. **Rebooking leak** — one-time jobs never turn into repeat jobs.
3. **Lapse leak** — weekly regulars quietly skip, then stop; the cold slot isn't noticed for weeks.

Plus a **payment leak**: cash-at-completion mostly works, but **~$500/month** floats unpaid or late with no record, reminder, or follow-up.

## 2. Goals & Success Metrics

**North-star:** **Repeat-booking rate** — share of completed jobs that lead to a rebooking.

**Supporting metrics:**
- **Utilization** — jobs booked of 14/week. Target trajectory: 5 → 14.
- **Revenue** — ~$4,000 → ~$11,000/month, driven by *fill*, not price hikes.
- **Payment float** — ~$500/month outstanding → toward zero.

**Leading indicators (must be observable from day one):**
- Inquiry → booking conversion.
- One-time → repeat conversion.
- Regulars gone cold caught **within 1 week** (vs. several weeks today).

**Counter-metrics (guardrails against gaming the north-star):**
- **Overbooking rate** — jobs accepted beyond a day's cap or the weekly 14. Filling the book must not mean over-committing.
- **Nudge fatigue** — rebook/reminder messages sent per client per week; a rising number with flat conversion means the nudges are noise.

## 3. Audiences

- **Primary — the solo operator (Damian).** Runs everything alone, phone in hand between jobs, currently tracking on a notebook. Needs a full book and honest numbers (repeat rate, utilization, who owes) without learning software.
- **Clients (booking side).** They hire the cleaner but are not the buyer. Their friction *is* the leak — they want to book or rebook in seconds without a phone call. They must do so with **no app to download** and **no account to create**.
- **Secondary, deferred — additional cleaners.** Onboarded onto the same panel as the business grows. Explicitly out of v1 (see §8 and Vision).

## 4. User Journeys

**UJ-1 — Inquiry to booking (client-side).**
A neighbor, Rosa, hears about the cleaner and scans a QR code on the van (or gets a link by text). She sees the real open slots for the next two weeks, picks Tuesday, enters her name, phone, and address, and confirms. The operator gets the booking against Rosa's new client record. No call, no phone tag.

**UJ-2 — Post-job rebooking (operator-initiated).**
The operator finishes Rosa's Tuesday clean. On the phone, the job shows a **one-tap "same time next week?"** action. It composes a friendly WhatsApp message pre-filled with Rosa's next open slot; the operator taps send. Rosa taps the link, confirms, and next week is booked before the operator has left the driveway.

**UJ-3 — Catching a lapse (operator, dashboard).**
Maria is a weekly regular but hasn't rebooked and is now past due. The dashboard surfaces her under **"gone cold"** within a week of the missed cadence. The operator taps a **win-back** action that drafts a check-in message; one tap sends it.

**UJ-4 — Deciding whether to accept work (operator, forecasting-lite).**
A caller asks for Thursday. The operator glances at the phone: Thursday is **day-maxed**, but there's **room left** Friday. They confidently offer Friday instead of overbooking Thursday or guessing.

**UJ-5 — Chasing the float (operator, ledger).**
End of week, the dashboard shows **who owes**. The operator taps a client marked outstanding; a payment-reminder message is drafted; one tap sends it. When cash arrives, they mark it paid.

## 5. Functional Requirements

FRs are grouped by capability. IDs are globally stable — never renumber; only append.

### 5.1 Booking Engine

- **FR1** — The system shall maintain an availability model of working days, each day carrying a maximum jobs-per-day cap, and enforce a hard ceiling of **14 jobs per calendar week** across all days. `[ASSUMPTION]` default working days Mon–Sat, default per-day cap 3, both operator-editable; the week boundary for the 14-cap is **Monday–Sunday** in the operator's local timezone.
- **FR2** — The system shall present clients a booking view showing only slots that are genuinely open (day not at its per-day cap and week not at 14).
- **FR3** — The system shall provide **per-client tokenized booking links** — a link tied to a specific client record — for sending to known inquirers and for rebooking.
- **FR4** — The system shall provide **one public self-serve booking link** that any client can use without an account.
- **FR5** — The system shall generate a **QR code** that encodes the public self-serve link (FR4), for print/physical placement (van, flyer, card). `[ASSUMPTION]` QR encodes the public link, not a per-client link.
- **FR6** — When a **new** client books via the public link, the system shall capture name, phone, and service address, create a **provisional client record**, and record the booking as a **pending request that does not yet consume capacity** — it awaits operator approval (see FR36).
- **FR7** — When a client books via a per-client link (a known client), the system shall attach the booking to that existing client record without re-collecting identity, and the booking is confirmed directly without the approval step.
- **FR8** — On a **confirmed** booking, the system shall record the job (client, date, price) and produce a booking-confirmation message for the operator to send (see FR20). `[ASSUMPTION]` default job price $200, editable per job.
- **FR9** — The system shall prevent a booking from being **confirmed** if it would exceed the per-day cap or the weekly 14-job ceiling, and shall communicate no availability rather than silently overbooking. The cap check is re-evaluated at approval time (FR36), so a pending request cannot be approved into an already-full slot. Client-facing flows (FR2, FR36) can never exceed a cap; only the operator, via explicit override (FR39), may book past one.
- **FR36** — The system shall present the operator an **approval queue** of pending new-client requests (FR6). On approval, the request becomes a confirmed booking consuming capacity (subject to FR9); on decline, the slot is untouched. Until approved, a pending request does not reserve or consume the slot. `[ASSUMPTION]` multiple pending requests may target the same slot; the first approved wins and the rest are surfaced as no-longer-available.
- **FR37** — The system shall let the operator **log an inquiry** with a source (`phone`, `walk-in`, `link`, `referral`, `other`), independent of whether it arrived through a booking link, so that phone/verbal inquiries are captured. Link visits that begin a booking are logged automatically as `link` inquiries. Inquiry → booking conversion (FR24) is measured against **all** logged inquiries, not only link-touch ones.

### 5.2 Rebooking & Nudges

- **FR10** — Each completed or upcoming job shall expose a **one-tap rebooking action** that proposes the client's next open slot. For clients with a cadence (weekly/biweekly/monthly), the proposal targets the slot at their cadence interval; for **one-time** clients the proposal targets the **soonest open slot** — the rebooking action is the mechanism that converts a one-time client into a repeat one.
- **FR11** — The one-tap rebooking action shall compose a rebooking message pre-filled with the proposed slot and the client's per-client booking link, ready for the operator to send (see FR20).
- **FR12** — The system shall support a **post-job nudge**: after a job is marked complete, it shall surface a prompt to send the rebooking message for that client.
- **FR13** — The system shall record whether a rebooking nudge was sent and whether it resulted in a booking, to feed the one-time → repeat conversion metric.

### 5.3 Client Records & Lapse Detection

- **FR14** — The system shall maintain a client record: name, phone, address, booking history, cadence, and payment status.
- **FR15** — Each client shall carry an explicit **cadence** field: `weekly`, `biweekly`, `monthly`, or `one-time`.
- **FR16** — The system shall compute each regular client's **expected next booking date** from their last completed job and cadence.
- **FR17** — The system shall flag a client as **"gone cold"** when the current date passes their expected next booking date (FR16) without a future booking on file. Because the expected date is derived from cadence, detection latency **scales per cadence**: a weekly regular is caught within ~1 week of the missed slot, a biweekly within ~2 weeks, a monthly within ~1 month. `[ASSUMPTION]` no additional grace period beyond the cadence interval; flag fires as soon as the expected date passes.
- **FR18** — Each gone-cold client shall expose a **win-back action** that drafts a check-in message for the operator to send (see FR20).

### 5.4 Messaging (cross-cutting)

- **FR19** — The system shall deliver all outbound client communication via **draft + tap-to-send**: it composes the message and hands it to the operator's WhatsApp or SMS pre-filled; the operator taps send. The system does **not** send messages autonomously in v1.
- **FR20** — The system shall provide message templates for: booking confirmation, rebooking nudge, win-back check-in, and payment reminder. `[ASSUMPTION]` templates are operator-editable text with client/slot/amount placeholders.
- **FR21** — The system shall record that a message was drafted/dispatched (operator-confirmed) per client per type, to feed the nudge-fatigue counter-metric.

### 5.5 Dashboard (Leak Detector)

- **FR22** — The system shall present a **single-screen dashboard**, phone-legible, showing at minimum: current-week utilization (jobs booked of 14), repeat vs. lapsed client counts, month-over-month revenue, and outstanding balance ("who owes").
- **FR23** — The dashboard shall list **gone-cold clients** (FR17) with direct access to the win-back action (FR18).
- **FR24** — The dashboard shall surface the three leak indicators: inquiry → booking conversion, one-time → repeat conversion, and count of regulars caught cold this week.
- **FR25** — The dashboard shall exclude vanity metrics; every element shown must map to a leak or a capacity/cash decision.

### 5.6 Forecasting-lite

- **FR26** — The system shall compute and display **room-left-this-week** (14 minus jobs booked this week).
- **FR27** — The system shall mark any working day as **day-maxed** when it reaches its per-day cap, visible when deciding whether to accept work.
- **FR28** — When a requested day is day-maxed, the system shall surface the nearest days that still have room.

### 5.7 Cash Ledger

- **FR29** — The system shall record, per job, a payment status of **paid** or **owed** with the amount.
- **FR30** — The system shall flag outstanding (owed) jobs and aggregate them into the dashboard's outstanding balance (FR22).
- **FR31** — Each outstanding job/client shall expose a **payment-reminder action** that drafts a reminder message for the operator to send (see FR20). `[ASSUMPTION]` reminders are operator-triggered, never auto-sent.
- **FR32** — The operator shall be able to mark an owed job as paid, clearing it from the outstanding total.

### 5.8 Operator Access

- **FR33** — The system shall authenticate a **single operator** for all dashboard, ledger, and scheduling functions. `[ASSUMPTION]` single-operator, single-business tenancy in v1; no multi-user roles.
- **FR34** — Client-facing booking links (FR3, FR4) shall require **no client login**; access is by link/token only.
- **FR35** — The operator shall be able to **export** client and job data (e.g. CSV) so the data is owned, not rented. `[ASSUMPTION]` CSV export satisfies the data-ownership principle for v1.

### 5.9 Operator-Initiated Actions & Job Lifecycle

The client-link flows (5.1) are not the only entry point. The operator's phone is today's dominant channel, and the existing book must be seeded. These FRs make the operator a first-class actor.

- **FR38** — The operator shall be able to **create and edit a client record directly** (name, phone, address, cadence), without a booking link — to seed existing regulars and to add a caller on the spot.
- **FR39** — The operator shall be able to **record a booking directly** on behalf of any client (e.g. a phone or walk-in booking), subject to the cap check (FR9). The operator may **explicitly override** the per-day or weekly cap to book anyway; an overridden booking is recorded as such and counts toward the overbooking counter-metric (§2). Override is the only sanctioned path past a cap.
- **FR40** — The operator shall be able to **mark a job's outcome** as **completed** or **no-show**. Marking completed is the transition that enables the post-job nudge (FR12), sets the basis for the client's expected-next-date (FR16), and makes the job eligible for the ledger (FR29). A no-show consumes the slot (the operator's time was held) but is not eligible for payment and does not advance the rebooking/lapse logic as a completed job.
- **FR41** — The operator shall be able to **cancel or reschedule** a booking. Cancelling **releases the slot's capacity** back into room-left (FR26) and day-maxed (FR27) computations; rescheduling moves the job to a new date subject to FR9 and releases the original slot. A cancelled job is not counted as completed for lapse (FR17) or repeat-rate (§2) logic.

## 6. Non-Functional Requirements

- **NFR1 — Phone-first.** Every operator surface is designed for a phone held one-handed between jobs; no desktop dependency.
- **NFR2 — Zero client friction.** Booking requires no app install and no account; a client completes a booking in under ~60 seconds on a phone. `[ASSUMPTION]` 60s target.
- **NFR3 — Fast.** Dashboard and booking views load and respond quickly on mobile data; the operator can check availability mid-conversation without waiting. `[ASSUMPTION]` interactive views under ~2s on 4G.
- **NFR4 — Reliability of the source of truth.** Availability and the 14/week cap must never double-book; concurrent public bookings on the last open slot resolve to exactly one winner.
- **NFR5 — Data ownership & durability.** Client and job data is durably stored and exportable (FR35); no data loss on the operator's single account.
- **NFR6 — Security & privacy.** Tokenized client links are unguessable and scoped to one client; operator access is authenticated; client PII (name, phone, address) is protected at rest and in transit.
- **NFR7 — Simplicity constraint.** No feature ships that doesn't touch a named leak or a capacity/cash decision. Scope creep is a defect.

## 7. Scope — In / Out

**In (v1):**
- Availability model with per-day cap + hard 14/week cap (FR1–FR2, FR9).
- Booking links: per-client, public, QR (FR3–FR8).
- New-client approval queue (FR36) + inquiry logging with source (FR37).
- One-tap rebooking + post-job nudge (FR10–FR13).
- Client records + explicit cadence + lapse detection (FR14–FR18).
- Draft + tap-to-send messaging with templates (FR19–FR21).
- Single-screen leak-detector dashboard (FR22–FR25).
- Forecasting-lite: room-left, day-maxed (FR26–FR28).
- Cash ledger with reminders (FR29–FR32).
- Single-operator auth, no-login client links, data export (FR33–FR35).
- Operator-initiated client creation, direct booking with cap-override, job-outcome (complete/no-show), cancel/reschedule with capacity release (FR38–FR41).

**Out (explicit — deliberate exclusions, not oversights):**
- **Card processing / auto-charge** — dropped from earlier plans; cash stays king, no client behavior change. (See addendum for rationale.)
- **Autonomous message sending** — v1 is draft + tap-to-send only.
- **Native mobile app** — product lives on phone-web + WhatsApp/text.
- **Multi-cleaner / team management** — deferred to Vision.
- **Advertising / lead generation** — the problem is a demand *leak*, not a drought.
- **Time-slot (clock-time) scheduling** — v1 uses per-day caps, not timed slots.
- Anything that does not touch a named leak (NFR7).

## 8. Dependencies & Constraints

- **Operator's own WhatsApp/SMS** is the delivery channel; the product prepares messages but relies on the operator's phone to send them (consequence of FR19). No third-party messaging account required for v1.
- **Single operator, single timezone** — schedule math is in the operator's local time. `[ASSUMPTION]`
- **Currency USD**, default job price $200 (FR8). `[ASSUMPTION]`
- Technology/stack choices are deferred to the architecture phase; this PRD specifies capabilities, not implementation (see addendum for options already considered).

## 9. Open Questions

*None open. All resolved.*

*Resolved:* **OQ-1** — capacity defaults confirmed by operator: working days **Mon–Sat**, per-day cap **3** (FR1), operator-editable. **OQ-2** — new-client public bookings are held for operator approval (FR6, FR36). **OQ-3** — lapse detection scales per cadence (FR17). **OQ-4** — CSV export is sufficient for the data-ownership principle in v1 (FR35). **Inquiry capture** — fuller capture added; phone/verbal inquiries are logged manually (FR37).

## 10. Vision (Beyond v1)

The same instrument panel becomes the backbone for growth: onboard a 2nd/3rd cleaner, route work by geography, and forecast across a small team. The end state is a **franchise-in-a-box** — playbook plus software — that takes any solo cleaner from notebook → full book → small team. The moat is not technology; it is **fit, focus, and compounding client-history data** the operator owns. Every job sharpens forecasting and win-back. Positioning holds throughout: *most tools help you run jobs; this one helps you not lose them.* (Depth in addendum.)
