# Design system — "Ledger"

The living reference is `/design` (`src/app/(app)/design/page.tsx`) — it
renders every token and component listed here from the real source, so if
this document and that page ever disagree, the page is right and this file
needs an edit. Read this document for the *why*; read that page for the
*what it looks like right now*.

## The four rules

Everything else in this file is detail. These four sentences are the whole
system, and every review of a new component should be checked against them
before anything else:

1. **One filled button per view.** Everything else is a hairline. A screen
   with two primary buttons has no primary button — it's just asking the
   user to guess.
2. **Hairlines, not shadows.** Structure comes from 1px lines and surface
   steps (`--panel` → `--panel-sunken` → `--inset`), not elevation. Shadows
   are reserved for things that actually float above the page — dialogs,
   dropdowns, toasts — nothing else casts one.
3. **Colour is reserved.** For money (profit/loss) and exactly one
   interactive brand hue (cobalt). Chrome — rails, borders, most text — stays
   near-achromatic on purpose, so the two things colour *is* used for never
   have to compete with anything else for attention.
4. **Comparable numbers are mono.** Anything that could reasonably be
   compared vertically — a column of P&L, a column of R multiples — is set
   in the mono face with `font-variant-numeric: tabular-nums`. This is a
   ledger; digits must line up.

## Palette rationale

`src/app/globals.css` is the only file that defines a colour. It's built in
two layers:

- **Primitive scales** (`--grey-0`…`--grey-1000`, `--cobalt-*`, `--jade-*`,
  `--clay-*`, `--amber-*`) — raw values, never referenced outside this file.
- **Semantic tokens** (`--canvas`, `--panel`, `--ink`, `--brand`, `--profit`,
  `--loss`, `--warn`, …) — what components actually use, each one mapping a
  role onto a primitive. A repaint is editing the ~15 lines that define
  these mappings, not hunting down 400 hard-coded hex values.

Specific choices worth knowing about:

- The grey ramp is biased a few degrees toward the cobalt brand hue rather
  than a pure neutral, so the chrome reads as *chosen* instead of "whatever
  the browser defaults to."
- Profit/loss use **jade and clay**, not pure `#00ff00`/`#ff0000`. Saturated
  trading-terminal green/red is illegible on a light panel and looks cheap —
  jade/clay carry the same instant-recognition signal at a legible contrast
  in both themes.
- `--brand` (cobalt) is deliberately desaturated so it never visually
  competes with profit/loss for the eye's attention — those two are the
  numbers that matter most on this page, and the brand hue is decoration by
  comparison.
- `-weak` variants (`--profit-weak`, `--brand-weak`, …) are `color-mix()`
  against `transparent`, not a separate hard-coded pale colour — so a badge
  background always stays proportionally related to its foreground colour
  without a second value to keep in sync.

### Text contrast

Every ink step is real text somewhere (`.label`, `FieldHint`, chart axis
ticks, "optional"), so every step must clear WCAG AA's 4.5:1 against the
surfaces it sits on. Measured against `--panel`:

| Token | Light | Dark |
|---|---|---|
| `--ink` | `#0f1319` — 18.6:1 | `#e9ecf1` — 15:1 |
| `--ink-2` | grey-600 — 7.0:1 | grey-300 — 9.5:1 |
| `--ink-3` | grey-500 — 4.7:1 | grey-400 — 6.0:1 |

`--ink-3` used to be grey-400 in light (3.0:1) and grey-500 in dark (3.8:1);
both failed. Dark `--ink-2` moved up a notch with it so the three steps stay
visibly distinct. `--flat` (a zero P&L) follows `--ink-3`. If you change the
grey ramp or a surface, recompute this table rather than trusting it.

Never reference a `--grey-*`/`--cobalt-*`/`--jade-*`/etc. primitive directly
from a component. Never write a raw hex outside `globals.css` (the one
standing exception is `scripts/make-icons.mjs`, which runs outside the CSS
token system entirely and needs concrete values to hand to an SVG/raster
buffer). Never use a stock Tailwind palette class (`bg-red-500`, `text-slate-400`,
…) — if a colour you need doesn't have a token yet, that's a sign a token is
missing, not a reason to reach past the system.

## Type scale

13px UI base — this is treated as an instrument panel, not a document, so
the whole scale sits smaller than a typical marketing site's:

| Token | Size | Used for |
|---|---|---|
| `--text-2xs` | 11px | Table micro-labels, badges, the `.label` eyebrow style |
| `--text-xs` | 12px | Secondary meta text |
| `--text-sm` | 13px | UI default — most body text in the app |
| `--text-base` | 14px | Prose, notes, textareas |
| `--text-md` | 16px | Panel titles |
| `--text-lg` | 20px | Section headings (`<SectionHead>`) |
| `--text-xl` | 26px | Stat figures |
| `--text-2xl` | 34px | The one hero figure on the app (none currently in active use — reserved) |

Two font families, both declared as CSS custom properties in `globals.css`
rather than injected by `next/font` (see the comment at the top of
`src/app/layout.tsx` for why, and how to switch back on a network that can
reach Google Fonts):

- **Instrument Sans** — UI text.
- **JetBrains Mono** — anything numeric or code-like. `.mono` /
  `font-variant-numeric: tabular-nums` is applied wherever digits need to
  compare vertically (see Rule 4).

## Spacing & density

- Controls are **32px** tall by default (`--control-h`), **36px** for the
  "lg" size used on primary CTAs. Table rows are **34px** (`--row-h`), or
  **28px** (`--row-h-compact`) for denser lists.
