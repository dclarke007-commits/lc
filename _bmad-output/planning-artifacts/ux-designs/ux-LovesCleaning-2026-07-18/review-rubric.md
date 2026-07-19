# Spine Pair Review — LovesCleaning (Rubric Walker lens)

- **DESIGN.md:** `_bmad-output/planning-artifacts/ux-designs/ux-LovesCleaning-2026-07-18/DESIGN.md`
- **EXPERIENCE.md:** `_bmad-output/planning-artifacts/ux-designs/ux-LovesCleaning-2026-07-18/EXPERIENCE.md`
- **Run at:** 2026-07-18T16:20 CDT
- **Method:** `.claude/skills/bmad-ux/references/validate.md` rubric walker + Pass-1 coverage.

## Overall verdict

A **strong, near-shippable** spine pair. Both files are canonically ordered, the frontmatter is well-formed, and **every one of the 21 unique `{path}` token references in EXPERIENCE.md resolves to a real DESIGN.md token — zero broken cross-refs.** IA closure is complete: all 16 PRD surfaces and all 6 epics land on exactly one of the 25 IA surfaces, each surface carries a job, and all 5 journeys are present with explicit climax beats and verbatim names. No blockers. The `[ASSUMPTION]` markers are all fully-specified fallbacks, not gaps — none blocks downstream consumption. Should-fix items are limited to two components lacking behavioral rows, three unlinked mockups, and one unresolved eng-side performance tension.

**Counts: 0 blockers · 3 should-fix · 4 nits.**

---

## 1. Flow coverage (EXPERIENCE.md) — PASS (strong)
All 5 UJs present, names verbatim from PRD (`Inquiry to booking` / `Post-job rebooking` / `Catching a lapse` / `Deciding whether to accept work` / `Chasing the float`), protagonists match (Rosa, operator, Maria), each has numbered steps + a **Climax:** beat, and failure/capacity paths are handled in State Patterns. No misses.

## 2. Token completeness & cross-refs — PASS (strong)
- **No broken cross-refs.** All 21 unique `{colors.*}` / `{typography.*}` / `{components.*}` refs in EXPERIENCE.md resolve to DESIGN.md frontmatter. All internal DESIGN.md component `{path}` refs (colors/rounded/spacing/typography/components) resolve.
- Every color token carries a hex; light/dark(temperament) pairs are explicit; AA contrast ratios stated per load-bearing pair. No orphan color/typography/rounded tokens (all appear in a component object or prose).
- **Nit:** `spacing.2 / .5 / .8 / .12` are defined but not individually `{path}`-referenced. Acceptable as a described scale; no action required. (DESIGN.md frontmatter)

## 3. Component coverage — CONCERN (adequate)
- **should-fix — `button-ghost` has no behavioral spec.** It has a DESIGN.md.Components visual row + frontmatter token, but no row in EXPERIENCE.md.Component Patterns. Its secondary/cancel and **destructive** behavior (signal-critical text on ghost, never red fill; any confirm-destructive pattern) is behaviorally uncovered. (EXPERIENCE.md § Component Patterns) *Fix:* add a `button-ghost` row — secondary/cancel affordance, destructive variant rules, one-per-surface pairing with `button-primary`.
- **should-fix (minor) — `button-primary` has no dedicated behavioral row.** Its behavior (single affirmative action: Confirm/Send/Approve; idempotent) is described inline in the draft-preview and Interaction Primitives sections but not as its own Component Patterns row. (EXPERIENCE.md § Component Patterns) *Fix:* add a one-line row or explicitly note it is specified inline.
- The other 7 components each have both a visual (DESIGN) and behavioral (EXPERIENCE) row with real rules.

## 4. State coverage — PASS (strong)
Empty, loading, validation-error, day-maxed, week-full, slot-just-taken race, first-approved-wins, lapsed/gone-cold, owed/overdue-escalation, paid-up, and override-recorded are each specified with surface + treatment. Capacity/race states are correctly elevated to first-class flows (AD-2/3/4).

