---
status: draft
updated: 2026-07-18
project: LovesCleaning
sources:
  - .working/extract-prd.md
  - .working/extract-brief.md
  - .working/extract-architecture.md
  - .working/extract-epics.md
---

# LovesCleaning — Experience Spine

> The behavioral counterpart to `DESIGN.md`. DESIGN.md decides how it looks; this decides how it works — information architecture, voice, component behavior, states, interactions, accessibility, and the five journeys. Where a visual is implied, this spine names the DESIGN.md token by `{path}`; the two are read together and the spine wins on behavioral conflict, DESIGN.md wins on visual conflict.

## Foundation

Phone-web on both sides. No native app, no PWA, no offline — the paradigm assumes connectivity because there is no client-side store to fall back on. The operator runs the whole business one-handed, between jobs; a client is a stranger scanning a QR on a van or a regular tapping a link. Neither installs anything.

**Two temperaments, one language.** The operator lives in a dense, dark instrument panel (`{colors.surface-base}`, the default spine); the client meets the calmer light booking surface (`{colors.surface-base-client}`). Same type, same spacing, same component shapes — only the tonal skin flips across the auth boundary. An operator should feel *in command*; a client should feel *invited*. DESIGN.md is the full visual reference for both.

**RSC / Server-Actions-only mutation model — and what it means for interaction.** Every surface is a React Server Component; **Server Actions are the sole mutation path** (AD-1). There is no client data store, no client cache, no REST tier. Consequences this spine is built around:

- **No optimistic client state.** Every action — mark-paid, confirm, approve, send-log — is a server round-trip that returns a re-render. We do not fake success locally; the UI shows the true DB state after the action resolves. Loading states must therefore be honest and fast (NFR3 <2s on 4G), not papered over with optimism.
- **Typed result, never a thrown error.** Actions return `{ ok, data } | { ok:false, reason }`. Capacity rejections carry a **machine reason** (`day-maxed` | `week-full`) that the UI renders as a distinct human state, not a generic toast.
- **Derived-on-read, always live.** `roomLeft`, `goneCold`, repeat-rate, outstanding — all computed fresh every render (AD-7). No stored flags, no cron, no stale-data reconciliation UX. The trade: every view pays a query cost, so surfaces stay lean.
- **Idempotent retaps are safe.** Double-tapping confirm returns the same Job (AD-12); re-tapping send does not double-log dispatch (AD-5). The UI can trust a second tap rather than blocking it.

## Information Architecture

Two surface families divided by the auth boundary. The operator family is one authenticated session under `app/(operator)`; the client family is anonymous, token-scoped, single-purpose under `app/book/[token]`. Every stated need lands on exactly one surface below.

Actor legend: **OP** = authenticated operator · **CLIENT** = per-client token bearer (known) · **PUBLIC** = public-token / QR visitor (stranger).

