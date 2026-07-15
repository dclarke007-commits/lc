---
name: 'review-adversarial-divergence'
type: architecture-review
mode: adversarial-divergence
target: ARCHITECTURE-SPINE.md
reviewer: adversarial-architecture-reviewer
verdict: HOLES-FOUND
created: '2026-07-15'
---

# Adversarial Divergence Review — LovesCleaning Spine

## Method

I did not grade the spine. I attacked it. For each focus area I built **two units one
level down** that each obey **every AD to the letter**, then showed that they still
build **incompatibly** — clashing data shapes, two owners of one entity, conflicting
mutation paths, or an unfixed lifecycle assumption. Each surviving pair is a hole, and
each hole gets a proposed new or tightened AD.

The spine is unusually disciplined about the *write path* (AD-1), the *capacity owner*
(AD-2/3/4), and *derived reads* (AD-7). The holes are not in those load-bearing walls.
They are in the **seams between them**: the exact predicate that both the writer and the
reader must share, the Job state machine neither AD nishes, and the "boundary" events
(dispatch, inquiry, visit) that the paradigm can't cleanly locate.

**Verdict: HOLES-FOUND — 7 divergence pairs, 5 of them capacity- or metric-corrupting.**

---

## H1 — The "slot-consuming Job" predicate is defined twice and pinned nowhere `[CRITICAL]`

This is the deepest hole and it is structural, not incidental.

Capacity is checked in **two independent places** by design:

- **AD-2 / AD-3:** `capacity.commitBooking()` re-checks the per-day cap and weekly-14
  ceiling **inside the locked transaction** at write time.
- **AD-7:** `derive.roomLeft` / `dayMaxed` computes remaining capacity **on every read**
  from canonical Job rows.

Both must count the **same set** of Jobs as "consuming a slot." Nothing in the spine
says which `Job.completion` states consume. The enum is `booked | completed | no-show |
cancelled`. `cancelled` clearly frees a slot (AD-2, FR41). The other three are undefined.

**Divergence pair (both obey every AD):**

- **Unit A — `lib/domain/capacity.ts` (author 1).** Inside `commitBooking`, counts
  `completion IN ('booked','completed')` as consuming — reasoning: a completed job
  happened, it used the slot; a no-show didn't, so the slot is reclaimable.
- **Unit B — `lib/domain/derive.ts` (author 2).** `roomLeft` counts
  `completion IN ('booked','completed','no-show')` as consuming — reasoning: a no-show
  still burned the operator's day; the cap is about the operator's time, not the client's
  attendance.

Both authors can cite AD-2, AD-7, and AD-9 as fully satisfied. Yet:

- The dashboard (Unit B) shows the day **full** (`no-show` counted).
- `commitBooking` (Unit A) shows the day has **room** (`no-show` reclaimed) and accepts a
  new booking.
- Result: the operator's dashboard and the booking surface **disagree about the same
  day**, and a public booker can claim a slot the operator believes is gone — or be
  refused a slot the operator believes is open.

**Why AD-2's "one owner" does not save this.** AD-2 makes `commitBooking` the only
*writer* of a consuming Job. It does **not** make it the only *definer* of what consuming
*means*. The read side (AD-7) re-derives that predicate independently, and AD-7's whole
purpose ("no two modules compute room-left differently") is silently violated because the
predicate itself was never written down.

**Close it — tighten AD-2 + AD-7 (or new AD-10a):**
Define a single exported pure function `capacity.consumesSlot(job): boolean` (equivalently
a canonical `CONSUMING_STATES` set) in `lib/domain/capacity`. **Both** `commitBooking`'s
in-transaction re-check **and** `derive.roomLeft/dayMaxed` MUST call it. State the ruling
explicitly in the spine: which of `booked`, `completed`, `no-show` consume a slot. (My
recommendation: `booked` and `completed` consume; `no-show` and `cancelled` do not — but
the point is the spine must *decide*, not that it decides this way.)

---

## H2 — The Job lifecycle has no state machine and no transition authority `[HIGH]`

The spine lists `Job.completion` states and `Job.payment` states but **never** defines
legal transitions or **who may write each transition**. AD-2 owns the `→booked` insert
and the `→cancelled` release. Everything else is ungoverned.

**Divergence pair:**

- **Unit A — Cash ledger (`FR29–32`, `app/(operator)` + `derive`).** The "mark paid"
  action (`markPaid`) also flips `completion: booked → completed`, on the assumption that
  you only collect cash for work that happened.
- **Unit B — Job lifecycle (`FR38–41`, `app/(operator)` + `capacity`).** The operator
  independently marks the same Job `no-show`.

Now the two orderings produce different terminal states for one Job:

