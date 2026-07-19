---
status: draft
updated: 2026-07-18
project: LovesCleaning
name: Instrument
description: Phone-first booking engine + leak-detector dashboard for a solo cleaning operator. One design language, two temperaments — a dense dark instrument panel for the operator, a calmer light booking surface for clients. Amber is the brand signal-lamp; green is reserved for settled/paid.
colors:
  # ── Operator temperament (dark instrument panel — the default/spine) ──
  surface-base: '#0B0E11'        # near-black cockpit ink; the panel behind everything
  surface-raised: '#14181D'      # tiles, cards, list rows lifted off the panel
  surface-overlay: '#1C2229'     # sheets, menus, active/pressed row
  hairline: '#2A323B'            # 1px dividers between tiles/rows (decorative, not text)
  ink-primary: '#F4F6F8'         # primary readout text — 17.86:1 on base
  ink-secondary: '#A7B0BA'       # labels, units, secondary readouts — 8.81:1 on base
  ink-disabled: '#6B7683'        # disabled controls only (exempt from AA)
  signal-go: '#F5B841'           # PRIMARY brand accent (amber/gold) — go / booked / selected / primary action — 10.89:1 on base
  signal-paid: '#34D399'         # RESERVED green — paid / confirmed / settled ONLY — 10.07:1 on base
  signal-warn: '#E0842B'         # attention / gone-cold / owed (deep ember, distinct from brand gold) — 6.92:1 on base
  signal-critical: '#F87171'     # full / error / hard-stop / overdue — 7.0:1 on base
  on-signal: '#1A1206'           # dark ink on filled amber (signal-go) button/chip — 10.43:1 on signal-go
  # ── Client temperament (light booking surface, app/book/[token]) ──
  surface-base-client: '#F4F7FA'     # calm cool-white canvas
  surface-raised-client: '#FFFFFF'   # slot cards, form panel
  hairline-client: '#DCE3EA'         # field + card borders
  ink-primary-client: '#14181D'      # 16.58:1 on client base
  ink-secondary-client: '#55606B'    # 5.97:1 on client base
  signal-go-client: '#F5B841'        # PRIMARY amber — same brand hue on light; used as fill with dark on-signal-client ink — 10.43:1
  signal-paid-client: '#067A4E'      # RESERVED green — paid / confirmed ONLY on light — 5.01:1 on base, 5.38:1 on white
  signal-warn-client: '#B45309'      # attention / gone-cold / owed (ember) on light — 4.67:1 on base, 5.02:1 on white
  signal-critical-client: '#C4362F'  # slot-taken / full / overdue on light — 4.99:1 on base
  on-signal-client: '#1A1206'        # dark ink on filled amber button/chip — 10.43:1
typography:
  hero-metric:
    fontFamily: 'ui-monospace, "SF Mono", "Roboto Mono", Menlo, Consolas, monospace'
    fontSize: '48px'
    fontWeight: '600'
    lineHeight: '1.0'
    letterSpacing: '-0.01em'
  metric:
    fontFamily: 'ui-monospace, "SF Mono", "Roboto Mono", Menlo, Consolas, monospace'
    fontSize: '28px'
    fontWeight: '600'
    lineHeight: '1.05'
    letterSpacing: '-0.01em'
  display:
    fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'
    fontSize: '24px'
    fontWeight: '700'
    lineHeight: '1.2'
    letterSpacing: '-0.01em'
  title:
    fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'
    fontSize: '20px'
    fontWeight: '600'
    lineHeight: '1.25'
  body:
    fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'
    fontSize: '16px'
    fontWeight: '400'
    lineHeight: '1.5'
  label:
    fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'
    fontSize: '13px'
    fontWeight: '500'
    lineHeight: '1.3'
    letterSpacing: '0.02em'
  caption:
    fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'
    fontSize: '12px'
    fontWeight: '400'
    lineHeight: '1.3'
