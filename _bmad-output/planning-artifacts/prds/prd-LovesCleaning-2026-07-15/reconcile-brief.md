# Brief → PRD Reconciliation — LovesCleaning

**Source brief:** `briefs/brief-LovesCleaning-2026-07-15/brief.md`
**Against:** `prd.md` + `addendum.md` (2026-07-15)
**Purpose:** Surface brief content — quantitative and qualitative — that the PRD/addendum dropped, weakened, or contradicted. The PRD's functional-requirements structure faithfully carries the *mechanics* of the brief but silently loses much of its *voice, strategic framing, and emotional "why."* Two functional decisions in the PRD also quietly contradict promises the brief makes.

---

## 1. Quantitative figures — verification

| Figure | Brief | PRD/Addendum | Status |
|---|---|---|---|
| 14 jobs/week | line 20, 22 | §1, FR1, §2, addendum C | ✅ Intact |
| 5 jobs booked | line 20 | §1, §2 (5 → 14) | ✅ Intact |
| 64% empty | line 20 | §1 | ✅ Intact |
| $200/job | line 22 | §1, FR8, §8, addendum D | ✅ Intact |
| $4,000 → $11,000/month | line 14, 22, 69 | §1, §2 | ✅ Intact |
| ~$500/month float | line 24, 40, 70 | §1, §2, addendum F | ✅ Intact |
| **~$1,800/week gap** | line 22 | **absent** | ⚠️ **Dropped** |
| **~$7,000/month idle capacity** | line 22 | **absent** | ⚠️ **Dropped** |

**Finding Q-1 (minor).** The two *derived* "size of the prize" numbers — **$1,800/week** and **~$7,000/month of capacity sitting idle** — do not appear anywhere in the PRD or addendum. The PRD keeps the endpoints ($4k→$11k) but drops the per-week / idle-capacity framing that makes the loss feel visceral ("about $7,000 a month of capacity sitting idle"). Not a correctness problem — the math is recoverable ((14−5)×$200×~4 ≈ $7,000) — but the rhetorical punch is gone. *Matters mildly:* these are motivation numbers, useful for onboarding copy and for the operator's own dashboard framing.

All headline quantitative figures survived intact. Only the two intermediate derived figures were lost.

---

## 2. Contradictions / distortions (the ones that matter most)

### D-1 — "Pick a slot and it's booked" is now gated behind operator approval (new clients)
- **Brief says:** "A client picks an open slot and **it is booked** — no phone tag, no forgotten follow-up, no inquiry falling through the cracks." (line 32) The whole "Catch the inquiry" pitch is *instant, frictionless* self-booking.
- **PRD stands:** For a **new** client via the public link, the booking is a **pending request that does not consume capacity** and **awaits operator approval** (FR6, FR9, FR36; addendum C). Only *known* clients on a per-client link confirm instantly (FR7).
- **Assessment:** A genuine distortion of the brief's core promise. The brief presents booking as done-the-moment-they-tap; the PRD inserts an approval step for exactly the audience the brief was most excited about (the new neighbor who "asked but never got booked"). The PRD's rationale (avoid stranger-held phantom slots) is sound, but it trades away part of the "booked in seconds, zero phone tag" magic. **Matters** — this is the headline user-journey promise (UJ-1), and the operator should consciously accept the tradeoff rather than discover it. Worth surfacing: does an unapproved request risk recreating a softer version of the very "inquiry leak" the product exists to kill (a request that sits unapproved = a slot not filled)?