- Controls are 2px tighter than panel radii on purpose
  (`--radius-control: 4px` vs. `--radius-panel: 6px`) — that small
  difference is most of what keeps a dense UI from reading as a toy; a panel
  and the button inside it should not look like they came from the same
  cookie cutter.
- One motion scale: `--dur-fast` (110ms) for hover/press feedback,
  `--dur` (160ms) for anything that opens/closes (dialogs, the nav rail
  collapsing). `prefers-reduced-motion` zeroes both globally in `globals.css`
  — no component needs to check for it itself.

## The theming contract

Every colour token has **three** definitions in `globals.css`, and a
component must never assume which one is active:

1. `:root` — the light palette, unconditional. This is also what a page
   without any theme JS at all would render.
2. `@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) }`
   — dark tokens, applied when the OS is dark **and** the user hasn't
   explicitly forced light.
3. `:root[data-theme="dark"]` — the same dark tokens again, applied when the
   user has explicitly picked dark regardless of OS setting.

`<ThemeToggle>` (`src/components/shell/theme-toggle.tsx`) is the only thing
that ever writes `data-theme`, and it has three states — light / dark /
*system* — where "system" means **removing** the attribute entirely, letting
state (2) above decide. A component should never branch on the current
theme in JS; if something needs to differ between light and dark, it needs a
token, not a conditional.

## Component inventory

Everything under `src/components/ui/` is demoed live on `/design`. Grouped
by what it's for:

- **Actions** — `button.tsx` (variants × sizes, `ButtonGroup`)
- **Form** — `input.tsx` (`Input`, `NumberInput`, `Textarea`, `SearchInput`),
  `field.tsx` (`Field`/`FieldLabel`/`FieldHint`/`FieldError`/`FieldRow` — the
  a11y wiring for every form field in the app), `select.tsx`, `switch.tsx`,
  `checkbox.tsx`, `segmented.tsx`
- **Feedback** — `toast.tsx`, `empty.tsx` (`EmptyState`/`ErrorState`),
  `skeleton.tsx`
- **Overlays** — `dialog.tsx` (also backs the mobile `Sheet`),
  `dropdown.tsx`, `tooltip.tsx`
- **Data display** — `table.tsx`, `pagination.tsx`, `badge.tsx`
  (`Badge`/`DirectionBadge`/`SessionBadge`/`TagChip`), `value.tsx`
  (`Money`/`RValue`/`Pips`/`Percent`/`Empty` — the sign-aware formatters),
  `r-bar.tsx`, `sparkline.tsx`, `stat.tsx`, `tabs.tsx`
- **Layout** — `panel.tsx` (`Panel`/`PanelHeader`/`PanelBody`/`PanelFooter`/
  `SectionHead`/`Label2`), `src/components/shell/page.tsx` (`Page`/`Grid`)

`src/components/shell/*` (nav rail, account switcher, theme toggle) and
`src/components/charts/*` (Recharts wrappers) build on top of this layer but
aren't part of it — they're one level up, composed for a specific place in
the app rather than reusable primitives.

## How to add a component without breaking the system

1. **Reach for an existing token first.** If you're about to write a hex
   value, a Tailwind palette class, or a `dark:` variant, stop — the answer
   is a token in `globals.css`, even if that means adding one.
2. **No component owns a colour that isn't a token.** `style={{ background:
   'var(--profit)' }}` is fine; `style={{ background: '#17916a' }}` is not,
   anywhere outside `globals.css` and `scripts/make-icons.mjs`.
3. **Border first, shadow only for things that float.** If the new thing
   sits in the page's normal flow, it gets `border border-line` (or a step
   up the surface ladder). `shadow-overlay`/`shadow-sticky` are for content
   that's portalled above everything else.
4. **New numeric display → check Rule 4.** Wrap it in `.mono` (or reuse
   `Money`/`RValue`/`Pips`/`Percent` from `value.tsx`) unless there's a
   specific reason two of these numbers will never need to be compared.
5. **Compose, don't duplicate.** `NumberInput` and `Select`'s trigger share
   `fieldSkin` from `input.tsx` specifically so they can't drift apart
   visually — if you're writing a new input-shaped thing, check whether it
   should share that constant (or `.data-table`, or `Panel`) before
   hand-rolling the classes again.
6. **Demo it on `/design`.** Add the new component (or new state of an
   existing one) to `src/app/(app)/design/page.tsx` in the same change.
   Since that page imports the real component, this costs almost nothing and
   is what keeps the styleguide from rotting into a lie.
7. **Both themes, always.** Toggle `<ThemeToggle>` to dark before calling a
   component finished. A token-only component gets this for free; anything
   that fails here is almost always rule 1 or 2 being broken somewhere.

## Attachment, PWA, and risk-guard surfaces

Three features documented elsewhere build directly on this system rather
than introducing anything new to it:

- **Attachments** (`src/components/trades/attachment-uploader.tsx`) reuses
  `Dialog`, `Segmented`, `Badge`, `EmptyState` and the toast queue as-is —
  see the component's own doc comment for the upload/paste flow.
- **PWA** (`src/components/pwa/*`) — the offline banner is a plain warn-toned
  strip using the same `--warn`/`--warn-weak` tokens as everything else that
  needs that tone; see `docs/PWA.md`.
- **Risk guard** (`src/lib/risk.ts` + `src/components/dashboard/risk-guard.tsx`)
  — same warn strip pattern, worded as an observation rather than a scold
  (see the component's doc comment). It renders nothing at all when there's
  nothing to say, which is itself a design decision: a UI element that's
  visible 100% of the time trains the eye to stop reading it.
