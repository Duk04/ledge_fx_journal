"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FileText, UploadCloud } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  Combobox,
  instrumentOptions,
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
  Td,
  Th,
  useToast,
} from "@/components/ui";
import { importStatement, undoImport, type PreviewRow, type StatementReport } from "@/lib/actions/statements";
import { formatInZone } from "@/lib/metrics/formatters";
import type { RecentImport } from "@/lib/queries/statements";

// Labels live in messages under `trades.import.rowStatus` / `trades.import.source`,
// keyed by the same values, and are translated at the render site.
const STATUS_TONE: Record<PreviewRow["status"], "brand" | "neutral" | "warn" | "profit"> = {
  new: "brand",
  close: "profit",
  duplicate: "neutral",
  unmapped: "warn",
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
  const t = useTranslations("trades.import");
  const tCommon = useTranslations("trades.common");
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
      setError(result.formError ?? t("readError"));
      return;
    }
    if (mode === "preview") {
      setPreview({ key: inputsKey, report: result });
      return;
    }
    toast({
      title: t("importedToast", { count: result.counts.new }),
      description: result.counts.close ? t("closedToast", { count: result.counts.close }) : undefined,
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
      toast({ title: t("undoFailed"), description: result.formError, tone: "loss" });
      return;
    }
    toast({ title: t("undone", { trades: result.trades, events: result.balanceEvents }) });
    router.refresh();
  }

  const writable = report ? report.counts.new + report.counts.close + report.balanceEvents.new : 0;

  return (
    <div className="flex flex-col gap-4">
      <Panel>
        <PanelHeader title={t("statement")} caption={t("into", { account: accountLabel })} />
        <PanelBody className="flex flex-col gap-4">
          <DropZone file={file} dragging={dragging} onDragStateChange={setDragging} onFile={setFile} />

          <Field>
            <FieldLabel>{t("serverTime")}</FieldLabel>
            <div className="flex flex-wrap items-center gap-2">
              <Segmented value={tzMode} onValueChange={(v) => v && setTzMode(v as "ny-close" | "fixed")}>
                <SegmentedItem value="ny-close">{t("nyClose")}</SegmentedItem>
                <SegmentedItem value="fixed">{t("fixedOffset")}</SegmentedItem>
              </Segmented>
              {tzMode === "fixed" ? (
                <Input
                  aria-label={t("offsetLabel")}
                  className="w-24"
                  inputMode="decimal"
                  value={offsetHours}
                  onChange={(e) => setOffsetHours(e.target.value)}
                />
              ) : null}
            </div>
            <FieldHint>{t("serverTimeHint")}</FieldHint>
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
            {busy === "preview" ? t("reading") : t("preview")}
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
                ? t("importing")
                : report.balanceEvents.new
                  ? t("importTradesAndCash", { count: report.counts.new, events: report.balanceEvents.new })
                  : t("importTrades", { count: report.counts.new })}
            </Button>
          }
        />
      ) : null}

      {recent.length ? (
        <Panel flush>
          <PanelHeader title={t("recent")} caption={t("recentCaption")} />
          <DataTable>
            <thead>
              <tr>
                <Th>{t("when")}</Th>
                <Th>{t("file")}</Th>
                <Th>{t("timeReading")}</Th>
                <Th numeric>{t("trades")}</Th>
                <Th aria-label={tCommon("actions")} />
              </tr>
            </thead>
            <tbody>
              {recent.map((r) => (
                <tr key={r.id}>
                  <Td className="mono text-xs">{formatInZone(r.createdAt, timezone, "MMM d, HH:mm")}</Td>
                  <Td className="text-xs">
                    {r.fileName ?? "—"} <span className="text-ink-3">· {t(`source.${r.source}`)}</span>
                  </Td>
                  <Td className="text-xs text-ink-2">
                    {r.tzMode === "fixed"
                      ? `UTC${(r.tzOffsetMinutes ?? 0) >= 0 ? "+" : ""}${(r.tzOffsetMinutes ?? 0) / 60}`
                      : t("nyCloseShort")}
                  </Td>
                  <Td numeric className="mono text-xs">
                    {r.tradesRemaining}
                    {r.tradesRemaining !== r.tradesCreated ? (
                      <span className="text-ink-3"> / {r.tradesCreated}</span>
                    ) : null}
                  </Td>
                  <Td numeric>
                    <Button variant="ghost" size="sm" onClick={() => handleUndo(r.id)}>
                      {t("undo")}
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
  const t = useTranslations("trades.import");
  const tCommon = useTranslations("trades.common");
  const mismatches = report.rows.filter((r) => r.mismatch).length;
  const symbolOptions = instrumentOptions(instruments);
  return (
    <Panel flush>
      <PanelHeader
        title={t("preview")}
        caption={`${t(`source.${report.source}`)}${report.statementCurrency ? ` · ${report.statementCurrency}` : ""}`}
      />
      <PanelBody className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-2 text-xs">
          <Badge tone="brand">{t("countNew", { count: report.counts.new })}</Badge>
          {report.counts.close ? <Badge tone="profit">{t("countClose", { count: report.counts.close })}</Badge> : null}
          {report.counts.duplicate ? <Badge>{t("countDuplicate", { count: report.counts.duplicate })}</Badge> : null}
          {report.counts.unmapped ? (
            <Badge tone="warn">{t("countUnmapped", { count: report.counts.unmapped })}</Badge>
          ) : null}
          {report.balanceEvents.new ? (
            <Badge tone="outline">{t("countCash", { count: report.balanceEvents.new })}</Badge>
          ) : null}
          {report.skipped ? <Badge tone="warn">{t("countSkipped", { count: report.skipped })}</Badge> : null}
        </div>

        {report.warnings.map((w) => (
          <p key={w} className="text-xs text-warn">
            {w}
          </p>
        ))}
        {mismatches ? <p className="text-xs text-warn">{t("mismatchWarning", { count: mismatches })}</p> : null}

        {report.unmappedSymbols.length ? (
          <div className="flex flex-col gap-2 rounded-control border border-warn/30 bg-warn-weak p-3">
            <p className="text-xs text-ink">{t("unmappedPrompt")}</p>
            {report.unmappedSymbols.map((broker) => (
              <Field key={broker} className="flex-row items-center gap-3">
                <FieldLabel className="mono w-32">{broker}</FieldLabel>
                <Combobox
                  options={symbolOptions}
                  value={aliases[broker] || undefined}
                  onValueChange={(v) => onAlias(broker, v)}
                  className="w-56"
                  placeholder={t("skipThese")}
                />
              </Field>
            ))}
            <FieldHint>{t("unmappedHint")}</FieldHint>
          </div>
        ) : null}
      </PanelBody>

      <DataTable>
        <thead>
          <tr>
            <Th>{t("ticket")}</Th>
            <Th>{tCommon("opened")}</Th>
            <Th>{tCommon("symbol")}</Th>
            <Th>{tCommon("dir")}</Th>
            <Th numeric>{tCommon("lots")}</Th>
            <Th numeric>{tCommon("netPnl")}</Th>
            <Th numeric>{t("brokerGross")}</Th>
            <Th>{tCommon("status")}</Th>
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
                  <span className="text-xs text-ink-3">{t("openPnl")}</span>
                )}
              </Td>
              <Td numeric>
                <Money value={r.brokerProfit} currency={report.accountCurrency} colour={false} />
                {r.mismatch ? (
                  <Badge tone="warn" className="ml-1" title={t("mismatchTitle")}>
                    ≠
                  </Badge>
                ) : null}
              </Td>
              <Td>
                <Badge tone={STATUS_TONE[r.status]}>{t(`rowStatus.${r.status}`)}</Badge>
                {r.impliedRate ? (
                  <Badge tone="outline" className="ml-1" title={t("impliedRateTitle")}>
                    {t("rateFromBroker")}
                  </Badge>
                ) : null}
              </Td>
            </tr>
          ))}
        </tbody>
      </DataTable>
      <PanelFooter className="justify-between">
        <Link href="/trades" className="text-xs text-ink-2 hover:text-ink">
          {t("backToTrades")}
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
  const t = useTranslations("trades.import");
  const inputRef = React.useRef<HTMLInputElement>(null);
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={file ? t("fileChosen", { name: file.name }) : t("chooseFile")}
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
          <span className="text-xs text-ink-3">{t("replaceFile")}</span>
        </>
      ) : (
        <>
          <UploadCloud className="size-5 text-ink-3" aria-hidden />
          <span className="text-sm text-ink-2">{t("dropPrompt")}</span>
          <span className="text-xs text-ink-3">{t("formats")}</span>
        </>
      )}
    </div>
  );
}