| # | Surface | Actor | Route family | Primary job |
|---|---|---|---|---|
| S1 | Sign-in | OP | `(operator)` | Authenticate the single seeded operator; `proxy.ts` gates all operator routes. |
| S2 | Authenticated shell / home | OP | `(operator)` | Private container the operator lands in; frame for dashboard + nav. |
| S3 | Client list | OP | `(operator)` | Browse/select clients; entry to records, rebooking, win-back. |
| S4 | Client record — create/edit | OP | `(operator)` | Add/edit name, phone, address, cadence; add a caller on the spot (FR38). |
| S5 | Client detail / history | OP | `(operator)` | A client's history, cadence, payment status; launch per-client actions. |
| S6 | Availability & caps settings | OP | `(operator)` | Working days, per-day cap, weekly-14 ceiling, default price, tz/week boundary (FR1). |
| S7 | Direct booking view | OP | `(operator)` | Book any client with cap re-check + explicit override; handles day-maxed/week-full. |
| S8 | Job detail / outcome controls | OP | `(operator)` | Mark completed / no-show; cancel; reschedule with capacity release. |
| S9 | Forecasting-lite / capacity view | OP | `(operator)` | Room-left, day-maxed days, nearest-open days — accept/pass mid-call (FR26–28). |
| S10 | Message templates settings | OP | `(operator)` | Edit the 4 templates with `{client}/{slot}/{amount}` placeholders (FR20). |
| S11 | Draft preview → tap-to-send | OP | `(operator)` | Review `MessageDraft`, tap to open WhatsApp/SMS pre-filled; dispatch logged once. **Shared primitive** reused by S5, S9-adjacent, S12, S13, S15, S23. |
| S12 | Post-job rebooking nudge | OP | `(operator)` | Prompt surfaced right after marking a job complete (FR12). |
| S13 | Rebooking action / proposal | OP | `(operator)` | One-tap propose next slot (cadence or soonest); compose draft with per-client link. |
| S14 | Gone-cold / lapse list | OP | `(operator)` | Regulars past expected-next-date; each exposes win-back. Standalone + on dashboard. |
| S15 | Win-back action | OP | `(operator)` | One-tap check-in draft for a cold regular (FR18). |
| S16 | Client booking surface (per-client link) | CLIENT | `book/[token]` | Token-scoped open slots; pick + **direct-confirm**, no login, no re-identify. |
| S17 | Public self-serve booking surface | PUBLIC | `book/[token]` | Same open-slot view via the one public token; no account (FR4). |
| S18 | QR code surface / printable | OP→PUBLIC | `(operator)` | Generate/display QR encoding the public link for print (FR5). |
| S19 | New-client public booking form | PUBLIC | `book/[token]` | Capture name/phone/address → provisional client + PendingRequest, **no capacity held**. |
| S20 | Operator approval queue | OP | `(operator)` | Review pending requests; approve (commit + cap re-check) / decline; first-approved-wins. |
| S21 | Log inquiry form | OP | `(operator)` | One-tap record of phone/walk-in/referral/other inquiry with source (FR37). |
| S22 | Cash ledger / "who owes" | OP | `(operator)` | Completed jobs' paid/owed + amounts; aggregated outstanding; mark-paid. |
| S23 | Payment-reminder action | OP | `(operator)` | One-tap reminder draft for an owed job/client; routes through S11 (FR31). |
| S24 | Leak-detector dashboard | OP | `(operator)` | The one screen: utilization/14, repeat-vs-lapsed, MoM revenue, outstanding, 3 leak indicators, gone-cold list. |
| S25 | CSV export action | OP | `(operator)` | Stream owner-scoped client + job rows as CSV (FR35). |

**Operator navigation.** The dashboard (S24) is home — the operator opens the app to it. From the dashboard's leak indicators and gone-cold list, the operator taps straight into the relevant action (win-back S15, ledger S22, forecasting S9). A light nav reaches the durable lists: Clients (S3), Ledger (S22), Queue (S20), Settings (S6/S10). Detail and action surfaces (S4/S5/S7/S8/S13/S15/S23) are pushed *from* a list or a dashboard row — never top-level. S11 is not a "screen" you navigate to; it is the sheet every drafting action raises.

**Client family** is deliberately tiny and cannot reach any operator surface. A per-client token does exactly one thing (book for one known client, S16, direct-confirm). The single public token can only create pending requests (S17→S19) that **never consume capacity** until the operator approves in S20. The QR (S18, operator-generated) lands strangers on the public flow.

**Honest reconciliation of the "book in seconds" promise.** The approval queue holds *no capacity* — a public/new-client booking is a **request**, not a confirmation (D-1). This is a real tension with the marketing promise, and the Voice section resolves it in copy: the client's confirmation screen must say *request received, holding your spot, you'll hear back* — never "Booked!" — while a *known* client on a per-client token genuinely does book in seconds (direct-confirm). Seconds-to-book is true for regulars; seconds-to-*request* is the honest version for strangers.

→ Composition reference: DESIGN.md mockups. Spine wins on behavioral conflict.

## Voice and Tone

Microcopy only; brand voice posture and aesthetic live in `DESIGN.md`. The rule: **operator-native, punchy, plain-spoken** — copy that reads like it was written by someone who's done the job. Counts and verbs, not encouragement. Never corporate, never a collections notice, never celebratory chrome.

| Do | Don't |
|---|---|
| "9 / 14 this week" | "You have booked 9 of 14 available slots! 🎉" |
| "Room left: 5" · "Thursday's maxed — Friday's open" | "No availability for the selected date." |
| "Maria's gone cold" | "Client re-engagement opportunity detected" |
| "Who owes" · "$240 out" | "Outstanding accounts receivable" |
| "Rosa asked to book. Holding her spot." | "New booking request pending approval" |
| "Sent." (with a check + time) | "✓ Message dispatched successfully" |
| "Slot's gone — someone grabbed it first." | "Error: booking conflict (409)" |

