---
review: cross-spine coherence (DESIGN.md × EXPERIENCE.md × 3 mocks × .memlog)
project: LovesCleaning
reviewer-lens: cross-spine coherence
date: 2026-07-18
verdict: strong coherence — 1 blocker (mock), 4 should-fix, 3 nits
---

# Cross-Spine Coherence Review

Scope: contradictions, drift, and integration gaps *between* DESIGN.md and EXPERIENCE.md, and versus the 3 mocks and the `.memlog` decision log. Single-doc issues are out of scope.

## 1. Token Integrity

**Result: CLEAN. No dangling references.**

Every `{colors.*}`, `{typography.*}`, `{components.*}` reference in EXPERIENCE.md resolves to a token defined in DESIGN.md frontmatter. Verified set used by the spine:

- colors: `surface-base`, `surface-base-client`, `ink-primary`, `signal-go`, `signal-go-client`, `signal-paid`, `signal-paid-client`, `signal-warn`, `signal-critical` — all present.
- typography: `hero-metric`, `display`, `body`, `caption` — all present.
- components: `metric-tile`, `hero-metric-tile`, `capacity-meter`, `slot-chip`, `status-pill`, `draft-preview-card`, `button-primary`, `list-row` — all present.

No `{rounded.*}` / `{spacing.*}` refs appear in EXPERIENCE.md (those live only in DESIGN.md component defs); not an error. No token is referenced by a name that fails to resolve.

## 2. Semantic Consistency (amber=go · green=paid-only · ember=attention · red=critical/overdue)

The mapping holds identically in DESIGN.md and EXPERIENCE.md (status-pill enum table in both; UJ-5 and State Patterns in the spine). It breaks in one mock:

### Finding S-1 (should-fix) — Green spent on revenue growth, not "paid"
- **Location A:** DESIGN.md L174/181, EXPERIENCE.md L122 — "nothing else ever earns green"; green is rationed to paid/settled only.
- **Location B:** `mock-s24-dashboard.html` L156 `.mom { color: var(--signal-paid); }` colors the MoM revenue delta "▲ 12%" green — a general positive/growth semantic, not money-cleared.
- **Severity:** should-fix (semantic-mapping violation).
- **Fix:** Make "▲ 12%" neutral `ink-primary` (or ember/amber if it must signal). Reserve green strictly for the "$2,640 paid" figure (L155, which is legitimately settled money).

### Finding S-2 (should-fix) — Same debt is ember on the tile, red in the leak list
- **Location A:** `mock-s24-dashboard.html` L149/259 — Outstanding "$180" tile value uses `signal-warn` (ember).
- **Location B:** Same file L191/279 — the "2 unpaid · $180" leak row uses `.dot.crit` (red `signal-critical`).
- **Spine rule:** EXPERIENCE.md L121 — owed reads **ember while current**, escalates to **red only once overdue**. The mock shows the identical $180 as ember *and* red simultaneously with no "overdue" justification.
- **Severity:** should-fix.
- **Fix:** Pick one state for the $180. If not overdue, both the tile and the leak dot are ember; if overdue, both are red. Do not split the same debt across two hues.

## 3. Contradictions

### Finding C-1 (should-fix) — Owed→red escalation is `[ASSUMPTION]` in one spine, locked fact in the other
- **Location A:** DESIGN.md L175 marks the whole attention sub-scheme `[ASSUMPTION]` — "owed escalates to red once overdue. **Confirm this attention sub-scheme.**"
- **Location B:** EXPERIENCE.md L103, L121, L199 (UJ-5) state the ember→red overdue escalation as settled behavior with **no** assumption marker.
- **Severity:** should-fix (confidence/status drift — one spine says "unconfirmed," the other builds a journey climax on it).
- **Fix:** Resolve the assumption once and align both. Either promote it to locked in DESIGN.md or re-flag it `[ASSUMPTION]` in EXPERIENCE.md.

**No contradiction found** on: form-factor (both phone-web both sides), two-temperaments (operator dark / client light at the auth boundary), never-auto-send (both + S11 mock agree), capacity-holds-no-capacity vs "book in seconds" (EXPERIENCE.md L67 explicitly reconciles: seconds-to-*book* for known clients / seconds-to-*request* for strangers; DESIGN.md does not contradict). All consistent with the `.memlog` L24 override (green→amber; green reserved to paid).