rounded:
  sm: '4px'
  md: '8px'
  lg: '12px'
  full: '9999px'
spacing:
  '1': '4px'
  '2': '8px'
  '3': '12px'
  '4': '16px'
  '5': '20px'
  '6': '24px'
  '8': '32px'
  '12': '48px'
  screen-margin: '16px'
  tile-gap: '12px'
components:
  button-primary:
    background: '{colors.signal-go}'
    foreground: '{colors.on-signal}'
    radius: '{rounded.md}'
    minHeight: '48px'
    typography: '{typography.title}'
  button-ghost:
    background: 'transparent'
    foreground: '{colors.ink-primary}'
    border: '1px solid {colors.hairline}'
    radius: '{rounded.md}'
    minHeight: '48px'
  metric-tile:
    background: '{colors.surface-raised}'
    radius: '{rounded.lg}'
    padding: '{spacing.4}'
    valueType: '{typography.metric}'
    labelType: '{typography.label}'
    labelColor: '{colors.ink-secondary}'
  hero-metric-tile:
    background: '{colors.surface-raised}'
    radius: '{rounded.lg}'
    padding: '{spacing.6}'
    valueType: '{typography.hero-metric}'
    valueColor: '{colors.ink-primary}'
    accentRule: 'value colored by signal only when at/over threshold'
  slot-chip:
    background: '{colors.surface-raised-client}'
    foreground: '{colors.ink-primary-client}'
    border: '1px solid {colors.hairline-client}'
    radius: '{rounded.md}'
    minHeight: '48px'
    selectedBackground: '{colors.signal-go-client}'
    selectedForeground: '{colors.on-signal-client}'
  capacity-meter:
    track: '{colors.hairline}'
    fillHealthy: '{colors.signal-go}'
    fillNearCap: '{colors.signal-warn}'
    fillFull: '{colors.signal-critical}'
    height: '8px'
    radius: '{rounded.full}'
  status-pill:
    radius: '{rounded.full}'
    paddingX: '{spacing.3}'
    paddingY: '{spacing.1}'
    typography: '{typography.label}'
    style: 'tinted text on 12%-alpha signal wash; never full-saturation fill'
  draft-preview-card:
    background: '{colors.surface-overlay}'
    border: '1px solid {colors.hairline}'
    radius: '{rounded.lg}'
    padding: '{spacing.4}'
    sendButton: '{components.button-primary}'
  list-row:
    background: '{colors.surface-raised}'
    divider: '1px solid {colors.hairline}'
    minHeight: '56px'
    paddingX: '{spacing.4}'
    titleType: '{typography.body}'
    metaType: '{typography.caption}'
    metaColor: '{colors.ink-secondary}'
---

## Brand & Style

LovesCleaning is an **instrument panel**, not an analytics product. The operator runs an entire cleaning business alone, from a phone, between jobs — so every screen is built to be *read in a glance and acted on with a thumb*. The governing metaphor is a cockpit gauge or a leak detector: it exists to show you where the business is bleeding jobs and cash, and to let you close the leak in one tap. It is deliberately **not** a wall of vanity charts, not a team-management dashboard, not generic field-service SaaS. "The tool is exactly as big as the job."

The aesthetic follows the mission. The operator surface is a **dense, dark, near-black panel** with high-contrast white readouts and tabular numerals — cockpit-serious, zero chartjunk, everything earning its pixels. Its identity is an **amber signal-lamp**: a warm gold accent that is the brand and carries the primary signal — this is what you tap, what "booked" looks like, the color the panel glows. Green is deliberately rationed to one meaning — **settled / paid** — so a green mark always reads as "money's in, done." Red is the hard stop. The voice is punchy and operator-native ("who owes," "gone cold," "room left"), never corporate. Cash stays king; the product never asks the operator to change behavior, only to see more clearly.

