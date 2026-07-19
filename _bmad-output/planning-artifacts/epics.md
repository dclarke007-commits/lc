---
stepsCompleted: [step-01-validate-prerequisites, step-02-design-epics, step-03-create-stories, step-04-final-validation]
inputDocuments:
  - _bmad-output/planning-artifacts/prds/prd-LovesCleaning-2026-07-15/prd.md
  - _bmad-output/planning-artifacts/prds/prd-LovesCleaning-2026-07-15/addendum.md
  - _bmad-output/planning-artifacts/architecture/architecture-LovesCleaning-2026-07-15/ARCHITECTURE-SPINE.md
---

# LovesCleaning - Epic Breakdown

## Overview

This document provides the complete epic and story breakdown for LovesCleaning, decomposing the requirements from the PRD, PRD addendum, and Architecture spine into implementable stories. No UX design contract exists (phone-web + operator's WhatsApp/SMS; no separate UX spine).

## Requirements Inventory

### Functional Requirements

**Booking Engine**
- **FR1** — Maintain availability model of working days, each with a max jobs-per-day cap, and enforce a hard ceiling of 14 jobs/calendar week. Defaults: working days Mon–Sat, per-day cap 3, both operator-editable; week boundary Mon–Sun in operator-local tz.
- **FR2** — Present clients a booking view showing only genuinely-open slots (day under per-day cap AND week under 14).
- **FR3** — Provide per-client tokenized booking links (tied to a client record) for known inquirers and rebooking.
- **FR4** — Provide one public self-serve booking link usable without an account.
- **FR5** — Generate a QR code encoding the public self-serve link (FR4) for print/physical placement.
- **FR6** — New client booking via public link: capture name/phone/address, create provisional client record, record a pending request that does NOT consume capacity, awaiting operator approval (FR36).
- **FR7** — Booking via a per-client link (known client): attach to existing record without re-collecting identity; confirmed directly, no approval step.
- **FR8** — On a confirmed booking, record the job (client, date, price) and produce a booking-confirmation message for the operator to send (FR20). Default price $200, editable per job.
- **FR9** — Prevent a booking being confirmed if it would exceed the per-day cap or weekly-14 ceiling; communicate no-availability rather than silently overbook. Cap check re-evaluated at approval (FR36). Client flows can never exceed a cap; only the operator via explicit override (FR39) may book past one.
- **FR36** — Present operator an approval queue of pending new-client requests (FR6). Approve → confirmed booking consuming capacity (subject to FR9); decline → slot untouched. Multiple pending requests may target one slot; first approved wins, rest surfaced as no-longer-available.
- **FR37** — Let operator log an inquiry with a source (`phone|walk-in|link|referral|web|other`), independent of booking links. Link visits that begin a booking auto-log as `link`; homepage self-serve submissions (FR42) auto-log as `web`. Inquiry→booking conversion (FR24) measured against ALL logged inquiries.
- **FR42** — Provide a public marketing homepage at `/` (no account) presenting the business and a self-serve booking-request form. A submission creates a provisional client record + pending request (reusing FR6/AR5) and logs an Inquiry with source `web` (FR37). The homepage is the anonymous top-of-funnel entry; all operator surfaces remain behind auth (FR33).

**Rebooking & Nudges**
- **FR10** — Each completed/upcoming job exposes a one-tap rebooking action proposing the client's next open slot. Cadenced clients → slot at cadence interval; one-time clients → soonest open slot (this is the one-time→repeat conversion mechanism).
- **FR11** — The rebooking action composes a message pre-filled with the proposed slot + the client's per-client link, ready to send (FR20).
- **FR12** — Post-job nudge: after a job is marked complete, surface a prompt to send that client's rebooking message.
- **FR13** — Record whether a rebooking nudge was sent and whether it produced a booking (feeds one-time→repeat metric).

**Client Records & Lapse Detection**
- **FR14** — Maintain a client record: name, phone, address, booking history, cadence, payment status.
- **FR15** — Each client carries an explicit cadence field: `weekly|biweekly|monthly|one-time`.
- **FR16** — Compute each regular client's expected next booking date from last completed job + cadence.
- **FR17** — Flag a client "gone cold" when current date passes the expected next booking date (FR16) with no future booking on file. Detection latency scales per cadence; no extra grace period.
- **FR18** — Each gone-cold client exposes a win-back action drafting a check-in message to send (FR20).

**Messaging (cross-cutting)**
- **FR19** — Deliver all outbound client comms via draft + tap-to-send: compose and hand to operator's WhatsApp/SMS pre-filled; operator taps send. No autonomous sending in v1.
- **FR20** — Provide message templates: booking confirmation, rebooking nudge, win-back check-in, payment reminder. Operator-editable text with client/slot/amount placeholders.
- **FR21** — Record that a message was drafted/dispatched (operator-confirmed) per client per type (feeds nudge-fatigue counter-metric).

**Dashboard (Leak Detector)**
- **FR22** — Present a single-screen, phone-legible dashboard showing at minimum: current-week utilization (of 14), repeat vs. lapsed counts, month-over-month revenue, outstanding balance.
- **FR23** — Dashboard lists gone-cold clients (FR17) with direct access to the win-back action (FR18).
- **FR24** — Dashboard surfaces the three leak indicators: inquiry→booking, one-time→repeat, count of regulars caught cold this week.
- **FR25** — Dashboard excludes vanity metrics; every element maps to a leak or a capacity/cash decision.

**Forecasting-lite**
- **FR26** — Compute and display room-left-this-week (14 minus jobs booked this week).
- **FR27** — Mark any working day day-maxed when it reaches its per-day cap.
- **FR28** — When a requested day is day-maxed, surface the nearest days that still have room.

**Cash Ledger**
- **FR29** — Record, per job, a payment status of `paid` or `owed` with the amount.
- **FR30** — Flag outstanding (owed) jobs and aggregate them into the dashboard outstanding balance (FR22).
- **FR31** — Each outstanding job/client exposes a payment-reminder action drafting a reminder message (FR20). Operator-triggered, never auto-sent.
- **FR32** — Operator can mark an owed job paid, clearing it from the outstanding total.

**Operator Access**
- **FR33** — Authenticate a single operator for all dashboard, ledger, scheduling functions. Single-operator, single-business tenancy in v1; no multi-user roles.
- **FR34** — Client-facing booking links (FR3, FR4) require no client login; access is by link/token only.
- **FR35** — Operator can export client and job data (CSV) so data is owned, not rented.

**Operator-Initiated Actions & Job Lifecycle**
- **FR38** — Operator can create and edit a client record directly (name, phone, address, cadence) without a booking link — to seed regulars and add a caller on the spot.
- **FR39** — Operator can record a booking directly on behalf of any client, subject to the cap check (FR9). Operator may explicitly override the per-day/weekly cap; an overridden booking is recorded as such and counts toward the overbooking counter-metric. Override is the only sanctioned path past a cap.
- **FR40** — Operator can mark a job's outcome completed or no-show. Completed enables the post-job nudge (FR12), sets basis for expected-next-date (FR16), and makes the job ledger-eligible (FR29). A no-show consumes the slot but is not payment-eligible and does not advance rebooking/lapse logic.
- **FR41** — Operator can cancel or reschedule a booking. Cancel releases the slot's capacity back into room-left (FR26)/day-maxed (FR27); reschedule moves the job to a new date subject to FR9 and releases the original slot. A cancelled job is not counted completed for lapse (FR17) or repeat-rate.

### NonFunctional Requirements

- **NFR1 — Phone-first.** Every operator surface designed for a phone held one-handed; no desktop dependency.
- **NFR2 — Zero client friction.** Booking requires no app install and no account; a client completes a booking in under ~60s on a phone.
- **NFR3 — Fast.** Dashboard and booking views load/respond quickly on mobile data; interactive views under ~2s on 4G.
- **NFR4 — Reliability of source of truth.** Availability and the 14/week cap must never double-book; concurrent public bookings on the last open slot resolve to exactly one winner.
- **NFR5 — Data ownership & durability.** Client/job data durably stored and exportable (FR35); no data loss on the operator's single account.
- **NFR6 — Security & privacy.** Tokenized client links unguessable and scoped to one client; operator access authenticated; client PII protected at rest and in transit.
- **NFR7 — Simplicity constraint.** No feature ships that doesn't touch a named leak or a capacity/cash decision. Scope creep is a defect.
- **NFR8 — Visual design system.** A single fresh-and-trustworthy design system (color/type/spacing tokens + shared components) is applied across every operator and public surface. The visual + interaction contract lives in `_bmad-output/planning-artifacts/ux-designs/ux-LovesCleaning-2026-07-18/` (DESIGN.md, EXPERIENCE.md).

### Additional Requirements

Technical/infrastructure/integration constraints from the Architecture spine (ADs) and addendum. These bind HOW stories are built and gate acceptance criteria.

**Substrate & stack (Epic 1 foundation)**
- **AR1** — Greenfield scaffold: no starter template. Next.js 16 (App Router, RSC, Server Actions, Turbopack) + React 19 + TypeScript 5 + Node 20+. Server-first: RSC render every surface; Server Actions the ONLY mutation entry point; no separate API tier, no client-side data store.
- **AR2** — Managed Postgres (Neon or Supabase, transaction-mode pooling). Drizzle ORM schema + queries in `lib/db/` — the only module that speaks SQL; surfaces never import it directly.
- **AR16** — Money as integer cents, USD. Default job price is operator-config, not a hardcoded constant.
- **AR17** — CSV export (FR35) is a Server Action streaming the owner's rows.
- **AR18** — Host on Vercel (preview + prod). Secrets via Vercel env. Managed-Postgres backups satisfy durability (NFR5). No self-hosted infra. Operator auth middleware lives in `proxy.ts` (Next 16).

**Domain invariants (bind story acceptance criteria)**
- **AR3** (AD-2) — A single `capacity.commitBooking()` is the ONLY code that inserts a capacity-consuming Job; it re-checks per-day + weekly-14 caps in one transaction. `consumesSlot(job)`: `booked|completed|no-show` consume, `cancelled` does not. All three commit paths (client-confirm FR7, approve-from-queue FR36, operator direct FR39) call it; FR39 override is a boolean arg, not a separate path.
- **AR4** (AD-3) — Exactly-one-winner concurrency: `commitBooking` serializes via `SELECT … FOR UPDATE` on the day row or `pg_advisory_xact_lock()` inside one `db.transaction()`, both caps re-evaluated inside the lock. Session-scoped `pg_advisory_lock()` is FORBIDDEN (transaction-mode pooling breaks it).
- **AR5** (AD-4) — A pending new-client request is a distinct `PendingRequest` row that neither reserves nor consumes capacity; capacity consumed only when approval calls `commitBooking`. Known clients (FR7) skip the queue.
- **AR6** (AD-5) — `compose` turns `(client, slot, amount, template)` into a channel-agnostic `MessageDraft{recipient, body, type}`; a `lib/delivery` adapter renders it to a `wa.me`/`sms:` deep-link in v1. Dispatch recorded ONCE on the operator's explicit send tap (idempotent per draft); `MessageLog` distinguishes `drafted_at` from `dispatched_at`; only `dispatched_at` feeds nudge-fatigue.
- **AR7** (AD-6) — Client links are signed, unguessable tokens: per-client token scoped to one client; exactly one public token; QR encodes the public token URL. Operator is a single authenticated session; no client login.
- **AR8** (AD-7) — A single `derive` module computes `expectedNextDate`, `goneCold`, `roomLeft`, `dayMaxed`, all dashboard metrics, and §2 counter-metrics from canonical rows on every render. No stored derived flags, no cron, no background job.
- **AR9** (AD-8) — Every Client, Job, PendingRequest, Inquiry, MessageLog, and token row carries an `owner_id` FK, and the `owner_id` filter is present in every query from v1 (value hardcoded to the single operator). A one-row Operator seed migration establishes it. No tenant-scoping UI, no multi-user auth in v1.
- **AR10** (AD-9) — Timestamps stored UTC; ALL capacity/cadence/week arithmetic computed in the operator's single local tz. Weekly-14 boundary is Mon–Sun operator-local.
- **AR11** (AD-10) — Job `completion` state machine owned by `lib/domain/lifecycle`: `booked → completed|no-show|cancelled`; nothing transitions out of `no-show`/`cancelled` except explicit operator correction. `payment` orthogonal but gated: only a `completed` Job is ledger-eligible; `markPaid` never alters `completion`.
- **AR12** (AD-11) — Every Inquiry carries `source` provenance; a link visit auto-logs at most one `link` Inquiry per token-visit session, and a homepage self-serve submission (FR42) auto-logs one `web` Inquiry (server-side, deduped via partial unique index); conversion denominator dedupes to distinct inquiries.
- **AR13** (AD-12) — `commitBooking` idempotent per booking attempt (idempotency key per token-submit); reschedule (FR41) releases the original slot and commits the new one inside one transaction.
- **AR14** (AD-13) — Latency budget: booking/dashboard surfaces target <2s interactive on 4G (NFR3), client booking flow <60s (NFR2). Surfaces stay dynamic (never `use cache`), ship minimal client JS.
- **AR15** (Conventions) — Server Actions return a typed `{ok, data} | {ok:false, reason}`; no thrown errors cross the action boundary; capacity rejections carry a machine reason (`day-maxed`|`week-full`). Errors land in Vercel platform logs; no separate APM in v1.

**Metric definitions (addendum F — bind dashboard/derive stories)**
- **AR19** — Precise metric math: **Repeat-booking rate** (north-star) = of jobs completed in a rolling 30-day window, share where the same client has a subsequent booking created within 30 days of that job's completion. **Utilization** = jobs booked this week ÷ 14. **Inquiry→booking** = bookings ÷ all logged inquiries (FR37). **One-time→repeat** = one-time clients who later book ÷ one-time clients. **Regulars caught cold within 1 week** = gone-cold flags raised within 7 days of the missed expected-next-date this week. **Payment float** = sum of `owed` job amounts. **Overbooking rate** = jobs with `Job.overridden` / total. **Nudge-fatigue** = dispatched messages per client per week.

### UX Design Requirements

_A visual/interaction design contract exists as of 2026-07-18: `ux-designs/ux-LovesCleaning-2026-07-18/` (DESIGN.md, EXPERIENCE.md), realized as the whole-app design system (NFR8). Phone-first behavior stays governed by NFR1–NFR3; the design system governs look, tone, and shared components across operator + public surfaces._

### FR Coverage Map

Every FR maps to exactly one owning epic. Epic order front-loads the recoverable revenue leak (rebooking/win-back) behind only foundation + messaging; no epic reaches forward.

- **FR1** → Epic 1 — availability model + per-day/weekly caps
- **FR2** → Epic 3 — client booking view of genuinely-open slots (first client-facing surface)
- **FR3** → Epic 3 — per-client tokenized booking link (the rebooking loop hands this to the client)
- **FR4** → Epic 4 — public self-serve booking link
- **FR5** → Epic 4 — QR encoding the public link
- **FR6** → Epic 4 — new-client public booking → provisional record + pending request
- **FR7** → Epic 3 — known-client direct-confirm via per-client link (completes rebooking loop)
- **FR8** → Epic 2 — record job + produce booking-confirmation message
- **FR9** → Epic 1 — cap enforcement on confirm (no silent overbook)
- **FR10** → Epic 3 — one-tap rebooking proposing next open slot
- **FR11** → Epic 3 — rebooking message pre-filled with slot + per-client link
- **FR12** → Epic 3 — post-job rebooking nudge
- **FR13** → Epic 3 — record nudge sent / resulted-in-booking
- **FR14** → Epic 1 — client record (name, phone, address, history, cadence, payment status)
- **FR15** → Epic 1 — explicit cadence field
- **FR16** → Epic 3 — compute expected-next-booking date
- **FR17** → Epic 3 — gone-cold flag (cadence-scaled)
- **FR18** → Epic 3 — win-back action drafting check-in message
- **FR19** → Epic 2 — draft + tap-to-send delivery (no autonomous send)
- **FR20** → Epic 2 — message templates (confirmation, rebook, win-back, reminder)
- **FR21** → Epic 2 — record message drafted/dispatched (nudge-fatigue counter)
- **FR22** → Epic 6 — single-screen dashboard (utilization, repeat/lapsed, revenue, outstanding)
- **FR23** → Epic 6 — dashboard gone-cold list with win-back access
- **FR24** → Epic 6 — three leak indicators surfaced
- **FR25** → Epic 6 — no vanity metrics (every element maps to a leak/decision)
- **FR26** → Epic 1 — room-left-this-week
- **FR27** → Epic 1 — day-maxed marking
- **FR28** → Epic 1 — nearest days with room when a day is maxed
- **FR29** → Epic 5 — per-job paid/owed with amount
- **FR30** → Epic 5 — flag + aggregate outstanding balance
- **FR31** → Epic 5 — payment-reminder action drafting a reminder
- **FR32** → Epic 5 — mark owed job paid
- **FR33** → Epic 1 — single-operator authentication
- **FR34** → Epic 3 — no client login on client-facing links (first client surface)
- **FR35** → Epic 6 — CSV export of client/job data
- **FR36** → Epic 4 — operator approval queue for pending new-client requests
- **FR37** → Epic 4 — log inquiry with source (feeds inquiry→booking metric)
- **FR38** → Epic 1 — operator create/edit client directly
- **FR39** → Epic 1 — operator direct booking with explicit cap-override
- **FR40** → Epic 1 — mark job outcome (completed / no-show)
- **FR41** → Epic 1 — cancel/reschedule with capacity release
- **FR42** → Epic 4 — public marketing homepage (anonymous top-of-funnel + self-serve request)

## Epic List

Six epics, cut by revenue leak (the product's value spine, NFR7). Each stands alone and builds only on prior epics — none reaches forward.

### Epic 1: Operator's Book — Foundation + Manual Scheduling

The operator logs in and runs the entire book by hand — seeding and editing clients, recording bookings directly with hard cap enforcement plus an explicit override, managing job outcomes (completed / no-show), cancelling and rescheduling with capacity release, and seeing forecasting-lite (room-left, day-maxed). Replaces the notebook end-to-end. Establishes the load-bearing substrate every later epic extends: the Next.js 16 scaffold, Drizzle/Postgres schema, the operator seed + `owner_id` seam, the single `capacity.commitBooking` (one-winner concurrency), and the `lifecycle` state machine.
**FRs covered:** FR33, FR38, FR14, FR15, FR1, FR9, FR39, FR40, FR41, FR26, FR27, FR28

### Epic 2: Messaging Engine — Draft + Tap-to-Send

The operator sends professional client messages in one tap. Delivers the compose→deliver spine: operator-editable templates (confirmation, rebooking, win-back, payment reminder), the channel-agnostic `MessageDraft`, the v1 deep-link (`wa.me`/`sms:`) adapter, and dispatch logging that distinguishes drafted from dispatched. First payoff is the booking-confirmation message (FR8); the reusable engine keeps the message-drafting epics (3, 5) dependency-free.
**FRs covered:** FR19, FR20, FR21, FR8

### Epic 3: Rebooking & Win-Back — Plug the Revenue Leak

The largest recoverable leak: one-time jobs that never repeat, and regulars who quietly go cold. One-tap rebooking proposes each client's next open slot and hands them their per-client link; the post-job nudge converts one-time → repeat; cadence-based lapse detection surfaces gone-cold regulars with a one-tap win-back draft. Owns the client-facing per-client booking surface (open-slot view, per-client token, direct-confirm) so the loop closes without reaching into inbound machinery.
**FRs covered:** FR2, FR3, FR7, FR34, FR10, FR11, FR12, FR13, FR16, FR17, FR18

### Epic 4: Client Self-Booking — Plug the Inquiry Leak

Strangers who ask but never get booked. A public self-serve link and a printable QR let anyone request a slot with no app and no account; new clients land in an operator approval queue that holds no capacity until approved; every inquiry is logged with its source so inquiry → booking conversion is measurable across phone, walk-in, link, and the public homepage (web).
**FRs covered:** FR4, FR5, FR6, FR36, FR37, FR42

### Epic 5: Cash Ledger — Plug the Payment Leak

The ~$500/month that floats unpaid with no record. Each completed job carries a paid/owed status and amount; outstanding balances aggregate into "who owes"; a one-tap payment-reminder draft chases the float; marking paid clears it.
**FRs covered:** FR29, FR30, FR31, FR32

### Epic 6: Leak-Detector Dashboard + Data Export

The honest-numbers payoff. A single phone-legible screen shows current-week utilization, repeat vs. lapsed counts, month-over-month revenue, outstanding balance, the three leak indicators, and the gone-cold list with direct win-back — every element mapping to a leak or a capacity/cash decision, nothing vanity. Plus CSV export so the operator owns the data. Last because it aggregates every prior epic.
**FRs covered:** FR22, FR23, FR24, FR25, FR35

## Epic 1: Operator's Book — Foundation + Manual Scheduling

The operator logs in and runs the entire book by hand, and this epic lays the substrate every later epic extends: Next.js 16 scaffold, Drizzle/Postgres, operator seed + `owner_id`, the single `capacity.commitBooking`, and the `lifecycle` state machine.

### Story 1.1: Authenticated shell + operator seed

As the operator,
I want to log into my own private dashboard,
So that only I can touch the book.

**Acceptance Criteria:**

**Given** a fresh deploy
**When** the app boots
**Then** a one-row Operator seed migration establishes the `owner_id` every table will reference (AR9)
**And** secrets load from Vercel env (AR18)

**Given** the Next.js 16 App Router scaffold with Drizzle→Postgres wired (AR1, AR2)
**When** an unauthenticated visitor hits an `(operator)` route
**Then** `proxy.ts` redirects to sign-in and only the seeded operator's session is accepted (FR33)

**Given** a signed-in operator
**When** the dashboard renders
**Then** it is an empty authenticated shell, server-rendered (RSC), with no client login for anyone else

### Story 1.2: Create & edit client records

As the operator,
I want to add and edit clients directly,
So that I can seed my existing regulars and add a caller on the spot.

**Acceptance Criteria:**

**Given** the client form
**When** I save name, phone, address, and cadence (`weekly|biweekly|monthly|one-time`)
**Then** a `Client` row is written with my `owner_id` and `status=active` (FR38, FR14, FR15)

**Given** an existing client
**When** I edit any field
**Then** the record updates
**And** every client query is `owner_id`-filtered from day one (AR9)

**Given** a missing phone or name
**When** I save
**Then** the Server Action returns `{ok:false, reason}` and nothing is written (AR15)

### Story 1.3: Configure availability & caps

As the operator,
I want to set my working days and caps,
So that the book reflects how much I actually work.

**Acceptance Criteria:**

**Given** capacity settings
**When** I view them
**Then** defaults are Mon–Sat working days, per-day cap 3, weekly ceiling 14, and default job price $200 — all editable (FR1, AR16)

**Given** I change a working day or a cap
**When** I save
**Then** the config persists and all downstream math uses it

**Given** any capacity or week arithmetic
**When** computed
**Then** it runs in the operator's local timezone with the week boundary Mon–Sun (AR10)

### Story 1.4: Direct booking with cap enforcement & one-winner concurrency

As the operator,
I want to book a job for any client with caps enforced and an explicit override,
So that I never accidentally double-book — but can choose to when I mean to.

**Acceptance Criteria:**

**Given** a client and a target date
**When** I book
**Then** `capacity.commitBooking` inserts the `Job` inside one transaction after re-checking the per-day cap and the weekly-14 ceiling (FR39, FR9, AR3)

**Given** the day or week is full
**When** I book without override
**Then** it is rejected with a machine reason (`day-maxed` | `week-full`) and nothing is written — no silent overbook (FR9, AR15)

**Given** the day or week is full
**When** I set the override flag
**Then** the booking commits with `Job.overridden=true`, feeding the overbooking counter-metric (FR39)

**Given** two concurrent claims on the last open slot
**When** both attempt to commit
**Then** a `SELECT … FOR UPDATE` / `pg_advisory_xact_lock` serializes them so exactly one wins and the other receives no-availability (AR4)
**And** a concurrency stress test proves single-winner behavior

**Given** any `Job`
**When** capacity is computed
**Then** `consumesSlot` treats `booked|completed|no-show` as consuming and `cancelled` as not (AR3)

### Story 1.5: Mark job outcome (completed / no-show)

As the operator,
I want to mark how a job ended,
So that repeat, lapse, and ledger logic have a truthful basis.

**Acceptance Criteria:**

**Given** a booked job
**When** I mark it `completed`
**Then** `lifecycle` transitions `booked→completed`, it becomes ledger-eligible, and it sets the basis for the expected-next-date (FR40, AR11)

**Given** a booked job
**When** I mark it `no-show`
**Then** it still consumes the slot but is not payment-eligible and does not advance rebooking or lapse logic (FR40)

**Given** a terminal state
**When** anything attempts to transition out of `no-show`/`cancelled`
**Then** only an explicit operator correction is allowed and no other path writes `completion` (AR11)

### Story 1.6: Cancel & reschedule with capacity release

As the operator,
I want to cancel or move a booking,
So that freed time reopens for others.

**Acceptance Criteria:**

**Given** a booked job
**When** I cancel it
**Then** its slot's capacity is released back into room-left and day-maxed, and it is not counted completed for lapse or repeat (FR41, AR3)

**Given** a booked job
**When** I reschedule it
**Then** the original slot is released and the new one commits inside one transaction under the cap check, so capacity is never transiently double-held or lost (FR41, AR12, AR3)

### Story 1.7: Forecasting-lite — room-left, day-maxed, nearest-open

As the operator,
I want to see capacity at a glance,
So that I can decide accept or pass mid-call.

**Acceptance Criteria:**

**Given** the current week
**When** the dashboard renders
**Then** `derive` computes room-left = 14 − consuming jobs this week (FR26, AR8)

**Given** a working day at its per-day cap
**When** rendered
**Then** it is marked day-maxed (FR27)

**Given** a requested day is day-maxed
**When** I look
**Then** the nearest days with room are surfaced (FR28)
**And** all values are derived on read — no stored flags, no cron (AR8)

## Epic 2: Messaging Engine — Draft + Tap-to-Send

The operator sends professional client messages in one tap. This epic delivers the compose→deliver spine — templates, the channel-agnostic `MessageDraft`, the v1 deep-link adapter, and dispatch logging — so the message-drafting epics that follow stay dependency-free.

### Story 2.1: Operator-editable message templates

As the operator,
I want editable message templates,
So that outbound texts sound like me and carry the right details.

**Acceptance Criteria:**

**Given** template settings
**When** I view them
**Then** four templates exist — booking confirmation, rebooking nudge, win-back check-in, payment reminder — as editable text with `{client}`/`{slot}`/`{amount}` placeholders (FR20)

**Given** I edit a template
**When** I save
**Then** it persists per `owner_id` and later composes use it

**Given** a placeholder with no value
**When** composed
**Then** it resolves to empty/safe text, never a literal `{amount}` leak

### Story 2.2: Compose → MessageDraft → deep-link delivery

As the operator,
I want a one-tap draft that opens my WhatsApp/SMS pre-filled,
So that I send without retyping.

**Acceptance Criteria:**

**Given** `(client, slot, amount, template)`
**When** I request a draft
**Then** `compose` returns a channel-agnostic `MessageDraft{recipient, body, type}` with no transport details inside (AR6)

**Given** a `MessageDraft`
**When** I tap send
**Then** the `lib/delivery` adapter renders it to a `wa.me`/`sms:` deep-link and my phone opens the message pre-filled (FR19)

**Given** v1
**When** any message is prepared
**Then** nothing sends autonomously — the operator's tap is required (FR19)

### Story 2.3: Dispatch logging (drafted vs dispatched, idempotent)

As the operator,
I want each send recorded once,
So that nudge-fatigue is measured honestly.

**Acceptance Criteria:**

**Given** a rendered draft
**When** it is created
**Then** `MessageLog.drafted_at` is set and no dispatch is logged on render (AR6)

**Given** I tap send
**Then** `dispatched_at` is recorded once per draft and a re-tap does not double-log (AR6, FR21)

**Given** the nudge-fatigue counter
**When** computed
**Then** it reads only `dispatched_at`, per client per week (FR21)

### Story 2.4: Booking-confirmation message

As the operator,
I want a confirmation draft the moment a booking is confirmed,
So that the client gets certainty and I look organized.

**Acceptance Criteria:**

**Given** a confirmed booking
**When** it commits
**Then** the system produces a booking-confirmation `MessageDraft` via the confirmation template (FR8)

**Given** the confirmation draft
**When** I tap send
**Then** it dispatches through the 2.2 adapter and logs once via 2.3

**Given** the job record
**When** confirmed
**Then** it already carries client, date, and price from Epic 1 — this story adds only the message (FR8)

## Epic 3: Rebooking & Win-Back — Plug the Revenue Leak

The largest recoverable leak: one-time jobs that never repeat and regulars who quietly go cold. This epic owns the client-facing per-client booking surface so the rebooking loop closes without reaching into inbound machinery.

### Story 3.1: Client booking surface + per-client link

As a client,
I want to open my own booking link and see real open slots,
So that I can book in seconds with no app and no account.

**Acceptance Criteria:**

**Given** a per-client signed token scoped to one client (AR7)
**When** the client opens the link
**Then** they see only genuinely-open slots (day under cap AND week under 14) with no login required (FR2, FR34)

**Given** a per-client token
**When** it is generated
**Then** it is unguessable and bound to exactly one client's `owner_id` record (FR3, AR7)

**Given** any client-facing link
**When** accessed
**Then** access is by token only — a bearer can do exactly what the token scopes, nothing more (FR34, AR7)

### Story 3.2: Known-client direct-confirm booking

As a known client,
I want to pick a slot and have it booked immediately,
So that rebooking takes one tap.

**Acceptance Criteria:**

**Given** a client on their per-client link
**When** they confirm an open slot
**Then** `commitBooking` attaches the Job to the existing client record without re-collecting identity and confirms directly — no approval step (FR7)

**Given** a double-tap or repeat submit
**When** it reaches `commitBooking`
**Then** an idempotency key returns the same Job, never a second (AR13)

**Given** the slot filled between view and confirm
**When** they submit
**Then** they receive no-availability rather than an overbook (FR9, AR4)

### Story 3.3: One-tap rebooking proposal + message

As the operator,
I want a one-tap rebooking action that proposes the right next slot,
So that repeat business happens before I leave the driveway.

**Acceptance Criteria:**

**Given** a completed or upcoming job
**When** I tap rebook
**Then** for a cadenced client it proposes the slot at their cadence interval, and for a one-time client the soonest open slot (FR10, AR8)

**Given** the proposed slot
**When** the action fires
**Then** it composes a rebooking `MessageDraft` pre-filled with the slot and the client's per-client link, ready to send via Epic 2 (FR11)

**Given** no open slot at the target cadence
**When** I tap rebook
**Then** the nearest open alternative is proposed rather than a failure

### Story 3.4: Post-job nudge + rebooking tracking

As the operator,
I want a nudge right after I finish a job,
So that I never forget to ask for the next one.

**Acceptance Criteria:**

**Given** a job just marked completed
**When** the outcome is recorded
**Then** a prompt surfaces to send that client's rebooking message (FR12)

**Given** a rebooking nudge
**When** it is sent and later leads to a booking
**Then** both facts are recorded to feed the one-time → repeat conversion metric (FR13)

### Story 3.5: Lapse detection — expected-next-date + gone-cold

As the operator,
I want regulars flagged the moment they slip,
So that I catch them within a week instead of losing them.

**Acceptance Criteria:**

**Given** a client's last completed job and cadence
**When** the dashboard renders
**Then** `derive` computes the expected next booking date (FR16, AR8)

**Given** the current date passes the expected date with no future booking on file
**When** rendered
**Then** the client is flagged gone-cold, with latency scaled per cadence and no extra grace period (FR17)

**Given** gone-cold status
**When** computed
**Then** it is a view-time derivation — no stored flag, no cron (AR8)

### Story 3.6: Win-back action

As the operator,
I want a one-tap win-back for a cold regular,
So that reviving them is effortless.

**Acceptance Criteria:**

**Given** a gone-cold client
**When** I tap win-back
**Then** a check-in `MessageDraft` is composed via the win-back template, ready to send through Epic 2 (FR18)

**Given** the win-back message
**When** I tap send
**Then** it dispatches and logs once via the messaging engine (FR18, AR6)

## Epic 4: Client Self-Booking — Plug the Inquiry Leak

Strangers who ask but never get booked. A public link and QR let anyone request a slot; new clients land in an approval queue that holds no capacity; every inquiry is logged with its source.

### Story 4.1: Public self-serve link + QR

As a prospective client,
I want to scan a code or tap a link and see open slots,
So that I can request a booking without calling.

**Acceptance Criteria:**

**Given** exactly one public signed token exists (AR7)
**When** a visitor opens it
**Then** they see the open-slot booking view (reused from Story 3.1) with no account (FR4)

**Given** the public token's URL
**When** a QR is generated
**Then** the QR encodes the public link for print/physical placement (FR5, AR7)

### Story 4.2: New-client public booking → provisional record + pending request

As a new client,
I want to enter my details and request a slot,
So that the operator can confirm me.

**Acceptance Criteria:**

**Given** a new client on the public link
**When** they submit name, phone, and service address
**Then** a provisional `Client` record is created and the booking is recorded as a `PendingRequest` that neither reserves nor consumes capacity (FR6, AR5)

**Given** a link visit that begins a booking
**When** submitted
**Then** at most one `link` Inquiry is auto-logged for that token-visit session (AR12)

### Story 4.3: Operator approval queue

As the operator,
I want to approve or decline pending requests,
So that strangers never silently hold my slots.

**Acceptance Criteria:**

**Given** pending new-client requests
**When** I open the queue
**Then** I see each request and can approve or decline it (FR36)

**Given** I approve a request
**When** it commits
**Then** `commitBooking` re-checks the cap and consumes capacity; the first approval on a shared slot wins and the rest are surfaced as no-longer-available (FR36, AR4, AR5)

**Given** I decline a request
**When** processed
**Then** the slot is untouched and no capacity changes (FR36)

### Story 4.4: Log inquiry with source

As the operator,
I want to log phone and walk-in inquiries,
So that inquiry → booking conversion reflects reality, not just link visits.

**Acceptance Criteria:**

**Given** a verbal inquiry
**When** I log it
**Then** it is recorded with a source (`phone|walk-in|link|referral|web|other`), independent of any booking link (FR37)

**Given** an auto-logged link inquiry and a manual log for the same contact
**When** conversion is computed
**Then** the denominator dedupes to distinct inquiries so it is not double-counted (FR37, AR12)

### Story 4.5: Public marketing homepage + self-serve request

As a prospective client,
I want a public homepage that explains the service and lets me request a booking,
So that I can reach the business without a per-client link or a phone call.

**Acceptance Criteria:**

**Given** an anonymous visitor at `/`
**When** the page loads
**Then** they see the marketing homepage with no auth gate, while every operator surface stays behind sign-in (FR42, FR33)

**Given** a visitor submits the self-serve request (name, phone, address)
**When** processed
**Then** a provisional `Client` + `PendingRequest` are created (reusing FR6/AR5) and one Inquiry is logged with source `web` (FR42, FR37, AR12)

**Given** the public homepage submit surface is unauthenticated
**When** submitted
**Then** input is length-capped/validated; the write is subject to the accepted public-write rate-limit gap (LOCKED, sprint-status Epic-4 action item)

## Epic 5: Cash Ledger — Plug the Payment Leak

The ~$500/month that floats unpaid with no record. Each completed job carries a paid/owed status; outstanding balances aggregate; a one-tap reminder chases the float.

### Story 5.1: Per-job payment status

As the operator,
I want every completed job to carry paid or owed,
So that I always know what's outstanding.

**Acceptance Criteria:**

**Given** a completed job
**When** the ledger records it
**Then** it carries a payment status of `paid` or `owed` with the amount (FR29)

**Given** a job that is not completed
**When** the ledger is consulted
**Then** it is not ledger-eligible — only a `completed` job may be `owed`/`paid` (FR29, AR11)

### Story 5.2: Outstanding aggregation — "who owes"

As the operator,
I want owed jobs totalled,
So that I can see the float at a glance.

**Acceptance Criteria:**

**Given** owed jobs
**When** the dashboard renders
**Then** `derive` flags them and aggregates their amounts into the outstanding balance (FR30, AR8)

**Given** the outstanding total
**When** computed
**Then** it is derived on read from `owed` job amounts — no stored running total (FR30, AR8)

### Story 5.3: Payment-reminder draft

As the operator,
I want a one-tap reminder for an owed job,
So that chasing money is frictionless.

**Acceptance Criteria:**

**Given** an outstanding job or client
**When** I tap remind
**Then** a payment-reminder `MessageDraft` is composed via the reminder template, ready to send through Epic 2 (FR31)

**Given** v1
**When** a reminder is prepared
**Then** it is operator-triggered and never auto-sent (FR31, FR19)

### Story 5.4: Mark paid

As the operator,
I want to mark an owed job paid,
So that the outstanding total stays honest.

**Acceptance Criteria:**

**Given** an owed job
**When** I mark it paid
**Then** its payment flips to `paid` and it clears from the outstanding total (FR32)

**Given** `markPaid`
**When** it runs
**Then** it sets `payment` only and never alters `completion` (FR32, AR11)

## Epic 6: Leak-Detector Dashboard + Data Export

The honest-numbers payoff — one phone-legible screen where every element maps to a leak or a cash/capacity decision. Last because it aggregates every prior epic.

### Story 6.1: Single-screen dashboard core

As the operator,
I want one screen with my real numbers,
So that I run the business on truth, not vanity.

**Acceptance Criteria:**

**Given** the current week
**When** the dashboard renders
**Then** it shows current-week utilization (of 14), repeat vs. lapsed counts, month-over-month revenue, and outstanding balance — all derived on read (FR22, AR8)

**Given** metric math
**When** computed
**Then** utilization = booked ÷ 14 and the repeat-booking rate follows the addendum-F rolling-30-day definition (AR19)

**Given** any candidate element
**When** placed on the dashboard
**Then** it maps to a named leak or a capacity/cash decision, or it does not ship (FR25, NFR1)

### Story 6.2: Leak indicators

As the operator,
I want the three leak indicators front and center,
So that I can see which leak is closing.

**Acceptance Criteria:**

**Given** logged inquiries, bookings, and completions
**When** the dashboard renders
**Then** it surfaces inquiry → booking conversion, one-time → repeat conversion, and the count of regulars caught cold this week (FR24, AR19)

**Given** the caught-cold indicator
**When** computed
**Then** it counts gone-cold flags raised within 7 days of the missed expected-next-date this week (AR19)

### Story 6.3: Gone-cold list with win-back access

As the operator,
I want the cold regulars listed with a direct win-back,
So that acting on a lapse is one tap from the dashboard.

**Acceptance Criteria:**

**Given** gone-cold clients (from Story 3.5)
**When** the dashboard renders
**Then** they are listed with direct access to the win-back action from Story 3.6 (FR23)

### Story 6.4: CSV export

As the operator,
I want to export my clients and jobs,
So that I own my data, not rent it.

**Acceptance Criteria:**

**Given** a signed-in operator
**When** I request an export
**Then** a Server Action streams the owner's client and job rows as CSV (FR35, AR17)

**Given** the export
**When** it runs
**Then** it returns only rows scoped to my `owner_id` (FR35, AR9)
