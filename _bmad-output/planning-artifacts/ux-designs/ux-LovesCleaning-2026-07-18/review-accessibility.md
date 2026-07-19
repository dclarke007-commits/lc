# Accessibility Review — LovesCleaning UX (WCAG 2.2 AA)

Lens: Accessibility. Scope: DESIGN.md + EXPERIENCE.md spines and three HTML mocks (S24 dashboard, S16 client booking, S11 draft-send). Ratios below were recomputed from hex (WCAG relative-luminance), including alpha-wash blends.

**Overall verdict: PASS on contrast — every contrast pair claimed in DESIGN.md is accurate and meets AA (4.5:1 text / 3:1 large-text & UI).** No FAILED contrast pairs in the palette. The real AA exposure is behavioral and lives in the mocks: the S24 dashboard renders its actions as non-semantic `<div>`s (not keyboard/SR operable), no mock implements the visible focus ring EXPERIENCE.md promises, and one S11 caption reuses the AA-exempt disabled ink for live text.

Severity counts: **1 blocker · 5 should-fix · 3 nits.**

---

## DESIGN.md — contrast verification (all pairs recomputed)

Every frontmatter/Colors claim is correct to 2 decimals and clears its threshold.

Operator (dark, on base `#0B0E11` unless noted):
| Pair | Claim | Computed | AA |
|---|---|---|---|
| ink-primary `#F4F6F8` | 17.86 | 17.86 | pass |
| ink-secondary `#A7B0BA` | 8.81 | 8.81 | pass |
| signal-go `#F5B841` | 10.89 | 10.89 | pass |
| signal-paid `#34D399` | 10.07 | 10.07 | pass |
| **signal-warn `#E0842B`** | 6.92 | **6.92** | pass |
| signal-critical `#F87171` | 7.0 | 7.00 | pass |
| **on-signal `#1A1206` on `#F5B841`** | 10.43 | **10.43** | pass |

Client (light):
| Pair | Claim | Computed | AA |
|---|---|---|---|
| ink-primary-client `#14181D` / `#F4F7FA` | 16.58 | 16.58 | pass |
| ink-secondary-client `#55606B` / base | 5.97 | 5.97 | pass |
| signal-paid-client `#067A4E` / base · white | 5.01 · 5.38 | 5.01 · 5.38 | pass |
| **signal-warn-client `#B45309`** / base · white | 4.67 · 5.02 | **4.67 · 5.02** | pass (thin on base) |
| **signal-critical-client `#C4362F`** / base | 4.99 | **4.99** | pass (thin) |

Note (nit): `#B45309`@4.67 on base and `#C4362F`@4.99 on base clear 4.5 but with almost no margin — any future darkening of the canvas or lighter weight would tip them under. Prefer their on-white pairing (5.02 / 5.36) for body-size copy.

`ink-disabled #6B7683` is correctly declared exempt (disabled controls only) — but see S11 finding, where a mock uses it for live text.

---

## S24 — Leak-detector dashboard (`mock-s24-dashboard.html`)

**[BLOCKER] Actions are non-semantic `<div>`s — not keyboard- or SR-operable.**
`<div class="winback">Win back</div>` (rows), the three `.leak` rows, and the `.row` gone-cold entries are all plain `<div>`s with chevrons implying navigation. They have no `role`, no `tabindex`, no `<button>`/`<a>` — so keyboard and screen-reader users cannot reach or fire the dashboard's primary actions (win-back S15, ledger S22, forecasting S9). WCAG 2.1.1 (Keyboard) / 4.1.2 (Name-Role-Value). Fix: render each action as a real `<button>` (or `<a>` for navigations) with an accessible name (e.g. `aria-label="Win back Rosa M."`); make the whole leak/cold row a `<button>`/link. The build MUST NOT copy the div pattern.

**[SHOULD-FIX] No landmarks or headings.** Section titles ("This week's book", "Leaks to close", "Gone cold") are styled `<div>`s; there is no `<main>` and no `<h1>`/`<h2>`. SR users get no heading/landmark navigation. Fix: `<main>`, an `<h1>` (visually hidden if needed), and `<h2>` section headings.

**[SHOULD-FIX] Win-back target under preferred size.** `.winback` = padding 8/14, 13px, no `min-height` → ~33px tall. Clears the 24px AA minimum but misses the 44px preferred / 48px house floor EXPERIENCE.md commits to. Fix: `min-height:44px` (48 to honor the house floor).

**[SHOULD-FIX] No visible focus style** (shared across all mocks) — once the divs become buttons, define a `:focus-visible` ring at AA contrast. EXPERIENCE.md promises this; no mock implements it.