## 4. Terminology Drift

### Finding T-1 (nit) — Component name vs token
- EXPERIENCE.md L104 titles the component "Draft-preview → tap-to-send card"; the token is `{components.draft-preview-card}`. Resolves fine; cosmetic.

### Finding T-2 (nit) — Send affordance label
- DESIGN.md L218 and the component spec say the card carries a single `button-primary` **"Send"**. `mock-s11-draft-send.html` L248 labels the primary **"Open in WhatsApp"** and adds a ghost **"Copy text"** (L250) — DESIGN.md specifies a *single* affirmative action per surface. Harmless in intent (deep-link), but the label and the extra ghost drift from the written spec.

Surface names (S1–S25) and journey names (UJ-1..5) are used verbatim and consistently across both spines. No S#/UJ# drift found.

## 5. Mock Fidelity

### Finding M-1 (BLOCKER) — S16 renders a disabled, struck-through "Just taken" slot
- **Location A:** `mock-s16-client-booking.html` L227–230 + L129–142 — a `chip taken` button, `disabled`, strikethrough day, "Just taken" in red, shown inline among the open slots.
- **Location B:** DESIGN.md L216 & L234 ("Only genuinely-open slots ever render; day-maxed / week-full slots are **absent, not disabled-and-shown**"; Don't: "Render full/day-maxed slots as greyed-disabled options"). EXPERIENCE.md L102 (same rule) and L118 (slot-just-taken is a **post-confirm re-render**, "here's what's still open," never an inline disabled chip).
- **Severity:** BLOCKER — the mock directly does the one thing both spines explicitly ban, and it is the client's first impression. It also mismodels the race state (a persistent disabled chip vs. a confirm-time re-render).
- **Fix:** Remove the `.taken` chip entirely. Open slots only. Reserve the "that one just went — here's what's still open" copy for the confirm-time race re-render (State Patterns, EXPERIENCE.md L118).

### Fidelity that PASSES
- **S16** correctly shows "You're booked" direct-confirm — legitimate because S16 is the *known-client* per-client-token surface (seconds-to-book is true for regulars, EXPERIENCE.md L52/L67). Not to be confused with the public S17/S19 flow, which must say "holding your spot." Green appears only on the settled booked-note. Amber = selected/confirm. Correct.
- **S24** hero 9/14 neutral with amber "room left," mono tabular, amber capacity meter, ember gone-cold — all faithful (except S-1, S-2 above).
- **S11** honors never-auto-send ("Nothing goes out until you hit send"; "We log it once… Re-tapping won't double-send"), surface-overlay card, scrim-as-modal, amber primary, neutral drafted pill. Faithful (except T-2 nit).

### Finding M-2 (nit) — S16 green reassurance bullet
- `mock-s16-client-booking.html` L168 — the "• No account needed. You're booked the moment you tap." bullet uses `signal-paid-client` (green). Defensible as a "confirmed/settled" reassurance, but borderline green-as-general-positive. Consider neutral or amber.

## Severity Count

| Severity | Count | Findings |
|---|---|---|
| **Blocker** | 1 | M-1 |
| **Should-fix** | 4 | S-1, S-2, C-1, (M-1 already counted as blocker) — S-1, S-2, C-1 |
| **Nit** | 3 | T-1, T-2, M-2 |

(Blocker: 1 · Should-fix: 3 · Nit: 3.)

## Overall Verdict

**Strong cross-spine coherence.** The two spines agree on tokens (zero dangling refs), semantics, temperaments, auto-send policy, and capacity honesty, and both track the `.memlog` green→amber override. The only true contradiction between the spines is a **confidence mismatch** on the owed→red escalation (C-1). The one **blocker** is a mock-vs-spine violation (M-1: S16 shows a banned disabled slot). The remaining should-fixes are mock semantic slips (green on growth; split-hue debt). Clear the blocker and the two should-fix mock issues and the set is ship-coherent.