One design language, **two temperaments**. The operator lives in the dark instrument panel. The client — a stranger scanning a QR on a van, or a regular tapping a link — meets a **calmer, lighter booking surface** that feels welcoming rather than clinical. Same type, same spacing, same shapes, same components; only the tonal skin changes. A client should feel invited to book; an operator should feel in command.

Built RSC-first on Next.js 16, phone-web only. Interactivity is minimal and server-backed — the visual system leans on static, glanceable structure rather than motion or live-updating flourish.

## Colors

The palette is monochrome-plus-signal. The operator panel is built from four near-black greys and near-white ink; a single accent family (go / warn / critical) is the *only* chroma, and it always means something.

**Operator temperament (dark — the spine):**

- **Panel Ink (`#0B0E11`)** is the base surface — the near-black cockpit background behind every operator screen. Chosen dark-blue-neutral, not pure black, so raised tiles read as lift rather than seams.
- **Raised (`#14181D`)** and **Overlay (`#1C2229`)** are the only two elevation tones. Tiles, cards, and list rows sit on Raised; sheets, menus, and pressed states use Overlay. Depth is tonal, never shadow-heavy.
- **Primary Ink (`#F4F6F8`, 17.86:1)** is every headline number and readout. **Secondary Ink (`#A7B0BA`, 8.81:1)** is units, labels, and metadata. Both clear AA for normal text with wide margin.
The signal system has four meanings, each on its own hue so a glance is never ambiguous:

- **Signal Go — Amber (`#F5B841`, 10.89:1)** is the **primary brand accent**. It carries the go / booked / selected / primary-action meaning and is the color the panel is *known by*: the primary button fill, the selected slot, the "booked" emphasis, the healthy end of the capacity meter. Amber is deliberately promoted from "caution" to "this is the thing" — in this system, warm gold means *live and go*, and it is the one accent the operator's eye is trained to.
- **Signal Paid — Green (`#34D399`, 10.07:1)** is **rationed to a single narrow meaning: paid / confirmed / settled.** It is *not* the general go signal. A green pill or check means money is in and the job is closed — nothing else ever earns green, which is what makes it instantly legible on the ledger.
- **Signal Warn — Ember (`#E0842B`, 6.92:1)** = attention / regular gone cold / money owed. A deeper, burnt-orange amber, chosen to sit clearly apart from the brighter brand gold so "a leak needs your eye" never reads as "primary action." These are the leak indicators the detector exists to surface. Attention/cold/owed is given its own ember hue (distinct from brand gold) rather than reusing the primary, and **owed escalates to red (`Signal Critical`) once overdue** — a committed rule, mirrored in `EXPERIENCE.md` status-pill + state patterns. `[ASSUMPTION]` only the exact ember *shade* (`#E0842B`) is provisional — confirm the tone, not the scheme.
- **Signal Critical — Red (`#F87171`, 7.0:1)** = full / week-maxed / hard-stop / error / overdue. Used sparingly; when the operator sees red, a door is closed or a debt has gone overdue.
- **Hairline (`#2A323B`)** divides tiles and rows at the lowest legible contrast. Decorative only — never carries text.

**Client temperament (light — `app/book/[token]`):** Panel Ink inverts to a cool **Client Canvas (`#F4F7FA`)** with white slot cards. Ink darkens to `#14181D` / `#55606B`. The signal family keeps the same four meanings, light-tuned — **Go/Amber `#F5B841`** (used as a fill with dark `#1A1206` ink, 10.43:1; the "pick this slot" / confirm color), **Paid/Green `#067A4E`** (5.01:1), **Warn/Ember `#B45309`** (4.67:1 on base, 5.02:1 on white), **Critical/Red `#C4362F`** (4.99:1) — each re-darkened where needed to hold ≥4.5:1, so "selected," "confirmed," "pending," and "slot just taken" read with the operator's semantics in a warmer register.