Contrast (rendered pairs on `surface-raised #14181D`) — all pass: owed warn `#E0842B` 6.37 (28px large, needs 3); MoM/paid green `#34D399` 9.27; go `#F5B841` 10.03; ink-secondary `#A7B0BA` 8.12; winback amber on its 10%-wash 8.30. **No color-as-sole-signal**: leak dots (warn/crit) are each paired with descriptive text ("3 gone cold", "2 unpaid · $180"); capacity meter is backed by "9 / 14" + "5 slots left"; MoM uses a ▲ glyph plus text. Good.
Nit: the empty severity dots are decorative — add `aria-hidden="true"` when they become real markup (text already carries meaning).

---

## S16 — Client booking (`mock-s16-client-booking.html`) — the public surface

Strongest of the three: real `<button>`s, `aria-pressed` on chips, `role="group"` + `aria-labelledby`, `disabled`+`aria-disabled` on the taken slot, `<h1>`, `role="main"`. Chips 56px, confirm 52px — all ≥48px.

**[SHOULD-FIX] Disabled slot shown to client.** The `.chip.taken` "Just taken" (disabled) contradicts DESIGN.md/EXPERIENCE.md ("only genuinely-open slots ever render; never greyed-and-disabled"). Beyond the contract breach, a disabled control advertises a door the client cannot open and is skipped by keyboard. Fix: omit taken slots from the render (or re-render live on the race, per the spine), rather than showing them disabled.

**[SHOULD-FIX] No `:focus-visible` ring on chips/confirm.** Relies on the UA default, which on the amber-filled selected chip (`#F5B841`) may not reach 3:1 against surrounding white. EXPERIENCE.md promises an AA focus ring on the light surface — implement an explicit one.

Contrast (on white) — all pass: just-taken crit `#C4362F` 5.36 (13px); booked-note title paid `#067A4E` 5.38 (15px/600); ink-secondary `#55606B` 6.42. Selected/confirm dark ink `#1A1206` on amber 10.43. **No color-only signals** — "Just taken" carries text + line-through; the settled note pairs green with a ✓ tick and "You're booked".
Nit: on the selected chip the visible "Selected ✓" is inside an `aria-hidden` span, so SR conveys state only via `aria-pressed="true"` — acceptable, but the redundancy is lost.

---

## S11 — Draft preview → tap-to-send (`mock-s11-draft-send.html`)

Good ARIA: `role="dialog" aria-modal`, `aria-labelledby`; both actions have explicit `aria-label`s ("Open in WhatsApp with this message pre-filled", "Copy message text to clipboard"); decorative SVGs `aria-hidden`; the Drafted pill has `aria-label="status: drafted, not yet sent"`. Buttons 48px.

**[SHOULD-FIX] Caption uses the AA-exempt disabled ink for live text.** `.caption-note` ("We log it once, when you send…") is set in `ink-disabled #6B7683` on base `#0B0E11` = **4.19:1**, below 4.5 for normal text. This is informational copy, not a disabled control, so the exemption does not apply — the only sub-4.5 rendered pair found. Fix: use `ink-secondary #A7B0BA` (7.30:1 here) for caption copy.

Contrast (rest) — all pass: ink-secondary `#A7B0BA` on overlay `#1C2229` 7.30 (channel/edit-hint/honesty); who-amber `#F5B841` on overlay 9.02 (20px large); draft-body ink 16.45; placeholder amber `#F5B841` on raised 10.03; Drafted pill `#A7B0BA` on its 12%-wash 5.81. **No color-only signals** — "Drafted" is text; the dispatched state is spec'd as check + timestamp.
Nit: the message-draft block is `role="textbox" tabindex="0"` with `contenteditable="false"` and `aria-label="Message draft — editable"` — the "editable" label is misleading since it is not editable in this state; the edit-hint sits below. Reconcile label with actual behavior.

---

## Cross-cutting
- **Contrast: no failures.** All DESIGN.md pairs accurate and AA-compliant; the single sub-4.5 rendered pair is the S11 disabled-ink caption (fixable by swapping to ink-secondary).
- **Focus visibility** is promised in EXPERIENCE.md but implemented in none of the mocks — define AA-contrast `:focus-visible` rings on both temperaments before build.
- **No color-as-sole-signal risks** — every severity dot, pill, meter, and MoM arrow is paired with text/icon/glyph. This is done well.
- **Behavioral floor (EXPERIENCE.md)** is real and specific (≥48px, focus order = reading order, SR labels on icon controls, errors tied to fields, reduced-motion). The gap is the S24 mock not living up to it (div controls, no headings) — a mock-fidelity issue, not a spec gap.