- Ledger-then-lifecycle: `booked → completed (markPaid) → no-show` — a **paid no-show**.
- Lifecycle-then-ledger: `booked → no-show → completed (markPaid)` — a no-show silently
  **resurrected to completed** by a payment event.

Both units use only Server Actions (AD-1), touch capacity only through the sanctioned
paths (AD-2), and never fork the write path. Yet they corrupt each other because **two
actions own the `completion` column** and **no transition is illegal**. Revenue metrics
(addendum F, via AD-7) then count a no-show as earned, or lose a completed job.

Related unfixed assumptions in the same hole:

- Is `payment` orthogonal to `completion`? Can a `cancelled` Job be `paid`? Can a
  `no-show` be `owed` (a no-show fee) or must it be neither? The spine is silent, so the
  ledger's "outstanding" total (sum of `owed`) is undefined at the boundary.
- **When** is `payment` assigned? If Unit A sets `owed` at booking and Unit B sets `owed`
  at completion, the outstanding-cash metric diverges by every not-yet-completed booking.

**Close it — new AD-10 (Job lifecycle authority):**
Define the legal `completion` transition graph (e.g. `booked → {completed, no-show,
cancelled}`; `completed/no-show/cancelled` terminal except an explicit operator "undo");
name the **single Server Action authorized to write each transition**; forbid any other
action (including `markPaid`) from mutating `completion`; and pin the legal
`(completion × payment)` matrix — including whether `no-show` may be `owed` and whether
`cancelled` may be `paid`.

---

## H3 — "Pending request" vs "booked Job" is not distinguishable in the schema `[HIGH]`

AD-4 says a pending new-client request "neither reserves nor consumes capacity" and that
capacity is consumed "only at approval." But the spine never says **what a pending request
is stored as**. The ER diagram has separate `INQUIRY` and `JOB` entities, but `Job.completion`
has **no** `pending`/`requested` state, and AD-4 talks about "approving a pending request
into a slot" — approval-shaped language that invites a Job row.

**Divergence pair:**

- **Unit A — Approval queue (`FR36`, `app/(operator)` + `capacity`).** Stores each pending
  request as a **Job row** with `completion='booked'` plus a side flag `approved=false`,
  and reasons it obeys AD-4 because *its own* queue query filters `approved=false` out of
  capacity math.
