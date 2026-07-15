# LovesCleaning PRD — Addendum

Depth that belongs downstream (architecture, UX, solution design) or earned a place but does not fit the PRD's main narrative. Not authoritative for requirements — the PRD is. This preserves *why* and *what-else-was-considered* so decisions aren't re-litigated.

## A. Rejected / Deferred Alternatives (with rationale)

- **Card-on-file / auto-charge-at-completion → rejected.** Cash stays king. Card processing forces client behavior change, adds PCI surface and processor fees, and solves a leak (float) that a ledger + reminder addresses at near-zero cost and zero behavior change. Dropped deliberately from earlier plans.
- **Autonomous message sending (WhatsApp Business API / Twilio) → deferred.** Auto-send needs API accounts, opt-in consent tracking, per-message cost, and delivery-failure handling. For v1 the operator is always in the loop between jobs; draft + tap-to-send delivers the same client outcome with none of that infrastructure. Revisit if message volume outgrows manual sending.
- **Native mobile app → rejected.** Nothing for the operator or clients to download. Phone-web + the operator's existing WhatsApp/SMS covers both sides.
- **Flat 14/week capacity (no per-day structure) → rejected.** Loses the "day-maxed" signal and permits piling a single day. Per-day cap + weekly ceiling gives forecasting-lite something real to compute.
- **Time-slot (clock-time) scheduling → deferred.** Real start times + durations is closer to full field-service software and heavier than the leak requires. Per-day caps are enough to decide accept/pass. Revisit only if clients demand specific times.
- **Team-management / vanity dashboards → rejected for v1.** The dashboard is a leak detector, not an ops console. Every element maps to a leak or a cash/capacity decision (PRD NFR7, FR25).
- **Advertising / lead-generation → rejected.** The problem is a demand *leak*, not a drought. Spend goes to fill, not acquisition; revenue grows by fill, not price hikes.

## B. Messaging Transport — options considered

v1 decision: **draft + tap-to-send** (PRD FR19). The system composes text and hands it to the operator's WhatsApp or SMS pre-filled (e.g. `https://wa.me/<number>?text=<encoded>` style deep-link, or the platform share/compose sheet). No message is sent without an operator tap.

Considered and set aside for later:
- **WhatsApp Business Platform (Cloud API):** template-message approval, opt-in management, per-conversation pricing.
- **SMS gateway (Twilio et al.):** simpler API, but per-segment cost and carrier compliance (A2P registration).
Both become relevant only if/when auto-send is wanted. Architecture should keep the message-composition layer decoupled from the delivery mechanism so a future auto-send transport can slot in without reworking templates.

## C. Capacity Model — assumptions to confirm (feeds OQ-1)

- Working days: **Mon–Sat** (default). Per-day cap: **3** (default). 6 × 3 = 18 theoretical, hard-capped at **14/week** — the weekly ceiling binds before the per-day product does, leaving the operator slack days. Confirm both defaults; they set every downstream forecasting number.
- Concurrency: the last open slot under a public link is the classic double-book risk (PRD NFR4). Architecture must resolve concurrent claims to exactly one winner (transactional check against the day-cap and week-cap at commit time).
- Approval queue (FR36): new-client requests do **not** hold the slot, so several pending requests can target the same slot. Capacity is only consumed at approval, where FR9's cap check re-runs; the first approval wins and the rest must be shown as no-longer-available. This trades a small operator-facing "slot just filled" moment for zero stranger-held phantom reservations. Known clients (per-client link) skip the queue and confirm directly.

## D. Client Data Model — shape for architecture (feeds FR14–FR17)

Indicative, not prescriptive — architecture owns the final schema:
- **Client:** name, phone, address, cadence (`weekly|biweekly|monthly|one-time`), status (`active|provisional|gone-cold`), created-at.
- **Job:** client-ref, date, price (default $200), completion-status, payment-status (`paid|owed`), amount.
- **Derived:** expected-next-date = last-completed-job-date + cadence interval; gone-cold = now > expected-next-date AND no future job booked.
- **Booking token:** per-client token (scoped, unguessable) and one public token; QR encodes the public token's URL.
- **Message log:** client-ref, type (`confirmation|rebook|winback|reminder`), drafted-at / operator-confirmed — powers nudge-fatigue counter-metric.

## E. Vision Depth — franchise-in-a-box

The same instrument panel is the growth backbone:
- **Multi-cleaner:** onboard a 2nd/3rd cleaner onto the same panel; capacity model generalizes from one operator's 14/week to a small team's aggregate.
- **Geographic routing:** cluster jobs by area to cut drive time as volume grows.
- **Team forecasting:** room-left and day-maxed roll up across cleaners.
- **The playbook:** the software plus the operating method (how to fill a book, catch lapses, chase float) packaged so any solo cleaner can go notebook → full book → small team.
- **Moat mechanics:** compounding client history (who repeats, who churns, seasonal rhythm) is owned by the operator, not rented from a platform. Every job sharpens forecasting and win-back — the advantage is fit, focus, and data accumulation, not a patent or algorithm.

## F. Metric Definitions — precision for implementation

- **Repeat-booking rate (north-star):** of jobs **completed** (FR40) in a rolling **30-day** window, the share for which the **same client** has a subsequent booking **created within 30 days** of that job's completion date. Denominator = completed jobs in the window; numerator = those with a qualifying follow-on booking by the same client. A no-show is not a completed job and does not enter the denominator. This is now fully specified and buildable — no "TBD".
- **Utilization:** jobs booked this week ÷ 14.
- **Inquiry → booking conversion:** bookings ÷ inquiries, over **all logged inquiries** (FR37). Link visits auto-log as `link`; phone/walk-in/referral inquiries are logged manually by the operator. This is the fuller-capture decision — the metric is only as complete as the operator's discipline in logging verbal inquiries, so the UI must make logging a phone inquiry a one-tap action.
- **One-time → repeat conversion:** one-time clients who later book again ÷ one-time clients.
- **Regulars caught cold within 1 week:** count of gone-cold flags raised within 7 days of the missed expected-next-date this week.
- **Payment float:** sum of `owed` job amounts outstanding.
