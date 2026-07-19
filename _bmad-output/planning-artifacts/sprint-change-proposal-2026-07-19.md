# Sprint Change Proposal — Retrofit Ad-Hoc Post-MVP Work

- **Date:** 2026-07-19
- **Author:** Damian-clarke (via Correct Course workflow)
- **Change scope:** Moderate (backlog reorganization / traceability retrofit — no replan)
- **Status:** Proposed → awaiting approval

---

## Section 1 — Issue Summary

Three changes shipped **after** the Epic 1–6 sprint closed and were **verified in production**, but are **not represented** in the planning artifacts (`epics.md`, PRD, `sprint-status.yaml`). This breaks FR→epic→story traceability.

| # | Shipped work | Evidence |
|---|---|---|
| 1 | Public marketing homepage at `/` + self-serve booking-request form | PR #12 (commit `8fb1948`); spec `docs/superpowers/specs/2026-07-18-public-homepage-self-serve-request-design.md` |
| 2 | Inquiry `source='web'` routing for homepage inquiries (new enum value + partial dedup index) | commit `3a4256c` |
| 3 | Fresh-and-trustworthy design system across whole app + UX artifact | PR #11 (commit `5f0c372`); `_bmad-output/planning-artifacts/ux-designs/ux-LovesCleaning-2026-07-18/` |

**Issue type:** New requirement emerged post-MVP (deliberate scope addition, already implemented + green). This is a **documentation retrofit**, not rework.

**Context:** v1 planning had `/` gated → sign-in and no marketing surface; the source enum was `phone|walk-in|link|referral|other`; the "UX Design Requirements" section explicitly read "None — no UX design contract exists for v1."

---

## Section 2 — Impact Analysis

- **Epic Impact:** Epic 4 (Client Self-Booking) absorbs the homepage + `web` source (same inquiry-leak theme). No new epic needed. Epics 1–3, 5, 6 unaffected.
- **Story Impact:** New **Story 4.5** (marketing homepage); **Story 4.4** AC edited (add `web`).
- **Requirements:** New **FR42**; **FR37** + **AR12** edited (add `web`); new **NFR8** (design system).
- **Artifact Conflicts:** epics.md (FR inventory, NFR, UX Design Requirements section, FR Coverage Map, Epic 4 list/section, new story), PRD (§5.1, §6, §7), `sprint-status.yaml` (append done rows). Architecture: AR12 wording only — no structural change (schema enum already migrated in code).
- **Technical Impact:** None pending. Code is live, migrations applied (0014/0015), tests green.

---

## Section 3 — Recommended Approach

**Direct Adjustment** — edit existing artifacts in place to reflect shipped reality. No rollback, no MVP re-scope. Effort: ~single doc-edit pass. Risk: negligible (docs only; code unchanged). Timeline: immediate.

---

## Section 4 — Detailed Change Proposals

### 4.1 — epics.md · FR inventory · NEW FR42 (append to "Booking Engine" group, after FR37)

```
- **FR42** — Provide a public marketing homepage at `/` (no account) presenting the
  business and a self-serve booking-request form. A submission creates a provisional
  client record + pending request (reusing FR6/AR5) and logs an Inquiry with source
  `web` (FR37). The homepage is the anonymous top-of-funnel entry; all operator
  surfaces remain behind auth (FR33).
```

### 4.2 — epics.md · FR inventory · EDIT FR37

```
OLD: … log an inquiry with a source (`phone|walk-in|link|referral|other`), independent of booking links. Link visits that begin a booking auto-log as `link`. …
NEW: … log an inquiry with a source (`phone|walk-in|link|referral|web|other`), independent of booking links. Link visits that begin a booking auto-log as `link`; homepage self-serve submissions (FR42) auto-log as `web`. …
```

### 4.3 — epics.md · Additional Requirements · EDIT AR12 (AD-11 provenance)

```
OLD: … a link visit auto-logs at most one `link` Inquiry per token-visit session (server-side); conversion denominator dedupes to distinct inquiries.
NEW: … a link visit auto-logs at most one `link` Inquiry per token-visit session, and a homepage self-serve submission (FR42) auto-logs one `web` Inquiry (server-side, deduped via partial unique index); conversion denominator dedupes to distinct inquiries.
```

### 4.4 — epics.md · NonFunctional Requirements · NEW NFR8

