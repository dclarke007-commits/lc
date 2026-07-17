# LovesCleaning — MVP Build List

**Convergence deliverable** derived from the 2026-07-15 brainstorming session (102 ideas across 10 technique lenses + 1 synthesis insight).

## North Star

Build a **flywheel-centric booking + owner-dashboard core** that a solo cleaner runs entirely from her phone. The site is not a brochure — it is a funnel that converts a visitor into a card-on-file, self-scheduled, route-fit booking in under 60 seconds. Every completed job auto-fires four growth actions (portfolio photo → review → geo-weighted referral → rebook), so repeat and referral revenue compound **without ad spend**. The owner dashboard is the moat: accumulating client preferences and history make each clean better than a competitor's first. Franchise-in-a-box and cleaner co-op are the long-horizon 10x — explicitly out of MVP scope.

## How these were chosen

Each winner had to clear three bars: **(1) Serves a goal** — directly advances *convert visitors → booked jobs*, *run everything from one dashboard*, or *manufacture repeat/referral revenue with no ad spend*. **(2) Solo-buildable** — reasonable cost on the baseline stack (custom booking/calendar, Stripe Checkout + Billing, Twilio SMS, Resend/Postmark email, simple hosting); no feature that needs a team to operate. **(3) Foundational** — it either turns the flywheel or unblocks a later idea. Ideas that were clever but heavy, premature, or non-load-bearing were deferred.

---

## P0 — MVP Core (the must-ship spine)

Ship these together; the flywheel does not turn until all are live.

