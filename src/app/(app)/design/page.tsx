"use client";

import * as React from "react";
import { Page, Grid } from "@/components/shell/page";
import {
  Panel,
  PanelHeader,
  PanelBody,
  SectionHead,
  Button,
  ButtonGroup,
  Badge,
  DirectionBadge,
  SessionBadge,
  TagChip,
  Stat,
  StatRow,
  RBar,
  Sparkline,
  Input,
  NumberInput,
  Textarea,
  SearchInput,
  Field,
  FieldLabel,
  FieldHint,
  FieldError,
  FieldRow,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  SelectGroup,
  SelectLabel,
  SelectSeparator,
  Dropdown,
  DropdownTrigger,
  DropdownContent,
  DropdownItem,
  DropdownLabel,
  DropdownSeparator,
  DropdownCheckboxItem,
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogBody,
  DialogFooter,
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
  Segmented,
  SegmentedItem,
  Switch,
  Checkbox,
  DataTable,
  Th,
  Td,
  ColumnHeader,
  TableEmpty,
  EmptyState,
  ErrorState,
  Skeleton,
  SkeletonText,
  SkeletonRows,
  Pagination,
  Money,
  RValue,
  Pips,
  Percent,
  Empty,
  useToast,
} from "@/components/ui";
import { Tip } from "@/components/ui/tooltip";
import { Inbox } from "lucide-react";

/**
 * The living styleguide. Every example on this page renders the actual
 * component from src/components/ui — never a screenshot, never a hand-copied
 * approximation — so this page can never drift from what the app really
 * looks like. If a component changes, this page changes with it for free.
 *
 * Read docs/DESIGN-SYSTEM.md alongside this page: that document explains
 * *why* the system is shaped this way; this page shows *what* it looks like.
 */
export default function DesignSystemPage() {
  return (
    <Page>
      <SectionHead
        title="Design system"
        hint="Every component below is the real thing, imported from src/components/ui — not a copy."
      />

      <TheFourRules />
      <ColorTokens />
      <TypeScale />

      <Grid>
        <Panel className="lg:col-span-6">
          <PanelHeader title="Buttons" caption="variant × size × disabled" />
          <PanelBody>
            <ButtonMatrix />
          </PanelBody>
        </Panel>

        <Panel className="lg:col-span-6">
          <PanelHeader title="Inputs" caption="normal / invalid / disabled / unit" />
          <PanelBody>
            <InputStates />
          </PanelBody>
        </Panel>

        <Panel className="lg:col-span-6">
          <PanelHeader title="Badges & chips" />
          <PanelBody>
            <BadgeShowcase />
          </PanelBody>
        </Panel>

        <Panel className="lg:col-span-6">
          <PanelHeader title="Values" caption="Money, R, pips, percent — always mono, sign-coloured" />
          <PanelBody>
            <ValueShowcase />
          </PanelBody>
        </Panel>

        <Panel className="lg:col-span-6">
          <PanelHeader
            title="R Bar"
            caption="divergent bars for R multiples, including the no-stop and clipped cases"
          />
          <PanelBody>
            <RBarShowcase />
          </PanelBody>
        </Panel>

        <Panel className="lg:col-span-6">
          <PanelHeader title="Sparkline" />
          <PanelBody>
            <SparklineShowcase />
          </PanelBody>
        </Panel>

        <Panel className="lg:col-span-12">
          <PanelHeader title="Stat & StatRow" />
          <PanelBody>
            <StatShowcase />
          </PanelBody>
        </Panel>

        <Panel className="lg:col-span-12">
          <PanelHeader title="Data table" caption="hairline rows, sticky sunken header, mono numerics" />
          <PanelBody padded={false}>
            <TableShowcase />
          </PanelBody>
        </Panel>

        <Panel className="lg:col-span-6">
          <PanelHeader title="Empty & error states" />
          <PanelBody>
            <div className="grid grid-cols-1 divide-y divide-line sm:grid-cols-2 sm:divide-x sm:divide-y-0">
              <EmptyState
                icon={<Inbox className="size-4" />}
                title="No trades yet"
                description="Trades you log will show up here."
                action={{ label: "Log a trade", onClick: () => {} }}
              />
              <ErrorState description="Couldn't reach the server." retry={{ label: "Retry", onClick: () => {} }} />
            </div>
          </PanelBody>
        </Panel>

        <Panel className="lg:col-span-6">
          <PanelHeader title="Skeletons" />
          <PanelBody>
            <SkeletonShowcase />
          </PanelBody>
        </Panel>

        <Panel className="lg:col-span-6">
          <PanelHeader title="Pagination" />
          <PanelBody>
            <PaginationShowcase />
          </PanelBody>
        </Panel>

        <Panel className="lg:col-span-6">
          <PanelHeader title="Dialog & dropdown" />
          <PanelBody>
            <OverlayShowcase />
          </PanelBody>
        </Panel>

        <Panel className="lg:col-span-6">
          <PanelHeader title="Select & tabs" />
          <PanelBody>
            <SelectAndTabsShowcase />
          </PanelBody>
        </Panel>

        <Panel className="lg:col-span-6">
          <PanelHeader title="Segmented, switch, checkbox" />
          <PanelBody>
            <ControlsShowcase />
          </PanelBody>
        </Panel>

        <Panel className="lg:col-span-12">
          <PanelHeader title="Toast" caption="one queue, fixed stack, pauses on hover" />
          <PanelBody>
            <ToastShowcase />
          </PanelBody>
        </Panel>
      </Grid>
    </Page>
  );
}