## 5. Visual reference coverage — CONCERN (thin)
- **should-fix — three mockups are orphaned.** `.working/mock-s11-draft-send.html`, `.working/mock-s16-client-booking.html`, `.working/mock-s24-dashboard.html` exist but neither spine links them inline. EXPERIENCE.md only says generically "Composition reference: DESIGN.md mockups" (§ IA, end); DESIGN.md has no inline mockup links. (Both spines) *Fix:* link each mock inline at its section naming what it illustrates — S24 mock in State Patterns/dashboard, S16 in UJ-1/booking, S11 in Interaction Primitives/draft-send. "Spine wins on conflict" is stated once (good); keep it.
- `imports/` is empty — nothing to orphan there.

## 6. Bloat & overspecification — PASS (strong)
EXPERIENCE.md prose is behavioral, not editorial; DESIGN.md carries the editorial voice appropriately. Tables used where tables work. No source restatement beyond necessary anchoring. No decorative narrative untied to a decision.

## 7. Inheritance discipline — PASS (strong)
- `sources` frontmatter (4 extract files) all resolve on disk.
- UJ names verbatim vs PRD; surface IDs (S1–S25) identical across EXPERIENCE.md IA and extract-epics.md; component names identical across DESIGN + EXPERIENCE.
- **Memlog decisions reflected:** the green→amber override (memlog line 24) is correctly applied — amber is primary/brand/go, green is rationed to paid/settled only; no stale "green-primary" (OPEN-1) leaks into either spine. Hero metric = "N/14", WCAG 2.2 AA floor, two-temperaments, OPEN-2 & OPEN-3 assumptions all reflected.

## 8. Shape fit — PASS (strong)
- **DESIGN.md** sections in canonical order: Brand & Style → Colors → Typography → Layout & Spacing → Elevation & Depth → Shapes → Components → Do's and Don'ts. ✓
- **EXPERIENCE.md** all 8 required defaults present and ordered (Foundation, IA, Voice and Tone, Component Patterns, State Patterns, Interaction Primitives, Accessibility Floor, Key Flows) + Responsive & Platform (required-when-applicable, justified). ✓
- **nit — no dedicated Inspiration section** despite memlog recording an anti-pattern reject ("positioned AGAINST field-service SaaS bloat"). It is captured in DESIGN.md Brand & Style ("not generic field-service SaaS"), so this is covered, not missing. No action needed.
- Do's/Don'ts are product-specific (amber/green/ember semantics, slot rendering, draft-preview, one-handed targets) — not generic. ✓

---

## Assumption triage (task-specific)
No `[ASSUMPTION]` is a blocker. All are fully-specified with a committed fallback:
- **should-fix — OPEN-2 streaming tension** (EXPERIENCE.md § State Patterns, Loading): "static shell + streaming to hit <2s on 4G" is flagged unresolved with eng. The UX behavior (honest skeleton, no fake optimism) is specified regardless, so it does not block the spine — but reconcile the perf strategy with eng before build.
- **nit — ember sub-scheme confirm** (DESIGN.md § Colors, signal-warn): asks the user to confirm ember-distinct-from-gold + owed→red-on-overdue. Fully specified (hex + semantics present); build can proceed. Track for user sign-off.
- **nit — desktop fallback** (EXPERIENCE.md § Responsive, OPEN-3): centered max-width single-column. Fully specified. No action.

## Mechanical notes
- **BROKEN token cross-refs: NONE.**
- **nit — terminology "status chips" vs "status pill".** DESIGN.md § Shapes assigns `rounded/sm` to "inputs and status chips" while the same section + the `status-pill` component reserve `rounded/full` for the "status pill". Clarify whether a separate "status chip" element exists or unify the naming. (DESIGN.md § Shapes)
- Frontmatter completeness: both files have status/updated/project; DESIGN.md has name+description; EXPERIENCE.md has sources. Complete.
- No Mermaid diagrams present (none required).