- **Unit B — `derive.roomLeft` (AD-7).** Counts **every** `completion='booked'` Job as
  consuming (per H1's predicate), knowing nothing about an `approved` flag it never agreed
  to.

Result: an unapproved stranger's request **phantom-consumes a slot** in `roomLeft` — the
exact "stranger-held phantom reservation" AD-4 exists to prevent — because the two units
disagree on whether a `booked` Job is authoritative. AD-4 is obeyed in spirit by Unit A and
violated in effect by the schema it chose.

**Close it — tighten AD-4 + schema convention:**
State the invariant: **a `Job` row always consumes capacity; a pending request is an
`Inquiry`/request row and is never a `Job`.** No `approved` flag on Job; no pre-approval
Job rows. Approval is the `Inquiry → commitBooking → Job` transition. This makes "is this
consuming?" answerable from row *existence + H1 predicate*, with no hidden flags.

---

## H4 — Inquiry logging (FR37): two writers, no idempotency, and an AD-1 conflict `[HIGH]`

FR37 logs inquiries; the conversion metric (AD-7) is `bookings / inquiries`. The spine
never names the **single writer** of an `Inquiry` row, nor whether logging is automatic
(on link visit) or manual, nor a dedupe key.

**Divergence pair:**

- **Unit A — Auto-log on visit (`app/book/[token]`).** Logs an `Inquiry` when the booking
  link is opened.
- **Unit B — Manual log (`app/(operator)` approval/queue).** Operator records an inquiry
  they received by phone/DM.

Three failures, each fatal to the metric:

1. **Double-count.** A stranger who visits the link (Unit A logs) *and* whom the operator
   also logs manually (Unit B) becomes **two** inquiries → conversion rate halved for that
   lead. No shared dedupe key exists to collapse them.
2. **Pollution.** Auto-log fires on the operator's own preview, browser refreshes, link
   unfurl bots, and QR re-scans → denominator inflated, "leak detector" (FR22–25) reads a
   false leak.
3. **AD-1 conflict.** Auto-log-on-visit is a **mutation triggered by a GET/RSC render**.
   AD-1 says every mutation is a Server Action and surfaces never write. So either
   Unit A illegally writes during render, or it fires a client-component action on mount —
   which **double-fires on React double-mount / re-render**, re-introducing double-count at
   the framework level. The paradigm has no clean place to put "log on visit."

**Close it — new AD-11 (Inquiry provenance + idempotency):**
Name one writer path (a `logInquiry` Server Action). If visits auto-log, they MUST go
through that action carrying a **visit-scoped idempotency key** (e.g. hash of
token+coarse-timebucket) so refreshes/re-mounts collapse; define explicitly whether
operator-preview visits are excluded (they must be, or the metric is self-polluting); and
stamp every Inquiry with `source: visit | manual` so the conversion denominator is
auditable. Resolve the AD-1 tension by ruling that visit-logging is an explicit
client→action call, never a render-time write.

---

## H5 — MessageLog "dispatch": the boundary is a render, so two paths both log one tap `[HIGH]`

AD-5 says "dispatch is logged at the compose→deliver boundary (FR21)." But v1 delivery is a
**deep-link** (`wa.me`/`sms:`), and the app **cannot observe** whether the operator actually
sent anything — tapping the link *leaves* the app. "The compose→deliver boundary" in a
deep-link world is **render time**, not send time.

**Divergence pair:**

- **Unit A — literal AD-5.** Logs `MessageLog` as dispatched when the adapter renders the
  deep-link (that *is* the compose→deliver boundary).
- **Unit B — Rebooking/nudge (`FR10–13`).** Logs dispatch in the `onClick → Server Action`
  when the operator taps the tap-to-send button.

Both cite AD-5. But:

- If **both** fire (draft rendered *and* tapped), one tap yields **two** MessageLog rows.
- Unit A logs a "dispatch" for **every draft the operator merely looked at and never sent**
  → the "messages sent" and nudge-sent metrics are inflated, and — worse — a nudge marked
  "sent" **suppresses gone-cold re-nudging** (AD-7 `goneCold`), so a client who was never
  actually contacted silently drops off the operator's radar.
- Unit A also writes at render → the same **AD-1 write-on-render** violation as H4.
- **Idempotency:** even within Unit B, an operator **double-tapping** the send button
  writes two dispatch rows. No key prevents it.

**Close it — tighten AD-5 (+ new AD-11-style key):**
Rule that in the deep-link paradigm, **"dispatch" is an explicit operator tap recorded by a
Server Action**, exactly once, keyed by an **idempotency token per (draft, client, day)**;
draft *rendering* logs nothing (at most a `drafted` state distinct from `dispatched`).
Because v1 cannot confirm real delivery, name the logged fact honestly: `dispatched` means
*operator-initiated send*, not *delivered*. One tap → at most one row.

---

## H6 — AD-8 "only the column exists" invites unscoped queries that leak on the multi-cleaner split `[HIGH]`

AD-8 plants `owner_id` on every row but says **"No tenant-scoping logic in v1 — only the
column exists."** AD-3, however, says `commitBooking` locks **"advisory lock on `owner_id`"**
and export (FR35) "streams the **owner's** rows." So the spine simultaneously tells authors
to scope (AD-3, FR35) and not to scope (AD-8).

**Divergence pair:**

- **Unit A — `capacity` (follows AD-3's owner_id lock hint).** Scopes its cap-count query
  `WHERE owner_id = $op`.
- **Unit B — `derive` metrics / ledger / dashboard (follows AD-8 literally: "no scoping
  logic").** Queries `SELECT ... FROM job` with **no** owner filter, because AD-8 said the
  column is inert in v1.

In v1 (one owner) both "work." The divergence is **latent**: the day a second `owner_id`
appears — a seed row, a staging import, or the multi-cleaner launch AD-8 is explicitly
preparing for — Unit A stays correct while Unit B silently **counts and displays another
operator's Jobs, cash, and clients**. AD-3's lock even makes it worse: it serializes
*owner A's* schedule while the count spans *all* owners, so the lock protects the wrong set.
AD-8's stated goal ("the future split becomes 'add scoping,' not 're-model'") is defeated,
because "add scoping" now means auditing **every query** written under the "column is inert"
license.

**Close it — tighten AD-8:**
Change the rule from "only the column exists" to **"every query filters by `owner_id` from
v1; the value is hardcoded to the single operator, but the filter is always present."**
Plant the *filter*, hardcode the *value*. Provide a single scoped-query helper (or a Drizzle
base query) that every read/write goes through, so multi-cleaner is a value change, not a
query audit. This also aligns AD-8 with AD-3 and FR35, which already assume scoping.

---

## H7 — Idempotency & reschedule atomicity: one client, two Jobs; one reschedule, zero Jobs `[HIGH]`

AD-3 guarantees **exactly one winner for the last slot** under concurrency. It does **not**
guarantee **one booking per client per slot**, and it says nothing about reschedule being
atomic. AD-6 tokens are **reusable** (scoped to a client, not single-use).

**Divergence pair (a) — double-tap:**

- **Unit A — client-confirm (`FR7`).** Treats each tap of the per-client link as a fresh
  `commitBooking`. Two rapid taps when the day has ≥2 free slots → **two Jobs, same client,
  same day**. AD-3 is satisfied (neither tap exceeded the cap); AD-2 is satisfied (both went
  through `commitBooking`). The client is simply double-booked, capacity is double-consumed,
  and revenue (AD-7) double-counts.
- **Unit B — derive/ledger.** Assumes one Job per client per day and renders/bills
  accordingly.

**Divergence pair (b) — reschedule ordering (`FR41`):**

- **Unit A — release-then-commit.** Releases the old slot, then `commitBooking` the new
  day. If the new day is full, the release already happened → **the booking vanishes**
  (client silently unbooked).
- **Unit B — commit-then-release.** Commits the new slot before releasing the old →
  transient **over-cap** that can trip AD-2's own ceiling and get the operator's legitimate
  reschedule rejected, or briefly double-consume.

Both call `commitBooking` (obey AD-2). The spine never says reschedule is **one
transaction**, so the two sequences are both "compliant" and mutually incompatible.

**Close it — new AD-12 (idempotency & atomic reschedule):**
(1) Booking confirms carry an **idempotency key**; enforce a uniqueness invariant of **one
active (`booked`/`completed`) Job per (client, day-or-slot)** so a double-tap is a no-op,
not a second Job. (2) Reschedule is a **single transaction**: release-old and commit-new
succeed or fail together, so a full target day leaves the original booking intact.
(3) State token semantics: a per-client token is a **reusable capability**, and re-use is
governed by the uniqueness invariant, not by the token being single-use.

---

## Also-noted (secondary, fold into the ADs above)

- **Transition authority for clients.** AD-6 lets a token bearer "do exactly what its token
  scopes." If a per-client token can cancel/reschedule (FR41), the spine must pin the
  token→Job scope so a bearer cannot touch another client's Job, and must say whether a
  client may cancel a `completed` Job. Fold into AD-6 + AD-10.
- **`goneCold` write-suppression coupling.** H5's phantom dispatch and AD-7's `goneCold`
  are coupled: any over-logged nudge suppresses a real re-nudge. The AD-5 fix (dispatch =
  confirmed operator tap) is load-bearing for the leak-detector's correctness, not just for
  tidy logs.
- **Timezone at the boundary.** AD-9 fixes operator-local week math, but "day" for the
  uniqueness invariant (H7) and the consuming-count (H1) must use the **same** operator-local
  day boundary in both writer and reader, or H1/H7 re-diverge across midnight-UTC. Make the
  H1 predicate and H7 uniqueness explicitly consume AD-9's day function.

---

## Proposed AD changes — summary

| # | Hole | Fix | Type |
| --- | --- | --- | --- |
| H1 | Consuming-Job predicate defined twice | Single `consumesSlot()` used by both `commitBooking` re-check and `derive.roomLeft`; spine decides which states consume | Tighten AD-2 + AD-7 |
| H2 | No Job state machine / transition owner | AD-10: legal `completion` transitions, one authorized action per transition, legal `(completion × payment)` matrix, `markPaid` may not touch `completion` | New AD-10 |
| H3 | Pending request vs booked Job indistinguishable | Invariant: a Job always consumes; pending request is an Inquiry, never a Job; no `approved` flag on Job | Tighten AD-4 + schema |
| H4 | Inquiry: two writers, no dedupe, write-on-render | AD-11: one `logInquiry` action, visit idempotency key, `source` field, exclude operator preview, no render-time write | New AD-11 |
| H5 | Dispatch logged at render → double/phantom log | Dispatch = explicit operator tap via action, once, idempotency-keyed; `drafted` ≠ `dispatched`; honest semantics (send-initiated, not delivered) | Tighten AD-5 |
| H6 | "Column only" invites unscoped queries → tenant leak | Every query filters `owner_id` from v1 with a hardcoded value; single scoped-query helper | Tighten AD-8 |
| H7 | Double-tap → 2 Jobs; reschedule not atomic | AD-12: booking idempotency key + one-active-Job-per-(client,day) uniqueness + atomic reschedule txn | New AD-12 |

**Bottom line:** the spine's walls (AD-1/2/3/7) hold. The failures are all at the **seams**:
a predicate shared by writer and reader but written down by neither (H1), a state machine
the capacity ADs assume but never define (H2/H3), and three "boundary" events — inquiry,
dispatch, visit — that the server-first paradigm cannot cleanly locate without an explicit
idempotency and authority rule (H4/H5/H7). Closing H1, H2, and H6 is non-negotiable; the
rest are cheap once those three land.