**Capacity rejections** are spoken as a human closing a door and pointing at the next one, not as errors. `day-maxed` → *"Thursday's full. Friday and Monday have room."* `week-full` → *"Week's booked out — 14/14. Next open week starts Monday."* slot-just-taken → *"Ah — that one just went. Here's what's still open."* Always pair the closed door with the nearest open one.

**Payment / reminder copy is face-saving by design.** The ledger exists so the operator can skip the awkward face-to-face ask; the copy must lower that friction, never raise it. Reminder draft default (operator-editable, S10): *"Hi {client} — hope the place is looking good! Whenever you get a sec, here's for last week's clean: {amount}. Thanks!"* Never *"Payment overdue"*, never a due-date threat, never red in the client's message. On the operator's own ledger the number can go `signal-critical` (see State Patterns) — but the *outgoing* copy stays warm.

**Rebooking / win-back is a friendly check-in, not a sell.** Rebook default: *"Same time next week, {client}? Here's your link: {slot}."* Win-back default: *"Hey {client} — it's been a bit! Want me to swing by this week?"*

**Placeholder safety:** an unresolved `{amount}` renders empty, never leaks the literal token (2.1).

## Component Patterns

Behavioral specs; visual specs live in `DESIGN.md.Components`. Each references its visual token.

| Component | DESIGN.md token | Behavioral rules |
|---|---|---|
| **Metric tile** | `{components.metric-tile}` | Atomic dashboard unit. Value stays neutral `{colors.ink-primary}` until it crosses a threshold, then adopts the matching signal — a healthy repeat rate is white, a cold one goes `{colors.signal-warn}`. Color is *earned*; a tile that is always colored teaches nothing. Whole tile is one tap target into its detail surface. |
| **Hero-metric tile** | `{components.hero-metric-tile}` | The "**N / 14**" week-book readout, full-width, top of S24 — the one number the operator opens the app to see. Value neutral while there's room; tints `{colors.signal-warn}` as the week fills, `{colors.signal-critical}` at 14/14. Set in `{typography.hero-metric}` (mono/tabular) so the digit doesn't shimmer as it changes. |
| **Capacity meter** | `{components.capacity-meter}` | Thin bar under the hero. Fill runs `{colors.signal-go}` → `{colors.signal-warn}` (near-cap) → `{colors.signal-critical}` (full). This is the glanceable gauge for the UJ-4 accept/decline decision — readable without reading a number. |
| **Booking-slot chip** | `{components.slot-chip}` | Client surface. **Only genuinely-open slots ever render** — day-maxed / week-full slots are *absent*, never shown greyed-and-disabled (a disabled slot still advertises a door the client can't open). Tap selects → fills `{colors.signal-go-client}`. ≥48px. |
| **Status pill** | `{components.status-pill}` | Tinted text on a ~12%-alpha signal wash, never a full-saturation fill. Carries the lifecycle enums: `booked`/`completed`/`no-show`/`cancelled`, `active`/`provisional`/`gone-cold`, `paid`/`owed`. Semantics: `paid`/settled reads green `{colors.signal-paid}` (`{colors.signal-paid-client}` on the light surface) — reserved for money-cleared only; `booked`/go/active reads amber `{colors.signal-go}`; attention states (`gone-cold`, `owed`-not-yet-overdue) read ember `{colors.signal-warn}`; and an `owed` pill **escalates to red `{colors.signal-critical}` once the job goes overdue**, alongside `no-show`/`cancelled` hard-stops. Same semantics both temperaments. |
| **Draft-preview → tap-to-send card** | `{components.draft-preview-card}` | The universal messaging primitive (rebook, win-back, reminder, confirmation all funnel here). Shows the **fully composed message text for review** with a single `{components.button-primary}` "Send" that opens WhatsApp/SMS via deep-link. Visually distinguishes `drafted` (neutral) from `dispatched` (a `{colors.signal-go}` check + timestamp). **Never auto-sends** — the operator always sees and can edit the text first (AD-5/FR19). Re-tapping Send does not double-log. |
| **List row** | `{components.list-row}` | Client list, ledger, queue, gone-cold. `{typography.body}` title + `{typography.caption}` meta, trailing one-tap action or status pill. ≥56px. The queue variant surfaces the "first approved wins — others no longer available" race inline on the row itself. |
| **Primary button** | `{components.button-primary}` | The one committing action on a surface — confirm booking (S7, with the capacity-override path), Send draft (S11), approve request (S20), mark-paid (S22), direct-confirm (S16). Amber fill, dark ink, ≥48px. **At most one per surface**; if a screen seems to need two primaries, the surface is doing two jobs. Because mutation is a Server-Action round-trip (no optimistic state), on tap it enters an honest in-flight/disabled state until the server re-render resolves — never a fake local success. Idempotent: a double-tap returns the same result, so a second tap is safe, not blocked. |
| **Ghost button** | `{components.button-ghost}` | Secondary, reversible, or escape actions that must not compete with the primary — Copy text (S11), Back/Cancel-edit, Decline (S20, paired beside Approve), alternate-slot. Transparent with `{colors.hairline}` border, `{colors.ink-primary}` label, ≥48px. **Never the sole action on a surface** and never carries the commit. Genuinely destructive actions (cancel a booking, decline a request) are ghost-styled *and* gated behind a confirm step — reversibility lives in the flow, not just the color. |

## State Patterns

Capacity-full and race states are **first-class flows** (AD-2/3/4), not error afterthoughts — the product's entire reason for existing is that these moments were previously invisible.

| State | Where | Treatment |
|---|---|---|
| **Empty** | Fresh deploy / empty list | Dashboard on day one: hero shows `0 / 14` neutral. Empty client list / no gone-cold / no owed each say the plain truth in `{typography.display}`: "No clients yet." / "Nobody's cold. Good." / "Nothing owed — you're square." No illustration, no CTA theater. |
| **Loading** | Any operator surface, booking flow | Honest, fast (NFR3). Static skeleton matching the tile/row layout; no spinner theater, no fake optimism (there is no client store to optimistically write to). Public booking view leans on a static shell + streaming to hit <2s on 4G (open tension, review-reconcile:54) `[ASSUMPTION]`. |
| **Error (validation)** | Forms S4/S6/S10/S19 | Action returns `{ok:false, reason}`; nothing is written. Message tied to the offending field, in plain language ("Add a phone number so you can reach them."), `{colors.signal-critical}` on the field only. |
| **Capacity — day-maxed** | S7, S9, S16/S17 | The requested day renders no open slots; copy points at nearest open days ("Thursday's full. Friday and Monday have room."). Operator S7 additionally offers the explicit **override** path. |
| **Capacity — week-full (14/14)** | Hero S24, S7, S9, booking | Hero-metric + capacity meter both go `{colors.signal-critical}`. Booking surfaces show *no* slots and name the next open week. When the operator sees red, a door is closed. |
| **Slot-just-taken (race)** | S16/S17 confirm | Slot filled between view and confirm → exactly-one-winner (AD-3); loser sees "that one just went — here's what's still open," re-renders live open slots. Never an overbook, never a raw 409. |
| **First-approved-wins** | S20 queue | Multiple pending requests on one slot; on approve, the losing rows flip inline to a `no-longer-available` status pill. Expected outcome, spoken plainly, not an error. |
| **Lapsed / gone-cold** | S14, S24 | Client past cadence-scaled expected-next-date (no grace period, FR17). Surfaces the moment the operator opens the dashboard; row carries a `gone-cold` `{components.status-pill}` reading ember `{colors.signal-warn}` (attention, not yet lost) and a one-tap win-back. |
| **Owed / outstanding** | S22, S24 | A completed-but-unpaid job flags `owed`, aggregated into the dashboard's "who owes". The pill reads ember `{colors.signal-warn}` while owed-and-current, then **escalates to red `{colors.signal-critical}` once the job passes its overdue threshold** — the same ember→red arc the operator reads on the outstanding tile when the float ages. Owed is honest-red on *his* screen; the outgoing reminder copy stays warm regardless (see Voice). |
| **No-outstanding / paid-up** | S22, S24 | On mark-paid the job flips to a `paid` `{components.status-pill}` in green `{colors.signal-paid}` — the one place green appears on the operator panel, reserved for money-cleared. When nothing is owed: "Nothing owed — you're square." The outstanding tile stays neutral `{colors.ink-primary}` (not colored) because zero-owed is the healthy default, and color is earned. |
| **Override-recorded** | S7, S8, S24 | A booking made past cap is flagged `overridden=true`, counted as a counter-metric; shown with a small marker so the operator can see self-inflicted overbooking honestly. |

## Interaction Primitives

- **Tap-to-send deep-link handoff (AD-5, the load-bearing primitive).** Every outbound client message is composed server-side into a `MessageDraft`, previewed in `{components.draft-preview-card}`, and — only on the operator's explicit Send tap — opens their *own* WhatsApp/SMS via `wa.me`/`sms:` deep-link, pre-filled. **The product never sends autonomously.** Dispatch logs exactly once on that tap (idempotent; re-tap re-opens the share sheet without double-logging). Only `dispatched` feeds the nudge-fatigue counter.
- **One-tap rebook.** From S8/S12/S13: propose next slot (cadence date, or soonest-open for one-time clients) → compose rebook draft with the client's per-client link → raise the draft card. One tap to draft, one tap to send.
- **Mark-outcome.** S8 state transition `booked → completed | no-show`; marking complete immediately raises the post-job rebooking nudge (S12). Idempotent.
- **Confirm-with-override (capacity).** S7 direct booking re-checks cap at commit; if `day-maxed`/`week-full`, the operator gets an explicit override toggle — a deliberate, recorded choice, never a silent bypass. Client-side confirm (S16) is cap-checked and idempotency-keyed with no override.
- **Mark-paid.** S22 single tap flips `owed → paid`; the outstanding aggregate and dashboard "who owes" recompute on next render (derived-on-read).
- **Approve / decline.** S20 queue decision on a PendingRequest: approve commits + re-checks cap (may itself hit capacity-full); decline leaves the slot untouched. Losing requests on the same slot flip to no-longer-available.
- **CSV export.** S25 single action streams owner-scoped client + job rows; a plain confirm ("Exported — check your downloads."), no modal ceremony. CSV values are injection-neutralized before write.
- **QR generation.** S18 renders the public-token URL as a printable QR following its container radius; operator can display/print for the van or a card.
- **Log inquiry (one-tap).** S21 must be reachable fast enough to use mid-call — a single entry point that records source (phone/walk-in/referral/other) without leaving the current context.

**Banned:** autonomous message send; optimistic client-side success that isn't yet true in the DB; greyed-disabled full/maxed slots shown to clients; vanity/engagement metrics on the dashboard; drop-shadow ranking; a second decorative hue.

## Accessibility Floor

WCAG 2.2 AA across both temperaments, behavioral commitments (visual contrast is proven in `DESIGN.md` — every pair there is AA-checked; not duplicated here).

- **Target size ≥24px minimum (AA), 44px preferred — 48px is the house floor.** The tool is operated one-handed, in the field, in a hurry; every tap target on both surfaces is ≥48px (`{components.button-primary}`, `{components.slot-chip}`, `{components.list-row}` all specify this).
- **Focus order follows reading order** on every surface; visible focus ring at AA contrast on both the dark panel and the light client surface. `Esc`/back always closes the topmost sheet (the draft-preview card, menus).
- **Screen-reader labels on every icon-only control** — the QR action, the send-tap, the mark-paid tap, status pills. A status pill announces role + state ("status: gone cold", "status: owed, $240").
- **Errors are programmatically tied to their field** (validation `reason` associates to the input), announced, and never conveyed by color alone — the capacity signals always carry text ("full", "room left"), never red-vs-green as the sole channel.
- **Reduced motion:** the few transitions (draft `drafted`→`dispatched`, sheet raise) collapse to instant state changes; the dispatched check + timestamp appears immediately.
- **Dynamic type / browser zoom reflows without truncating a readout** — the mono/tabular metric roles must never clip the hero "N / 14".

## Key Flows

Named-protagonist narratives; source journey names mirrored verbatim. Each names the surfaces and components it touches and lands on a climax beat.

### UJ-1 — Inquiry to booking (Rosa)

Rosa, a new neighbor, wants a clean without a phone call.

1. She scans the **QR on the van** (S18) → lands on the public booking surface (S17), light temperament (`{colors.surface-base-client}`).
2. She sees the **real open slots** for the next two weeks as `{components.slot-chip}` — only genuinely-open ones render.
3. She taps Tuesday; the chip fills `{colors.signal-go-client}`.
4. Because she's new, she's routed to the new-client form (S19): name, phone, address — three fields, ≤60s (NFR2).
5. She submits → a **PendingRequest + provisional client**, holding *no capacity* (AD-4).
6. **Climax:** the confirmation screen does *not* lie with "Booked!" — it says, warmly and honestly, *"Got it, Rosa — holding your Tuesday spot. {operator} will confirm shortly."* The inquiry-leak is closed (it's logged, visible, waiting) without faking a confirmation the system hasn't made. Meanwhile the operator's approval queue (S20) lights up.

### UJ-2 — Post-job rebooking (operator)

The operator finishes Rosa's Tuesday clean, standing in the driveway.

1. On the phone, the job detail (S8) shows a one-tap **"same time next week?"** action (S12/S13).
2. Tapping it proposes Rosa's next cadence slot and composes a friendly WhatsApp draft pre-filled with her per-client link, raised in `{components.draft-preview-card}`.
3. The operator reads the text (it's a check-in, not a sell), edits nothing, taps **Send** — WhatsApp opens pre-filled (AD-5).
4. The card flips to `dispatched`: a `{colors.signal-go}` check + timestamp.
5. **Climax:** before the operator has left the driveway, next Tuesday is drafted-and-sent from his *own* number, and Rosa's one tap on the link will direct-confirm it — the rebooking leak closed in the ten seconds that used to be "I'll text her later" (and never did).

### UJ-3 — Catching a lapse (Maria)

Maria, a weekly regular, has quietly stopped rebooking.

1. The operator opens the app to the dashboard (S24).
2. Maria surfaces in the **gone-cold list** (S14) within a week of her missed cadence — derived live on open (AD-7), a `gone-cold` `{components.status-pill}` on her `{components.list-row}`.
3. The operator taps the row's one-tap **win-back** action (S15) → a check-in draft appears in `{components.draft-preview-card}`: *"Hey Maria — it's been a bit! Want me to swing by this week?"*
4. One tap sends it via his own WhatsApp.
5. **Climax:** a regular who was silently sliding toward *gone* is caught while she can still be recovered — the lapse became *visible the instant it happened*, which is the whole thesis: the leak you can see is the leak you can close.

### UJ-4 — Deciding whether to accept work (operator)

A caller asks for Thursday; the operator is mid-conversation.

1. He glances at the dashboard hero (S24): the **N / 14** `{components.hero-metric-tile}` and the `{components.capacity-meter}` beneath it.
2. He opens forecasting-lite (S9): Thursday shows **day-maxed**, but there's **room left Friday**.
3. The capacity signals read at a glance — amber where filling, red where closed — no number-crunching mid-call, under 2s on 4G (NFR3).
4. **Climax:** instead of overbooking Thursday (self-inflicted overload) or guessing and losing the job, he says "Thursday's full but I can do Friday morning?" — and books it. The single largest, most self-inflicted number in the business — idle-vs-overbooked capacity — is, for once, *visible at the moment of the decision*.

### UJ-5 — Chasing the float (operator)

End of week; roughly $500/month sits uncollected because asking is awkward.

1. The dashboard (S24) "who owes" tile shows outstanding; the operator opens the ledger (S22).
2. Owed jobs carry an `owed` `{components.status-pill}` reading ember `{colors.signal-warn}`; once a job ages past overdue it **escalates to red `{colors.signal-critical}`**, and on his *own* screen the aged outstanding total reads `{colors.signal-critical}` too — honest for him.
3. He taps a client marked outstanding → payment-reminder action (S23) drafts a **face-saving** message in `{components.draft-preview-card}`: warm, no due-date threat, no red in the client's copy.
4. One tap sends it through his WhatsApp; when the cash arrives he taps **mark-paid** (S22) → `owed → paid`, the pill flips to green `{colors.signal-paid}` (money-cleared), and "who owes" recomputes on next render.
5. **Climax:** the float gets chased *without the face-to-face ask the cleaner would rather not have* — the money leak closes through a friendly text instead of an awkward conversation, and the ledger squares itself the moment cash lands.

## Responsive & Platform

Phone-first, no desktop dependency, no responsive breakpoint spec — "phone-web" is the only target on both sides, so the design is single-column always, built for **one-handed thumb reach**. The dashboard (S24) is **one phone-legible screen**: hero-metric full-width up top, supporting stat tiles 2-up beneath, leak indicators + gone-cold list stacking below the fold, no horizontal scroll. Primary actions sit in the thumb arc; ≥48px targets throughout.

The two temperaments map cleanly onto the auth boundary: crossing from `app/(operator)` (dark instrument panel, in-command) to `app/book/[token]` (light booking surface, invited) *is* the platform's only real "mode switch." Same components, same spacing, same type — the tonal skin is the only thing that flips, and it flips exactly at the point where a business-owner's cockpit becomes a stranger's front door. `[ASSUMPTION]` If a tablet/desktop viewport is ever hit, the single-column phone layout simply centers with max-width rather than reflowing to multi-column — no separate desktop design is in scope.