Every pair above was contrast-checked against WCAG 2.2 AA (4.5:1 text / 3:1 UI). Avoid: introducing a fifth hue, gradients, saturated full-bleed accent behind body text, spending green on anything but paid/settled, or spending brand amber on a non-actionable state. If it's colored, it means go / paid / attention / stop.

## Typography

System-first — no web-font payload, because NFR3 (<2s on 4G) is a hard gate and the fastest font is the one already on the phone. Body and chrome use the platform sans (`system-ui` / `-apple-system` / Roboto). Numbers are the exception and the point.

- **Hero Metric (`48px` mono, tabular)** renders the dashboard's single most important readout — **This week's book, "9 / 14."** Monospaced tabular figures so the number doesn't shimmer as it changes and reads like a gauge, not prose.
- **Metric (`28px` mono, tabular)** is every other stat-tile value — repeat rate, revenue, outstanding, room-left. All numeric readouts use tabular figures so columns align and digits never reflow.
- **Display (`24px`/700)** is reserved for rare surface heroes (empty states, the client "You're booked" moment). **Title (`20px`/600)** heads surfaces and cards. **Body (`16px`)** is the reading default. **Label (`13px`/500, tracked)** is field labels and status-pill text. **Caption (`12px`)** is row metadata.

Rule: any figure a human might compare or watch change (counts, money, capacity) is set in the mono/tabular roles. Prose never borrows the metric font; metrics never borrow body. Dynamic type / browser zoom must reflow without truncating a readout.

## Layout & Spacing

Base-4 scale: 4 / 8 / 12 / 16 / 20 / 24 / 32 / 48 px. Tightest gaps bind a value to its label inside a tile; the widest separate major dashboard zones. **Screen margin is 16px**, **tile gap 12px** — dense but never cramped.

Single column, always. The operator dashboard is **one phone-legible screen**: the Hero Metric tile spans full width up top, the supporting stat tiles sit in a 2-up grid beneath, and the leak indicators + gone-cold list stack below the fold. No horizontal scroll; wide content (ledger rows, export) scrolls vertically only. Tap targets are **≥48px** everywhere (WCAG 2.2 AA target-size), because the tool is operated one-handed, in the field, in a hurry.

The client booking flow is a short vertical stack — open-slot chips, then a three-field form (name / phone / address), then confirm — engineered for ≤60s completion (NFR2). No desktop breakpoint is specified; phone-web is the only target on both sides.

## Elevation & Depth

Depth is **tonal, not shadowed**. The operator panel establishes hierarchy through three flat tones — Base → Raised → Overlay — never through drop shadows, which would read as consumer-app gloss and fight the instrument-panel seriousness. A tile is "above" the panel because it's a step lighter, separated by a hairline, not because it floats.

The one permitted shadow is a soft scrim under a bottom sheet or the draft-preview card when it overlays live content — a functional "this is modal" cue, at low opacity, never for ranking tiles. The client temperament uses the same restraint: white cards on the cool canvas, a single hairline border, at most a whisper of shadow on the active slot.

## Shapes

Crisp, not pillowy — the corner language reads *tool*. `rounded/sm` (4px) for inputs and status chips; `rounded/md` (8px) for buttons, slot chips, and controls; `rounded/lg` (12px) for tiles, cards, and sheets. `rounded/full` (9999px) is reserved for two things only: the **status pill** and the **capacity-meter track**. No fully-rounded surfaces, no circular avatars competing with the gauges. Imagery (the printable QR) follows its container's radius.

## Components