```
- **NFR8 — Visual design system.** A single fresh-and-trustworthy design system
  (color/type/spacing tokens + shared components) is applied across every operator
  and public surface. The visual + interaction contract lives in
  `_bmad-output/planning-artifacts/ux-designs/ux-LovesCleaning-2026-07-18/`
  (DESIGN.md, EXPERIENCE.md).
```

### 4.5 — epics.md · UX Design Requirements section · REPLACE (stale)

```
OLD: _None — no UX design contract exists for v1. UI is phone-web (RSC surfaces) + the operator's own WhatsApp/SMS; visual/interaction requirements are folded into the phone-first NFRs (NFR1–NFR3) and dashboard FRs (FR22–FR25)._
NEW: _A visual/interaction design contract exists as of 2026-07-18:
`ux-designs/ux-LovesCleaning-2026-07-18/` (DESIGN.md, EXPERIENCE.md), realized as the
whole-app design system (NFR8). Phone-first behavior stays governed by NFR1–NFR3; the
design system governs look, tone, and shared components across operator + public surfaces._
```

### 4.6 — epics.md · FR Coverage Map · ADD FR42 (after FR41 line)

```
- **FR42** → Epic 4 — public marketing homepage (anonymous top-of-funnel + self-serve request)
```

### 4.7 — epics.md · Epic 4 list entry (Epic List section) · EDIT "FRs covered"

```
OLD: **FRs covered:** FR4, FR5, FR6, FR36, FR37
NEW: **FRs covered:** FR4, FR5, FR6, FR36, FR37, FR42
```
Also append to the Epic 4 one-line blurb: "… across phone, walk-in, link, **and the public homepage (web)**."

### 4.8 — epics.md · NEW Story 4.5 (insert after Story 4.4, before "## Epic 5")

```
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
```

### 4.9 — epics.md · Story 4.4 AC · EDIT source list

```
OLD: **Then** it is recorded with a source (`phone|walk-in|link|referral|other`), independent of any booking link (FR37)
NEW: **Then** it is recorded with a source (`phone|walk-in|link|referral|web|other`), independent of any booking link (FR37)
```

### 4.10 — PRD §5.1 · NEW FR42 (append after FR37)

```
- **FR42** — The system shall provide a **public marketing homepage** at `/`, usable
  without an account, presenting the business and a self-serve booking-request form.
  A submission creates a provisional client record + pending request (per FR6) and logs
  an inquiry with source `web` (FR37). All operator surfaces remain behind auth (FR33).
```

### 4.11 — PRD §5.1 · EDIT FR37 source list

```
OLD: … a source (`phone`, `walk-in`, `link`, `referral`, `other`) …
NEW: … a source (`phone`, `walk-in`, `link`, `referral`, `web`, `other`) … Homepage self-serve submissions (FR42) are logged as `web`.
```

### 4.12 — PRD §6 · NEW NFR8

```
- **NFR8 — Visual design system.** A single fresh-and-trustworthy design system (tokens +
  shared components) is applied across every operator and public surface; the design/interaction
  contract is `ux-designs/ux-LovesCleaning-2026-07-18/` (DESIGN.md, EXPERIENCE.md).
```

### 4.13 — PRD §7 Scope · ADD to "In (v1)" (homepage was absent, not explicitly excluded)

```
- Public marketing homepage at `/` + self-serve booking request, logged as `web` inquiries (FR42).
- Whole-app fresh-and-trustworthy design system (NFR8).
```

### 4.14 — sprint-status.yaml · APPEND done rows (under Epic 4 block)

```
  4-5-public-marketing-homepage-self-serve-request: done
```
Plus a tracking note row for the cross-cutting design system (no single story file):
```
  design-system-fresh-trustworthy: done   # PR #11 (5f0c372), whole-app; NFR8
```

---

## Section 5 — Implementation Handoff

- **Scope classification:** Moderate → **PO/DEV** (backlog reorganization). Since the code already shipped and is green, the "implementation" is applying the doc edits in §4 to the four artifacts.
- **Success criteria:** FR42 + NFR8 present in PRD & epics; FR37/AR12/Story 4.4 carry `web`; Story 4.5 exists; Epic 4 "FRs covered" includes FR42; FR Coverage Map lists FR42; UX Design Requirements section repointed; sprint-status shows the retrofitted rows done.
- **Optional follow-up:** create `_bmad-output/implementation-artifacts/4-5-public-marketing-homepage-self-serve-request.md` cross-referencing PR #12 / commit 8fb1948 / the superpowers spec, matching the existing per-story artifact convention.
```