### D-2 — Payment float "chased automatically" vs. manual tap-to-send
- **Brief says:** the system "nudges a reminder over WhatsApp or text so the ~$500 monthly float gets **chased automatically instead of forgotten**." (line 40) Also frames rebooking nudges as arriving on their own.
- **PRD stands:** **FR19** — all outbound messaging is **draft + tap-to-send**; "The system does **not** send messages autonomously in v1." Reminders are "operator-triggered, never auto-sent" (FR31). Autonomous send is explicitly deferred (addendum A, B).
- **Assessment:** Direct tension with the brief's word "**automatically**." The PRD's manual model still beats "forgotten," and the addendum justifies deferral well (no API accounts, opt-in, per-message cost). But the brief's promise of *automatic* chasing is downgraded to *the operator is reminded to chase manually*. **Matters moderately** — the outcome (float gets chased) is preserved; the effort model (operator still has to tap each one) is not what the brief implied. Nudge fatigue counter-metric (a PRD addition) partly guards this. Confirm the operator is fine doing the tapping.

---

## 3. Qualitative losses — strategic framing & "why now"

### V-1 — "Why now" / the inflection-point argument is gone
- **Brief:** an entire beat (line 16, 26): "the owner is at the exact inflection point where the notebook has become the ceiling. Every additional job makes the leak worse and the blind spots costlier." And: "a business permanently stuck at a third of its own capacity."
- **PRD:** no "Why now" section; urgency is stated only as static fact ("the book is 64% empty").
- **Assessment:** The *timing/urgency* argument — the reason to build now rather than later — is dropped entirely. **Matters** for anyone deciding sequencing/prioritization; it's the strategic case, not a requirement, so its absence from an FR doc is defensible, but it's worth preserving somewhere (addendum would be the home).