// ---------------------------------------------------------------------------
// The four rules
// ---------------------------------------------------------------------------

function TheFourRules() {
  const rules = [
    {
      title: "One filled button per view",
      body: "Everything else is a hairline. A screen with two primary buttons has no primary button.",
    },
    {
      title: "Hairlines, not shadows",
      body: "Structure comes from 1px lines and surface steps. Shadows are reserved for things that float above the page — menus, dialogs.",
    },
    {
      title: "Colour is reserved",
      body: "For money (profit/loss) and one interactive brand hue. Nothing else gets to be colourful — chrome stays near-achromatic on purpose.",
    },
    {
      title: "Comparable numbers are mono",
      body: "Anything that can be compared vertically — a column of P&L, a column of R — is monospaced and tabular. This is a ledger.",
    },
  ];
  return (
    <Panel>
      <PanelBody>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {rules.map((r, i) => (
            <div key={r.title} className="flex flex-col gap-1">
              <span className="label">Rule {i + 1}</span>
              <p className="text-sm font-medium text-ink">{r.title}</p>
              <p className="text-xs text-ink-3">{r.body}</p>
            </div>
          ))}
        </div>
      </PanelBody>
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Colour tokens
// ---------------------------------------------------------------------------

const TOKEN_GROUPS: { title: string; tokens: string[] }[] = [
  { title: "Surfaces", tokens: ["--canvas", "--panel", "--panel-sunken", "--panel-raised", "--inset"] },
  { title: "Lines", tokens: ["--line", "--line-strong", "--line-faint"] },
  { title: "Ink", tokens: ["--ink", "--ink-2", "--ink-3", "--ink-inverse"] },
  { title: "Brand", tokens: ["--brand", "--brand-hover", "--brand-ink", "--brand-weak", "--brand-line"] },
  { title: "Money", tokens: ["--profit", "--profit-weak", "--loss", "--loss-weak"] },
  { title: "State", tokens: ["--warn", "--warn-weak", "--flat", "--hover", "--active", "--selected", "--focus"] },
];

function ColorTokens() {
  return (
    <Panel>
      <PanelHeader
        title="Colour tokens"
        caption="Defined once in src/app/globals.css — components never hard-code a colour"
      />
      <PanelBody>
        <div className="flex flex-col gap-5">
          {TOKEN_GROUPS.map((group) => (
            <div key={group.title} className="flex flex-col gap-2">
              <span className="label">{group.title}</span>
              <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-7">
                {group.tokens.map((token) => (
                  <Swatch key={token} token={token} />
                ))}
              </div>
            </div>
          ))}
        </div>
      </PanelBody>
    </Panel>
  );
}

function Swatch({ token }: { token: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div
        className="h-12 rounded-[var(--radius-control)] border border-line"
        style={{ background: `var(${token})` }}
        aria-hidden
      />
      <span className="truncate font-mono text-2xs text-ink-3">{token}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Type scale
// ---------------------------------------------------------------------------

const TYPE_SCALE: { token: string; px: number; sample: string }[] = [
  { token: "--text-2xs", px: 11, sample: "Table micro-labels, badges" },
  { token: "--text-xs", px: 12, sample: "Secondary meta" },
  { token: "--text-sm", px: 13, sample: "UI default" },
  { token: "--text-base", px: 14, sample: "Prose, notes" },
  { token: "--text-md", px: 16, sample: "Panel titles" },
  { token: "--text-lg", px: 20, sample: "Section headings" },
  { token: "--text-xl", px: 26, sample: "Stat figures" },
  { token: "--text-2xl", px: 34, sample: "Hero figure" },
];

function TypeScale() {
  return (
    <Panel>
      <PanelHeader title="Type scale" caption="13px UI base — this is an instrument, not an article" />
      <PanelBody>
        <div className="flex flex-col divide-y divide-line-faint">
          {TYPE_SCALE.map((step) => (
            <div key={step.token} className="grid grid-cols-[9rem_1fr_1fr] items-center gap-4 py-2.5">
              <div className="flex flex-col">
                <span className="font-mono text-2xs text-ink-3">{step.token}</span>
                <span className="text-2xs text-ink-3">{step.px}px</span>
              </div>
              <span className="truncate text-ink" style={{ fontSize: `var(${step.token})` }}>
                Aa — {step.sample}
              </span>
              <span className="mono truncate text-ink" style={{ fontSize: `var(${step.token})` }}>
                0123456789 −4.20R
              </span>
            </div>
          ))}
        </div>
      </PanelBody>
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Buttons
// ---------------------------------------------------------------------------

const VARIANTS = ["primary", "default", "ghost", "danger", "link"] as const;
const SIZES = ["sm", "md", "lg"] as const;

function ButtonMatrix() {
  return (
    <div className="scroll-x">
      <table className="w-full border-collapse text-left text-xs">
        <thead>
          <tr>
            <th className="label pb-2 pr-3">Variant</th>
            {SIZES.map((s) => (
              <th key={s} className="label pb-2 pr-3 text-left">
                {s}
              </th>
            ))}
            <th className="label pb-2 text-left">disabled</th>
          </tr>
        </thead>
        <tbody>
          {VARIANTS.map((variant) => (
            <tr key={variant} className="[&>td]:py-2 [&>td]:pr-3">
              <td className="whitespace-nowrap font-mono text-2xs text-ink-3">{variant}</td>
              {SIZES.map((size) => (
                <td key={size}>
                  <Button variant={variant} size={size}>
                    {variant === "link" ? "Link action" : "Button"}
                  </Button>
                </td>
              ))}
              <td>
                <Button variant={variant} size="md" disabled>
                  Button
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-4 flex items-center gap-3">
        <span className="label">Button group</span>
        <ButtonGroup>
          <Button variant="default" size="sm">
            Day
          </Button>
          <Button variant="default" size="sm">
            Week
          </Button>
          <Button variant="default" size="sm">
            Month
          </Button>
        </ButtonGroup>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

function InputStates() {
  return (
    <div className="flex flex-col gap-4">
      <FieldRow>
        <Field>
          <FieldLabel>Normal</FieldLabel>
          <Input placeholder="EURUSD" defaultValue="EURUSD" />
          <FieldHint>A plain text field.</FieldHint>
        </Field>
        <Field>
          <FieldLabel>Invalid</FieldLabel>
          <Input aria-invalid defaultValue="XYZABC" />
          <FieldError>Unknown symbol.</FieldError>
        </Field>
      </FieldRow>
      <FieldRow>
        <Field>
          <FieldLabel>Disabled</FieldLabel>
          <Input disabled defaultValue="Locked" />
        </Field>
        <Field>
          <FieldLabel>With unit</FieldLabel>
          <NumberInput defaultValue="12.5" unit="pips" />
        </Field>
      </FieldRow>
      <Field>
        <FieldLabel optional>Search</FieldLabel>
        <SearchInput placeholder="Search trades…" defaultValue="EURUSD" />
      </Field>
      <Field>
        <FieldLabel optional>Notes</FieldLabel>
        <Textarea placeholder="What happened…" />
      </Field>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Badges
// ---------------------------------------------------------------------------

function BadgeShowcase() {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        {(["neutral", "brand", "profit", "loss", "warn", "outline"] as const).map((tone) => (
          <Badge key={tone} tone={tone}>
            {tone}
          </Badge>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <DirectionBadge direction="LONG" />
        <DirectionBadge direction="SHORT" />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {["SYDNEY", "TOKYO", "LONDON", "NEW_YORK", "OVERLAP", "OFFHOURS"].map((s) => (
          <SessionBadge key={s} session={s} />
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <TagChip name="Breakout" color="var(--brand)" />
        <TagChip name="Revenge trade" color="var(--loss)" onRemove={() => {}} />
        <TagChip name="London open" color="var(--profit)" />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Values
// ---------------------------------------------------------------------------

function ValueShowcase() {
  return (
    <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-4">
      <ValueRow label="Money +">
        <Money value={1284.5} currency="USD" signed />
      </ValueRow>
      <ValueRow label="Money -">
        <Money value={-642.1} currency="USD" signed />
      </ValueRow>
      <ValueRow label="R multiple">
        <RValue value={1.85} />
      </ValueRow>
      <ValueRow label="R multiple -">
        <RValue value={-0.42} />
      </ValueRow>
      <ValueRow label="Pips">
        <Pips value={23.4} />
      </ValueRow>
      <ValueRow label="Percent">
        <Percent value={0.625} />
      </ValueRow>
      <ValueRow label="Empty">
        <Empty />
      </ValueRow>
    </div>
  );
}

function ValueRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="label">{label}</span>
      <span className="text-base">{children}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// RBar
// ---------------------------------------------------------------------------

const R_VALUES: { value: number | null; label: string }[] = [
  { value: -3.5, label: "-3.5R (clipped)" },
  { value: -2, label: "-2.0R" },
  { value: -1, label: "-1.0R" },
  { value: -0.3, label: "-0.3R" },
  { value: 0, label: "0.0R (breakeven)" },
  { value: 0.5, label: "+0.5R" },
  { value: 1.5, label: "+1.5R" },
  { value: 2, label: "+2.0R" },
  { value: 3.2, label: "+3.2R (clipped)" },
  { value: null, label: "No stop recorded" },
];

function RBarShowcase() {
  return (
    <div className="flex flex-col gap-2">
      {R_VALUES.map((row) => (
        <div key={row.label} className="flex items-center gap-3">
          <RBar value={row.value} scale={3} width={140} />
          <span className="mono text-xs text-ink-2">{row.label}</span>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sparkline
// ---------------------------------------------------------------------------

const SPARK_SERIES: { label: string; values: number[]; tone: "auto" | "brand" }[] = [
  { label: "Uptrend", values: [10, 12, 11, 14, 16, 15, 18, 21], tone: "auto" },
  { label: "Downtrend", values: [21, 19, 20, 16, 15, 13, 12, 10], tone: "auto" },
  { label: "Choppy, ends flat", values: [10, 14, 9, 15, 8, 13, 10, 10], tone: "auto" },
  { label: "Brand tone (forced)", values: [4, 6, 5, 9, 7, 11, 10, 13], tone: "brand" },
];

function SparklineShowcase() {
  return (
    <div className="grid grid-cols-2 gap-4">
      {SPARK_SERIES.map((s) => (
        <div key={s.label} className="flex flex-col gap-1.5 rounded-[var(--radius-control)] border border-line p-3">
          <span className="text-xs text-ink-2">{s.label}</span>
          <Sparkline values={s.values} width={160} height={32} tone={s.tone} />
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stat / StatRow
// ---------------------------------------------------------------------------

function StatShowcase() {
  return (
    <StatRow>
      <Stat
        label="Net P&L"
        value={<Money value={2840.12} currency="USD" signed />}
        tone="profit"
        spark={[10, 12, 9, 14, 18, 22]}
      />
      <Stat label="Win rate" value="58.3%" hint="needs 42% to break even" />
      <Stat label="Profit factor" value="1.94" />
      <Stat label="Expectancy R" value={<RValue value={0.31} />} tone="profit" />
      <Stat label="Max drawdown" value="−6.2%" hint="$620.00" tone="loss" spark={[0, -2, -4, -6, -3, -1]} />
      <Stat label="Current streak" value="3W" hint="longest: 5w / 3l" tone="profit" />
    </StatRow>
  );
}

// ---------------------------------------------------------------------------
// Table
// ---------------------------------------------------------------------------

const TABLE_ROWS = [
  { symbol: "EURUSD", dir: "LONG" as const, r: 1.8, pnl: 284.2 },
  { symbol: "GBPJPY", dir: "SHORT" as const, r: -0.6, pnl: -96.4 },
  { symbol: "XAUUSD", dir: "LONG" as const, r: 2.4, pnl: 612.0 },
];

function TableShowcase() {
  return (
    <DataTable>
      <thead>
        <tr>
          <Th>Symbol</Th>
          <Th sortable sortDirection="desc">
            <ColumnHeader sortDirection="desc">Direction</ColumnHeader>
          </Th>
          <Th numeric>R</Th>
          <Th numeric>Net P&L</Th>
        </tr>
      </thead>
      <tbody>
        {TABLE_ROWS.map((row) => (
          <tr key={row.symbol}>
            <Td>{row.symbol}</Td>
            <Td>
              <DirectionBadge direction={row.dir} />
            </Td>
            <Td numeric>
              <RValue value={row.r} />
            </Td>
            <Td numeric>
              <Money value={row.pnl} currency="USD" signed />
            </Td>
          </tr>
        ))}
        <TableEmpty colSpan={4}>No more rows to show.</TableEmpty>
      </tbody>
    </DataTable>
  );
}

// ---------------------------------------------------------------------------
// Skeletons
// ---------------------------------------------------------------------------

function SkeletonShowcase() {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <Skeleton className="size-9 rounded-full" />
        <SkeletonText lines={2} className="w-40" />
      </div>
      <table className="data-table">
        <tbody>
          <SkeletonRows rows={3} cols={4} />
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------------

function PaginationShowcase() {
  const [page, setPage] = React.useState(2);
  const [pageSize, setPageSize] = React.useState(25);
  const total = 312;
  return (
    <Pagination
      page={page}
      pageCount={Math.max(1, Math.ceil(total / pageSize))}
      pageSize={pageSize}
      total={total}
      onPage={setPage}
      onPageSize={(size) => {
        setPageSize(size);
        setPage(1);
      }}
    />
  );
}

// ---------------------------------------------------------------------------
// Dialog & dropdown
// ---------------------------------------------------------------------------

function OverlayShowcase() {
  const [checked, setChecked] = React.useState(true);
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Dialog>
        <DialogTrigger asChild>
          <Button variant="default">Open dialog</Button>
        </DialogTrigger>
        <DialogContent size="sm">
          <DialogHeader title="Delete this trade?" description="This can't be undone." />
          <DialogBody>
            <p className="text-xs text-ink-2">
              A dialog is centred, sits on a scrim, and closes on Escape or an outside click.
            </p>
          </DialogBody>
          <DialogFooter>
            <Button variant="default" size="sm">
              Cancel
            </Button>
            <Button variant="danger" size="sm">
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dropdown>
        <DropdownTrigger asChild>
          <Button variant="default">Open dropdown</Button>
        </DropdownTrigger>
        <DropdownContent align="start" className="w-48">
          <DropdownLabel>Actions</DropdownLabel>
          <DropdownItem>Duplicate trade</DropdownItem>
          <DropdownItem>Export CSV</DropdownItem>
          <DropdownSeparator />
          <DropdownCheckboxItem checked={checked} onCheckedChange={setChecked}>
            Show closed only
          </DropdownCheckboxItem>
          <DropdownSeparator />
          <DropdownItem tone="danger">Delete</DropdownItem>
        </DropdownContent>
      </Dropdown>

      <Tip label="A plain hover/focus label">
        <Button variant="ghost">Hover for a tooltip</Button>
      </Tip>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Select & tabs
// ---------------------------------------------------------------------------

function SelectAndTabsShowcase() {
  return (
    <div className="flex flex-col gap-5">
      <Field>
        <FieldLabel>Instrument</FieldLabel>
        <Select defaultValue="eurusd">
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {/* Radix requires a SelectGroup around a SelectLabel — a label
                outside one throws at runtime. */}
            <SelectGroup>
              <SelectLabel>Majors</SelectLabel>
              <SelectItem value="eurusd">EURUSD</SelectItem>
              <SelectItem value="gbpusd">GBPUSD</SelectItem>
            </SelectGroup>
            <SelectSeparator />
            <SelectGroup>
              <SelectLabel>Metals</SelectLabel>
              <SelectItem value="xauusd">XAUUSD</SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
      </Field>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="journal">Journal</TabsTrigger>
          <TabsTrigger value="disabled" disabled>
            Locked
          </TabsTrigger>
        </TabsList>
        <TabsContent value="overview" className="pt-3 text-xs text-ink-2">
          An underline indicator sits directly on the list&rsquo;s hairline.
        </TabsContent>
        <TabsContent value="journal" className="pt-3 text-xs text-ink-2">
          Tab content panel two.
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Segmented / switch / checkbox
// ---------------------------------------------------------------------------

function ControlsShowcase() {
  const [range, setRange] = React.useState("30d");
  const [enabled, setEnabled] = React.useState(true);
  const [checked, setChecked] = React.useState<boolean | "indeterminate">(true);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <span className="label">Segmented</span>
        <Segmented value={range} onValueChange={(v) => v && setRange(v)}>
          {["7d", "30d", "90d", "YTD", "All"].map((v) => (
            <SegmentedItem key={v} value={v.toLowerCase()}>
              {v}
            </SegmentedItem>
          ))}
        </Segmented>
      </div>

      <div className="flex items-center gap-3">
        <Switch checked={enabled} onCheckedChange={setEnabled} id="sw-demo" />
        <label htmlFor="sw-demo" className="text-xs text-ink-2">
          Notify on breach
        </label>
        <Switch disabled className="ml-4" />
        <span className="text-2xs text-ink-3">disabled</span>
      </div>

      <div className="flex items-center gap-3">
        <Checkbox checked={checked} onCheckedChange={setChecked} id="cb-demo" />
        <label htmlFor="cb-demo" className="text-xs text-ink-2">
          Followed the plan
        </label>
        <Checkbox disabled className="ml-4" />
        <span className="text-2xs text-ink-3">disabled</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Toast
// ---------------------------------------------------------------------------

function ToastShowcase() {
  const { toast } = useToast();
  return (
    <div className="flex flex-wrap gap-2">
      <Button variant="default" onClick={() => toast({ title: "Trade saved", tone: "neutral" })}>
        Neutral
      </Button>
      <Button variant="default" onClick={() => toast({ title: "Trade closed at +1.8R", tone: "profit" })}>
        Profit
      </Button>
      <Button
        variant="default"
        onClick={() =>
          toast({ title: "Couldn't save", description: "Check your connection and try again.", tone: "loss" })
        }
      >
        Loss
      </Button>
      <Button
        variant="default"
        onClick={() =>
          toast({
            title: "Two losses in a row today",
            description: "Your rule says stop at two.",
            tone: "warn",
            action: { label: "View", onClick: () => {} },
          })
        }
      >
        Warn (with action)
      </Button>
    </div>
  );
}