### 1. Instant self-serve booking + smart booking link
One shareable link (`book.lovescleaning.com`) that is the entire funnel — no homepage required. Visitor picks service, date, address, done. Kills the "call to book" failure mode.
- **Goal:** convert visitors → jobs. **Effort:** M. **Deps:** data model (#3). **Stack:** custom Next-style booking flow + simple hosting.

### 2. Real-availability calendar with hard capacity cap
Calendar shows only genuinely open slots and enforces a daily job cap so she can't overbook or burn out. Instant-confirm (OpenTable-style), no back-and-forth.
- **Goal:** convert → jobs; dashboard-run ops. **Effort:** M. **Deps:** #3. **Stack:** custom calendar/availability engine.

### 3. Core data model (client · job · preferences · schedule)
The foundation everything else reads/writes: clients, jobs, recurring rules, preferences, ratings, referral edges, addresses/geo. This is the moat's substrate.
- **Goal:** dashboard-run ops (enabler for all three). **Effort:** M. **Deps:** none — build first. **Stack:** Postgres (or Supabase).

### 4. 60-second onboarding + card-on-file
Three questions, card captured, booked — under 60s, under 10s per action. Card-on-file is mandatory (no booking without it).
- **Goal:** convert → jobs; kills payment-chasing. **Effort:** S–M. **Deps:** #1, #3. **Stack:** Stripe Checkout / SetupIntent (save payment method).

### 5. Auto-charge card at job completion (eliminate invoicing)
Owner marks job done → card charged → receipt texted automatically. Never chase payment again. Voice-friendly "mark done" for gloved hands.
- **Goal:** dashboard-run ops; repeat revenue reliability. **Effort:** S–M. **Deps:** #4, #6. **Stack:** Stripe PaymentIntents (off-session) + Twilio SMS receipt.

### 6. One-screen owner dashboard
Entire operation on one glanceable phone screen: today's route/jobs, next actions, mark-done, payment status. Zero training, zero back-office.
- **Goal:** run everything from one dashboard. **Effort:** M. **Deps:** #2, #3, #5. **Stack:** mobile-first web app.

### 7. Per-job flywheel trigger (photo → review → referral → rebook)
Marking a job done auto-fires four actions: capture/attach before-after photos to the portfolio, send review request, present a referral offer, prompt the next booking. The single highest-leverage growth mechanism.
- **Goal:** repeat/referral revenue, no ad spend. **Effort:** M. **Deps:** #5, #6, #8, #9. **Stack:** event on job-complete → Twilio SMS + Resend/Postmark email.

### 8. Before/after photo capture
Snap photos in-app per job; builds an undeniable portfolio and feeds the review/referral moment. Cleaning is inherently visual — this is proof + marketing in one.
- **Goal:** convert (social proof) + repeat/referral. **Effort:** S. **Deps:** #3. **Stack:** in-app upload → object storage.

### 9. Automatic confirmation + reminder texts
Booking confirmation and pre-job reminder sent automatically; cuts no-shows, sets the "on my way" expectation. Also the rail the flywheel messages ride on.
- **Goal:** convert → jobs; reduce no-shows. **Effort:** S. **Deps:** #1, #3. **Stack:** Twilio SMS (+ Resend/Postmark email fallback).

### 10. Recurring booking ("same as last time")
One-tap rebooking and weekly/biweekly recurring schedules — the busy-parent path and the foundation of predictable revenue.
- **Goal:** repeat revenue. **Effort:** S–M. **Deps:** #2, #3. **Stack:** recurring-rule engine + Stripe for the recurring charge.

---

## P1 — Fast Follow (multipliers once the core turns)

- **Route-aware self-scheduling** — calendar offers only slots that fit her existing route that day; auto-sequences the day by address. Cuts drive time, raises jobs/day. *(M)*
- **Geo-weighted referral** — bigger discount to a *neighbor* of a just-cleaned home; unifies marketing + route efficiency into one lever. *(S–M)*
- **Waitlist fills cancellations** — a cancel instantly offers the slot to a waitlisted client; near-zero idle capacity. *(M)*
- **Lapse-detection win-back** — auto "we miss you" when a recurring client goes quiet; recovers silent churn. *(S)*
- **Review → SEO service-area pages** — auto-published reviews feed always-fresh local pages that feed the booking link; closed organic loop. *(M)*
- **Dynamic slot pricing** — cheaper slow-day slots, premium Saturdays; smooths demand into predictable weekly income. *(M)*
- **Membership / prepaid plans** — drawn-down like a gym membership; predictable MRR + upfront working capital. *(M)*
- **Satisfaction guarantee** — "not happy? free re-clean in 24h," shown as trust, tracked in dashboard. *(S)*
- **Two-way rating** — she rates the client (messy? pets? tip?) so she can fire bad clients; owner-retention as longevity. *(S)*
- **Client-concentration flag** — dashboard warns when one client exceeds X% of revenue. *(S)*

## P2 — Vision / Later

- **AI voice receptionist** — answers/books/reschedules every inbound call in her voice.
- **Photo-to-quote** — camera pan of a home → firm price + duration, no site visit.
- **Smart-lock access** — one-time entry at the booked window; no key exchange.
- **Predictive pre-booking** — auto-books the recurring seasonal deep-clean before she asks.
- **Airbnb/turnover & property-manager modes** — multi-unit dashboards, checkout-synced cleans, B2B channels.
- **Franchise-in-a-box** — license the whole system to other solo cleaners (the real 10x).
- **Cleaner co-op** — metro cleaners share overflow + cover vacations.

## Explicitly deferred / cut

- **AI photo-to-quote at MVP** — high build/accuracy risk; flat/simple pricing ships the funnel now.
- **Smart-lock / IoT integrations** — hardware dependency, tiny near-term coverage; key/lockbox notes suffice.
- **Robotic pre-clean, live timelapse, signature scent, eco supply box, clean-score gamification** — delight/brand flourishes, zero leverage on the three goals.
- **Multi-cleaner crew & co-op tooling** — keep the *data model* crew-ready (5-min add), but build no crew UI until solo is proven.
- **Franchise/marketplace platform** — long-horizon; would fork the roadmap before the core is validated.

## Suggested build sequence (P0 critical path)

1. **#3 Data model** — nothing works without clients/jobs/schedule/geo. Build first.
2. **#1 Booking flow + #2 availability calendar (with capacity cap)** — the funnel; makes the product real and testable.
3. **#4 Onboarding + card-on-file** — captures payment method at booking; unblocks all charging.
4. **#9 Confirmation/reminder texts** — the messaging rail the flywheel will reuse.
5. **#5 Auto-charge at completion + #8 photo capture** — closes the money loop and produces the flywheel's raw asset.
6. **#6 One-screen dashboard** — the operating surface that ties booking, route, and mark-done together.
7. **#7 Flywheel trigger + #10 recurring booking** — turn the growth engine on *last*, once every input it depends on exists.

**Critical path:** `#3 → #1/#2 → #4 → #5 → #6 → #7`. Payments (Stripe save-then-charge) and the messaging rail (Twilio) are the two integrations to de-risk earliest.

## The one metric that matters

**Repeat-booking rate** (share of completed jobs that convert into a next booking — rebook or active recurring). It is the truest proxy for the flywheel spinning: it compounds revenue and drops CAC to near zero.

**Leading indicators to instrument from day one:**
- **Booking-funnel conversion** (link open → confirmed booking) and time-to-book.
- **Flywheel action rate** per completed job — review-request sent/completed, referral offered/redeemed, rebook prompted/accepted.
- **Payment success rate** on auto-charge (card-on-file declines are silent revenue leaks).