### V-2 — "The single largest number in the business… entirely self-inflicted"
- **Brief (line 22):** frames the capacity gap as "the single largest number in the business — and it is entirely self-inflicted, the price of not being able to *see* it."
- **PRD:** states the gap neutrally; the "largest number / self-inflicted / price of not seeing" framing is gone.
- **Assessment:** Pure qualitative/strategic framing loss. This is the emotional thesis of the whole product (you're losing your biggest number to blindness). A functional doc won't carry it, but it's the line that should anchor the product's positioning and dashboard hero-metric. **Matters mildly** — feeds marketing/UX voice, not requirements.

### V-3 — "What Makes This Different" (fit, focus, compounding data) is compressed to one line
- **Brief:** a full section (lines 44–53) with four sharp differentiators — *Built by the operator, for the operator* ("no field-service-SaaS bloat… exactly as big as the job"); *Single-minded on the leak* ("built to help you not lose [jobs]… a leak detector, not a wall of vanity charts"); *Zero friction, zero behavior change*; *A moat that grows per job.* Closes: "**The bet is execution speed and obsessive simplicity** — nothing more, and nothing less."
- **PRD:** most of this survives *as constraints* (NFR7 simplicity; FR25 no vanity metrics; §10 "fit, focus, and compounding client-history data"; positioning line "most tools help you run jobs; this one helps you not lose them" is preserved in §10). But the **"execution speed and obsessive simplicity" bet** — the founder's stated strategy — is nowhere.
- **Assessment:** Largely preserved in spirit, but the *why-we-win* narrative is flattened into scattered guardrails. The lost piece that matters: **speed of execution as an explicit strategic bet.** **Matters mildly.**

---

## 4. Qualitative losses — voice, emotion, human texture

These are the "silent losses" a requirements structure can't hold. Each humanizes the product and should feed UX copy, onboarding, and the dashboard's tone — none belong in an FR, but all are worth capturing so they aren't forgotten.

- **E-1 — The awkward-money-conversation motivation.** Brief line 24: cash coming up short is "Just an awkward conversation the cleaner would rather not have." This is the *emotional reason* the ledger + reminder exists — it lets the operator avoid an uncomfortable face-to-face ask. PRD reduces it to a neutral ledger (FR29–32). **The human "why" behind the payment feature is gone.** Matters for how reminder copy and UX should *feel* (frictionless, face-saving).

- **E-2 — The success image.** Brief line 57: success is "walking into a full week he didn't have to chase, and knowing his repeat rate, his utilization, and his outstanding cash **without opening a drawer**." PRD §3 flattens to "Needs a full book and honest numbers… without learning software." The evocative, concrete picture (a full week you didn't chase; numbers without opening a drawer) is lost. Matters for framing the north-star and the dashboard's emotional payoff.

- **E-3 — "nearly triples revenue."** Brief's repeated punchy phrasing ("filling the existing book **nearly triples** revenue," lines 14, 22) becomes bare endpoints in the PRD. Minor.

- **E-4 — Mission cadence.** Brief's three-verb spine — "catch that leak, make it visible, and close it" (line 12) / "catch what leaks, see what leaks, and stop guessing" (line 42) — is *echoed* in the PRD's three-leaks framing but the crisp mission line itself isn't quoted. Minor; the concept survives.

- **E-5 — Tone overall.** The brief is deliberately punchy, narrative, and emotionally resonant ("cash stays king," "the notebook has become the ceiling," "a leak detector, not a wall of vanity charts"). The PRD is clinical by design and appropriately so. Noting only that the brief's *voice* is itself a product asset for a solo-operator tool (the product should feel like it was written by someone who gets the job) — worth preserving as a copy/brand-voice reference, not a requirement.

---

## 5. What the PRD ADDED beyond the brief (not gaps — noted for completeness)

The PRD is not merely lossy; it elaborates in ways the brief didn't specify. These are additions/refinements, flagged so the reconciliation is symmetric:
- **Approval queue** for new-client public bookings (FR6, FR36) — see D-1.
- **Inquiry logging with source** (FR37) — makes inquiry→booking conversion measurable across phone/walk-in/referral, not just link touches. A genuine improvement over the brief's implicit "conversion" metric.
- **Per-client vs. public tokenized links + QR** (FR3–FR5) — the brief said "a real booking link"; the PRD splits it into three concrete mechanisms.
- **Counter-metrics** — overbooking rate, nudge fatigue (§2) — guardrails the brief didn't name; directly protect against gaming the north-star.
- **Per-day cap structure** (FR1, addendum C) — brief implied a flat 14/week; PRD adds day-level caps to give forecasting-lite something real to compute.
- **Explicit cadence field + per-cadence lapse latency** (FR15–FR17) — brief said "caught within one week"; PRD refines to "scales per cadence" (weekly ~1wk, biweekly ~2wk, monthly ~1mo). This is a *precision improvement* but note it slightly weakens the brief's flat "within one week" promise for non-weekly clients (OQ-3 resolved this deliberately).

---

## 6. Summary of gaps, by priority

| # | Gap | Type | Matters? |
|---|---|---|---|
| D-1 | New-client booking gated behind approval — weakens "pick a slot and it's booked" | Distortion | **High** |
| D-2 | Payment/nudge "chased automatically" → manual tap-to-send | Distortion | Medium |
| Q-1 | $1,800/week and ~$7,000/month idle figures dropped | Quantitative | Low–Med |
| V-1 | "Why now" / inflection-point urgency removed | Strategic | Medium |
| V-2 | "Largest number… self-inflicted" thesis removed | Strategic/voice | Low–Med |
| V-3 | "Execution speed + obsessive simplicity" bet removed | Strategic | Low |
| E-1 | Awkward-money-conversation motivation lost | Voice/emotion | Low–Med |
| E-2 | Concrete success image ("full week he didn't chase… without opening a drawer") flattened | Voice/emotion | Low |
| E-3–E-5 | "Nearly triples," mission cadence, overall voice | Voice | Low |

**Bottom line:** Every headline number survived. Two functional decisions (approval queue, manual send) quietly contradict the brief's "instant, automatic" promises and should be consciously ratified. The larger silent loss is qualitative — the brief's *why-now urgency, its "self-inflicted largest number" thesis, and its human/emotional texture* — none fatal to the requirements, but all worth capturing (addendum or a brand-voice note) before they evaporate.