- **Metric tile** — the dashboard's atomic unit. `surface-raised`, `rounded/lg`, 16px padding. Value in `metric` (mono/tabular) over a tracked `label` in `ink-secondary`. The value stays `ink-primary` (neutral) until it crosses a threshold, then adopts the matching signal color — a healthy repeat rate is white, a cold one goes `signal-warn`. Color is earned, never default.
- **Hero-metric tile** — the "**N / 14**" book-fill readout, full-width, top of dashboard. 48px `hero-metric`, 24px padding. Value neutral while there's room; tints `signal-warn` as the week fills and `signal-critical` at 14/14 (week-full). This is the one number the operator opens the app to see.
- **Capacity meter** — thin (8px) `rounded/full` bar under the hero. Track is `hairline`; fill runs `signal-go` → `signal-warn` (near-cap) → `signal-critical` (full). The glanceable "room left this week" gauge for UJ-4 accept/decline decisions.
- **Booking-slot chip** — client surface. White card, `hairline-client` border, `rounded/md`, ≥48px. Tap selects → fills `signal-go-client` (brand amber) with dark `on-signal-client` ink. Only genuinely-open slots ever render; day-maxed / week-full slots are absent, not disabled-and-shown.
- **Status pill** — `rounded/full`, tracked `label` text tinted on a ~12%-alpha wash of its signal (never a full-saturation fill behind text). Maps each lifecycle enum to exactly one hue: `booked` → amber (`signal-go`), `paid` / `completed`(settled) → green (`signal-paid`), `gone-cold` / `owed` / `provisional` → ember (`signal-warn`), `no-show` / `cancelled` / overdue / week-full → red (`signal-critical`). Amber = live, green = settled, ember = leak, red = stop.
- **Draft-preview card** — the universal messaging primitive (rebook, win-back, reminder all funnel here). `surface-overlay`, `rounded/lg`, shows the fully composed message text for review, with a single `button-primary` "Send" that opens WhatsApp/SMS via deep-link. Visually distinguishes `drafted` (neutral) from `dispatched` (a `signal-go` check + timestamp). Never auto-sends — the operator always sees the text first (FR19/AD-5).
- **List row** — client list, ledger, approval queue, gone-cold. `surface-raised`, 56px min height, hairline divider, `body` title + `caption` meta in `ink-secondary`, trailing one-tap action or status pill. The approval-queue variant surfaces the "first approved wins — others no longer available" race state inline.
- **Button (primary)** — `signal-go` fill, `on-signal` ink, `rounded/md`, ≥48px. The single affirmative action per surface (Confirm, Send, Approve). **Button (ghost)** — transparent, hairline border, `ink-primary` — for secondary/cancel. Destructive (decline, cancel-job) uses `signal-critical` text on ghost, never a red fill.

## Do's and Don'ts

| Do | Don't |
|---|---|
| Let brand **amber** carry the primary signal — go, booked, selected, the button you tap | Introduce a fifth hue, a second brand color, or decorative color |
| Ration **green** to paid / confirmed / settled only | Use green as a general "go"/success color anywhere else |
| Give attention / cold / owed the **ember** hue (distinct from brand gold); escalate overdue to **red** | Reuse bright brand amber for a non-actionable "warning" state |
| Set every count, dollar, and capacity number in mono/tabular figures | Let readouts reflow or shimmer as values change |
| Keep the dashboard to one phone screen, hero metric first | Add vanity charts, sparkline chartjunk, or "engagement" metrics |
| Earn color — a tile stays neutral until it crosses a threshold | Color tiles by default so nothing stands out |
| Depth by tone (Base → Raised → Overlay) + hairlines | Use drop shadows to rank tiles (reads as consumer gloss) |
| ≥48px tap targets, one-handed, thumb-reachable actions | Pack dense controls that miss between-jobs, on-the-move use |
| Show only genuinely-open slots to clients | Render full/day-maxed slots as greyed-disabled options |
| Always preview the drafted message before the send tap | Auto-send any client message (violates AD-5/FR19) |
| Give clients the warmer light temperament, same components | Ship the cold dark panel to the public booking surface |
| Render capacity rejections (`day-maxed`, `week-full`, slot-taken) as first-class human states | Treat expected race/capacity outcomes as generic errors |
| Keep payment/reminder copy face-saving and low-friction | Make "who owes" feel like a collections dunning notice |
