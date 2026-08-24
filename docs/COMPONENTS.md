# Components

One line per component: what it's for, and when to reach for something else instead. Everything is re-exported from `@/components/ui`.

## Layout & surfaces

- **Panel / PanelHeader / PanelBody / PanelFooter** — the one container in the system (hairline + surface step, no shadow). Don't nest a Panel inside a Panel; use `PanelBody` padding or a hairline divider instead.
- **Label2** — uppercase mono micro-label (`.label`). Use for captions/eyebrows, not for anything a screen reader should treat as a real heading.
- **SectionHead** — page-level heading row with optional actions. One per page/view, not per panel.

## Buttons

- **Button** — `primary` at most once per view; everything else is `default`/`ghost`. Don't use `variant="link"` for navigation that isn't inline text.
- **ButtonGroup** — edge-sharing row for toolbar clusters / row actions. Don't use it for unrelated actions that shouldn't visually read as one control.

## Form fields

- **Input** — single-line text. Not for numbers that need right-alignment or a unit — use `NumberInput`.
- **NumberInput** — right-aligned, tabular, optional `unit` suffix. Don't use for free text; `inputMode="decimal"` makes mobile keyboards numeric-only.
- **Textarea** — multi-line notes. Don't use for anything under ~2 lines of expected content; use `Input`.
- **SearchInput** — leading magnifier + conditional clear button. Only for actual filtering/search, not as a generic text field with an icon.
- **Field / FieldLabel / FieldHint / FieldError / FieldRow** — the wiring for labelled form controls (id/aria-describedby/aria-invalid via context). Always wrap a control in `Field`; don't hand-roll `<label>` + `<input>` pairs.
- **Select / SelectTrigger / SelectContent / SelectItem / SelectGroup / SelectLabel / SelectSeparator** — closed-list choice from a small, known set. For 2–4 mutually exclusive options that should stay visible, use `Segmented` instead.
- **Segmented / SegmentedItem** — single-select control for a small, always-visible set of options (date range, density). Not for more than ~5 options or anything that scrolls — use `Select`.
- **Switch** — a single boolean that takes effect immediately. If the setting needs an explicit "Save"/"Apply" step, use `Checkbox` in a form instead.
- **Checkbox** — boolean inside a form, or multi-select in a list. Not for an immediate-effect toggle — use `Switch`.

## Overlays

- **Dialog / DialogTrigger / DialogContent / DialogHeader / DialogBody / DialogFooter** — centred modal for a focused task (confirm, edit, create). Don't use for content someone should be able to reference alongside the page — use a `Panel` or a route instead.
- **Sheet** — same primitive as `DialogContent`, bottom-anchored on small screens. Use for mobile trade entry and other flows that should feel native on a phone; on desktop it behaves like a normal centred dialog, so don't also build a separate desktop-only modal for the same flow.
- **Dropdown / DropdownTrigger / DropdownContent / DropdownItem / DropdownCheckboxItem / DropdownLabel / DropdownSeparator** — a menu of actions or options anchored to a trigger. Not for navigation between pages — use a `Link`/tabs.
- **Tooltip / TooltipProvider / TooltipContent / Tip** — a short label on hover/focus for something whose meaning isn't obvious (an icon button, a truncated value). Don't put anything interactive or essential inside one — content that matters must be visible without hovering.

## Navigation

- **Tabs / TabsList / TabsTrigger / TabsContent** — switching between views of the same data at the same URL/context. Don't use for a multi-step wizard/flow — that's sequential, not a set of equal peers.

## Feedback

- **ToastProvider / useToast** — transient, non-blocking confirmation of an action ("Trade saved"). Don't use for errors that block the user from proceeding — use `FieldError` or an inline `ErrorState` instead.
- **EmptyState** — a list/table/panel with zero rows for an ordinary reason (no trades yet, filters too narrow). Don't use it for a failed request — use `ErrorState`.
- **ErrorState** — same shape as `EmptyState`, tinted for failure, with a retry action. Don't use for validation errors on a single field — use `FieldError`.
- **Skeleton / SkeletonText / SkeletonRows** — loading placeholders sized to the real content so nothing jumps on load. Don't leave one on screen past ~a few seconds; a stuck skeleton reads as broken, not loading.

## Data display

- **Stat / StatRow** — one figure + caption, optionally with a hint and sparkline. Don't use for a value the user needs to act on directly (edit/copy) — use a table cell or a labelled field.
- **Money / RValue / Pips / Percent / Empty** — formatted, sign-coloured value renderers for use inside tables/stats. Don't reformat numbers by hand elsewhere; route everything through these so rounding and colour stay consistent.
- **RBar** — divergent bar for an R multiple in a table row. Pass the same `scale` to every row in a table or the bars stop being comparable to each other.
- **Sparkline** — inline SVG trend line for tables/stat tiles. Don't use it where the actual shape/values matter for a decision — it has no axis and no tooltip; use a real chart for that.
- **Badge / DirectionBadge / SessionBadge / TagChip** — small inline status/category markers. Don't use `Badge` as a button; it isn't focusable or interactive.
- **DataTable / Th / ColumnHeader / Td / TrLink / TableEmpty** — thin composition over the `.data-table` CSS (don't restyle the class itself here). `TrLink` makes a whole row navigate; give any nested interactive element (button, menu trigger) its own `relative` so it isn't swallowed by the row's overlay link.
- **Pagination** — page position + page-size switch + prev/next for a `DataTable`. Not meant for infinite-scroll lists — those shouldn't show a page count at all.
