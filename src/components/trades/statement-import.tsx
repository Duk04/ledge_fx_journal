"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FileText, UploadCloud } from "lucide-react";
import {
  Badge,
  Button,
  DataTable,
  DirectionBadge,
  Field,
  FieldHint,
  FieldLabel,
  Input,
  Money,
  Panel,
  PanelBody,
  PanelFooter,
  PanelHeader,
  Segmented,
  SegmentedItem,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Td,
  Th,
  useToast,
} from "@/components/ui";
import { importStatement, undoImport, type PreviewRow, type StatementReport } from "@/lib/actions/statements";
import { formatInZone } from "@/lib/metrics/formatters";
import type { RecentImport } from "@/lib/queries/statements";

const STATUS: Record<PreviewRow["status"], { label: string; tone: "brand" | "neutral" | "warn" | "profit" }> = {
  new: { label: "New", tone: "brand" },
  close: { label: "Closes open", tone: "profit" },
  duplicate: { label: "Already imported", tone: "neutral" },
  unmapped: { label: "Unknown symbol", tone: "warn" },
};

const SOURCE_LABEL: Record<StatementReport["source"], string> = {
  MT4_HTML: "MT4 detailed statement",
  MT5_HTML: "MT5 report",
  CSV: "CSV",
};

export function StatementImport({
  accountId,
  accountLabel,
  timezone,
  instruments,
  recent,
}: {
  accountId: string;
  accountLabel: string;
  timezone: string;
  instruments: { symbol: string; displayName: string }[];
  recent: RecentImport[];
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [file, setFile] = React.useState<File | null>(null);
  const [dragging, setDragging] = React.useState(false);
  const [tzMode, setTzMode] = React.useState<"ny-close" | "fixed">("ny-close");
  const [offsetHours, setOffsetHours] = React.useState("2");
  const [aliases, setAliases] = React.useState<Record<string, string>>({});
  // The preview is stored with the inputs it was computed from, and only
  // shown while they still match — change the file or the time reading and
  // it disappears rather than describing a different import.
  const [preview, setPreview] = React.useState<{ key: string; report: StatementReport } | null>(null);
  const [busy, setBusy] = React.useState<"preview" | "import" | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const inputsKey = file ? [file.name, file.size, file.lastModified, tzMode, offsetHours].join("|") : "";
  const report = preview && preview.key === inputsKey ? preview.report : null;

  async function run(mode: "preview" | "import", withAliases: Record<string, string> = aliases) {
    if (!file) return;
    const fd = new FormData();
    fd.set("file", file);
    fd.set("mode", mode);
    fd.set("tzMode", tzMode);
    fd.set("tzOffsetMinutes", String(Math.round(Number(offsetHours) * 60)));
    fd.set("aliases", JSON.stringify(withAliases));

    setBusy(mode);
    setError(null);
    const result = await importStatement(accountId, fd);
    setBusy(null);
    if (!result.ok) {
      setError(result.formError ?? "Something went wrong reading that file.");
      return;
    }
    if (mode === "preview") {
      setPreview({ key: inputsKey, report: result });
      return;
    }
    toast({
      title: `Imported ${result.counts.new} trade${result.counts.new === 1 ? "" : "s"}`,
      description: result.counts.close ? `${result.counts.close} open position(s) closed.` : undefined,
    });
    setPreview(null);
    setFile(null);
    setAliases({});
    router.refresh();
  }

  function mapSymbol(brokerSymbol: string, symbol: string) {
    const next = { ...aliases, [brokerSymbol]: symbol };
    setAliases(next);
    void run("preview", next);
  }

  async function handleUndo(importId: string) {
    const result = await undoImport(importId);
    if (!result.ok) {
      toast({ title: "Couldn't undo that import", description: result.formError, tone: "loss" });
      return;
    }
    toast({ title: `Removed ${result.trades} trade(s) and ${result.balanceEvents} cash movement(s)` });
    router.refresh();
  }

  const writable = report ? report.counts.new + report.counts.close + report.balanceEvents.new : 0;

  return (
    <div className="flex flex-col gap-4">
      <Panel>
        <PanelHeader title="Statement" caption={`Into ${accountLabel}`} />
        <PanelBody className="flex flex-col gap-4">
          <DropZone file={file} dragging={dragging} onDragStateChange={setDragging} onFile={setFile} />

          <Field>
            <FieldLabel>Broker server time</FieldLabel>
            <div className="flex flex-wrap items-center gap-2">
              <Segmented value={tzMode} onValueChange={(v) => v && setTzMode(v as "ny-close" | "fixed")}>
                <SegmentedItem value="ny-close">New York close (UTC+2/+3)</SegmentedItem>
                <SegmentedItem value="fixed">Fixed offset</SegmentedItem>
              </Segmented>
              {tzMode === "fixed" ? (
                <Input
                  aria-label="UTC offset in hours"
                  className="w-24"
                  inputMode="decimal"
                  value={offsetHours}
                  onChange={(e) => setOffsetHours(e.target.value)}
                />
              ) : null}
            </div>
            <FieldHint>
              MetaTrader writes times in the broker&rsquo;s server clock with no timezone. Most retail FX brokers run
              New York + 7h, which follows US daylight saving — pick a fixed offset only if yours doesn&rsquo;t.
            </FieldHint>
          </Field>

          {error ? (
            <p role="alert" className="text-sm text-loss">
              {error}
            </p>
          ) : null}
        </PanelBody>
        <PanelFooter className="justify-end">
          {/* Primary until there is a preview; then the import button below is
              the one primary action on the page. */}
          <Button
            variant={report ? "default" : "primary"}
            disabled={!file || busy !== null}
            onClick={() => run("preview")}
          >
            {busy === "preview" ? "Reading…" : "Preview"}
          </Button>
        </PanelFooter>
      </Panel>

      {report ? (
        <Preview
          report={report}
          timezone={timezone}
          instruments={instruments}
          aliases={aliases}
          onAlias={mapSymbol}
          footer={
            <Button variant="primary" disabled={writable === 0 || busy !== null} onClick={() => run("import")}>
              {busy === "import"
                ? "Importing…"
                : `Import ${report.counts.new} trade${report.counts.new === 1 ? "" : "s"}${
                    report.balanceEvents.new ? ` and ${report.balanceEvents.new} cash movement(s)` : ""
                  }`}
            </Button>
          }
        />
      ) : null}

      {recent.length ? (
        <Panel flush>
          <PanelHeader title="Recent imports" caption="Undo removes the trades and cash movements an import created" />
          <DataTable>
            <thead>
              <tr>
                <Th>When</Th>
                <Th>File</Th>
                <Th>Time reading</Th>
                <Th numeric>Trades</Th>
                <Th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {recent.map((r) => (
                <tr key={r.id}>
                  <Td className="mono text-xs">{formatInZone(r.createdAt, timezone, "MMM d, HH:mm")}</Td>
                  <Td className="text-xs">
                    {r.fileName ?? "—"} <span className="text-ink-3">· {SOURCE_LABEL[r.source]}</span>
                  </Td>
                  <Td className="text-xs text-ink-2">
                    {r.tzMode === "fixed"
                      ? `UTC${(r.tzOffsetMinutes ?? 0) >= 0 ? "+" : ""}${(r.tzOffsetMinutes ?? 0) / 60}`
                      : "NY close"}
                  </Td>
                  <Td numeric className="mono text-xs">
                    {r.tradesRemaining}
                    {r.tradesRemaining !== r.tradesCreated ? (
                      <span className="text-ink-3"> / {r.tradesCreated}</span>
                    ) : null}
                  </Td>
                  <Td numeric>
                    <Button variant="ghost" size="sm" onClick={() => handleUndo(r.id)}>
                      Undo
                    </Button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        </Panel>
      ) : null}
    </div>
  );
}

function Preview({
  report,
  timezone,
  instruments,
  aliases,
  onAlias,
  footer,
}: {
  report: StatementReport;
  timezone: string;
  instruments: { symbol: string; displayName: string }[];
  aliases: Record<string, string>;
  onAlias: (brokerSymbol: string, symbol: string) => void;
  footer: React.ReactNode;
}) {
  const mismatches = report.rows.filter((r) => r.mismatch).length;
  return (
    <Panel flush>
      <PanelHeader
        title="Preview"
        caption={`${SOURCE_LABEL[report.source]}${report.statementCurrency ? ` · ${report.statementCurrency}` : ""}`}
      />
      <PanelBody className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-2 text-xs">
          <Badge tone="brand">{report.counts.new} new</Badge>
          {report.counts.close ? <Badge tone="profit">{report.counts.close} closing open positions</Badge> : null}
          {report.counts.duplicate ? <Badge>{report.counts.duplicate} already imported</Badge> : null}
          {report.counts.unmapped ? <Badge tone="warn">{report.counts.unmapped} unknown symbol</Badge> : null}
          {report.balanceEvents.new ? (
            <Badge tone="outline">{report.balanceEvents.new} deposits/withdrawals</Badge>
          ) : null}
          {report.skipped ? <Badge tone="warn">{report.skipped} unreadable rows</Badge> : null}
        </div>

        {report.warnings.map((w) => (
          <p key={w} className="text-xs text-warn">
            {w}
          </p>
        ))}
        {mismatches ? (
          <p className="text-xs text-warn">
            {mismatches} trade(s) compute a different gross P&amp;L from the broker&rsquo;s. That usually means this
            broker&rsquo;s contract size for the instrument differs from the journal&rsquo;s — check those rows after
            importing.
          </p>
        ) : null}

        {report.unmappedSymbols.length ? (
          <div className="flex flex-col gap-2 rounded-control border border-warn/30 bg-warn-weak p-3">
            <p className="text-xs text-ink">
              Which instrument is each of these? Your answer is remembered for next time.
            </p>
            {report.unmappedSymbols.map((broker) => (
              <Field key={broker} className="flex-row items-center gap-3">
                <FieldLabel className="mono w-32">{broker}</FieldLabel>
                <Select value={aliases[broker] ?? ""} onValueChange={(v) => onAlias(broker, v)}>
                  <SelectTrigger className="w-56">
                    <SelectValue placeholder="Skip these trades" />
                  </SelectTrigger>
                  <SelectContent>
                    {instruments.map((i) => (
                      <SelectItem key={i.symbol} value={i.symbol}>
                        {i.symbol} — {i.displayName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            ))}
            <FieldHint>Picking an instrument re-runs the preview before anything is imported.</FieldHint>
          </div>
        ) : null}
      </PanelBody>

      <DataTable>
        <thead>
          <tr>
            <Th>Ticket</Th>
            <Th>Opened</Th>
            <Th>Symbol</Th>
            <Th>Dir</Th>
            <Th numeric>Lots</Th>
            <Th numeric>Net P&amp;L</Th>
            <Th numeric>Broker gross</Th>
            <Th>Status</Th>
          </tr>
        </thead>
        <tbody>
          {report.rows.map((r) => (
            <tr key={r.ticket}>
              <Td className="mono text-xs">{r.ticket}</Td>
              <Td className="mono text-xs">{formatInZone(r.openedAt, timezone, "MMM d, HH:mm")}</Td>
              <Td className="text-xs">
                <span className="font-medium text-ink">{r.symbol ?? r.symbolRaw}</span>
                {r.symbol && r.symbol !== r.symbolRaw.toUpperCase() ? (
                  <span className="text-ink-3"> ← {r.symbolRaw}</span>
                ) : null}
              </Td>
              <Td>
                <DirectionBadge direction={r.direction} />
              </Td>
              <Td numeric className="mono text-xs">
                {r.volumeLots}
              </Td>
              <Td numeric>
                {r.closedAt ? (
                  <Money value={r.netPnl} currency={report.accountCurrency} signed />
                ) : (
                  <span className="text-xs text-ink-3">open</span>
                )}
              </Td>
              <Td numeric>
                <Money value={r.brokerProfit} currency={report.accountCurrency} colour={false} />
                {r.mismatch ? (
                  <Badge tone="warn" className="ml-1" title="Our gross P&L differs from the broker's">
                    ≠
                  </Badge>
                ) : null}
              </Td>
              <Td>
                <Badge tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Badge>
                {r.impliedRate ? (
                  <Badge tone="outline" className="ml-1" title="Conversion rate taken from the broker's profit">
                    rate from broker
                  </Badge>
                ) : null}
              </Td>
            </tr>
          ))}
        </tbody>
      </DataTable>
      <PanelFooter className="justify-between">
        <Link href="/trades" className="text-xs text-ink-2 hover:text-ink">
          Back to trades
        </Link>
        {footer}
      </PanelFooter>
    </Panel>
  );
}

function DropZone({
  file,
  dragging,
  onDragStateChange,
  onFile,
}: {
  file: File | null;
  dragging: boolean;
  onDragStateChange: (dragging: boolean) => void;
  onFile: (file: File | null) => void;
}) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={file ? `Statement file: ${file.name}. Choose another` : "Choose a statement file"}
      onClick={() => inputRef.current?.click()}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") inputRef.current?.click();
      }}
      onDragOver={(e) => {
        e.preventDefault();
        onDragStateChange(true);
      }}
      onDragLeave={() => onDragStateChange(false)}
      onDrop={(e) => {
        e.preventDefault();
        onDragStateChange(false);
        const dropped = e.dataTransfer.files?.[0];
        if (dropped) onFile(dropped);
      }}
      className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-control border border-dashed px-4 py-8 text-center transition-colors duration-[var(--dur-fast)] ${
        dragging ? "border-brand bg-brand-weak" : "border-line hover:border-line-strong"
      }`}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".htm,.html,.csv,.txt"
        className="hidden"
        data-testid="statement-file"
        onChange={(e) => onFile(e.target.files?.[0] ?? null)}
      />
      {file ? (
        <>
          <FileText className="size-5 text-ink-2" aria-hidden />
          <span className="text-sm text-ink">{file.name}</span>
          <span className="text-xs text-ink-3">click or drop to replace</span>
        </>
      ) : (
        <>
          <UploadCloud className="size-5 text-ink-3" aria-hidden />
          <span className="text-sm text-ink-2">Drop a statement here, or click to choose one</span>
          <span className="text-xs text-ink-3">
            MT4 Detailed Statement (.htm), MT5 Report (.html), or a CSV — up to 10MB
          </span>
        </>
      )}
    </div>
  );
}
