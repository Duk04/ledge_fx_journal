"use client";

import * as React from "react";
import { UploadCloud, FileText } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  Combobox,
  instrumentOptions,
  Panel,
  PanelHeader,
  PanelBody,
  PanelFooter,
  Field,
  FieldLabel,
  FieldHint,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  Segmented,
  SegmentedItem,
  Input,
  Button,
  Badge,
  DataTable,
  Th,
  Td,
  useToast,
} from "@/components/ui";
import { parseCandleCsv, type ParseCandleCsvResult } from "@/lib/candles/parse";
import { importCandles, type ImportReport } from "@/lib/actions/candles";
import type { ActionResult } from "@/lib/actions/result";

export interface InstrumentOption {
  symbol: string;
  displayName: string;
}

// Codes only: their "M1 — 1 minute" labels are translated, so they live in
// messages under backtest.import.timeframes.
const TIMEFRAMES = ["M1", "M5", "M15", "M30", "H1", "H4", "D1", "W1"] as const;

/** UTC+2/+3 covers the large majority of MT5 brokers (most run on Eastern
 * European or Moscow server time); "Custom" is there for the rest rather
 * than forcing a guess. */
const TZ_PRESETS: { value: string; minutes: number; label: string }[] = [
  { value: "0", minutes: 0, label: "UTC" },
  { value: "120", minutes: 120, label: "UTC+2" },
  { value: "180", minutes: 180, label: "UTC+3" },
];

function formatOffsetLabel(minutes: number): string {
  if (minutes === 0) return "UTC";
  const sign = minutes > 0 ? "+" : "-";
  const abs = Math.abs(minutes);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return `UTC${sign}${h}${m ? `:${String(m).padStart(2, "0")}` : ""}`;
}

export function CandleImportPanel({ instruments }: { instruments: InstrumentOption[] }) {
  const t = useTranslations("backtest");
  const { toast } = useToast();

  const [file, setFile] = React.useState<File | null>(null);
  const [dragging, setDragging] = React.useState(false);
  const [symbol, setSymbol] = React.useState(instruments[0]?.symbol ?? "");
  const [timeframe, setTimeframe] = React.useState("M1");
  const [tzPreset, setTzPreset] = React.useState("0");
  const [tzCustom, setTzCustom] = React.useState("0");
  const [preview, setPreview] = React.useState<ParseCandleCsvResult | null>(null);
  const [previewError, setPreviewError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);
  const [result, setResult] = React.useState<ActionResult<ImportReport> | null>(null);

  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const tzOffsetMinutes = tzPreset === "custom" ? Number(tzCustom) : Number(tzPreset);
  const tzInvalid = !Number.isFinite(tzOffsetMinutes);

  // Re-parse client-side whenever the file or the offset changes, so the
  // preview always reflects what will actually be imported — including a tz
  // change shifting every timestamp — before anything touches the server.
  // Nothing here sets state synchronously in the effect body itself: with no
  // file, or an invalid offset, there is simply nothing to do (the render
  // below already treats `!file || tzInvalid` as "no preview to show"), and
  // every state update that does happen is inside the async `.then`/`.catch`
  // callback once the file has actually been read.
  React.useEffect(() => {
    if (!file || tzInvalid) return;

    let cancelled = false;
    file
      .text()
      .then((text) => {
        if (cancelled) return;
        try {
          setPreview(parseCandleCsv(text, { tzOffsetMinutes }));
          setPreviewError(null);
        } catch (err) {
          setPreview(null);
          setPreviewError(err instanceof Error ? err.message : t("import.couldNotParse"));
        }
      })
      .catch(() => {
        if (!cancelled) setPreviewError(t("import.couldNotRead"));
      });
    return () => {
      cancelled = true;
    };
  }, [file, tzInvalid, tzOffsetMinutes, t]);

  function pickFile(next: File | null) {
    setFile(next);
    setResult(null);
    if (!next) {
      setPreview(null);
      setPreviewError(null);
    }
  }

  async function handleImport() {
    if (!file || !symbol || !timeframe || !Number.isFinite(tzOffsetMinutes)) return;

    setPending(true);
    setResult(null);

    const formData = new FormData();
    formData.set("file", file);
    formData.set("symbol", symbol);
    formData.set("timeframe", timeframe);
    formData.set("tzOffsetMinutes", String(tzOffsetMinutes));

    const outcome = await importCandles(formData);
    setPending(false);
    setResult(outcome);

    if (outcome.ok) {
      toast({ title: t("import.imported", { count: String(outcome.inserted + outcome.updated) }) });
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  const canImport = Boolean(file && symbol && timeframe && Number.isFinite(tzOffsetMinutes) && !pending);

  return (
    <Panel>
      <PanelHeader title={t("import.title")} caption={t("import.caption")} />
      <PanelBody className="flex flex-col gap-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field>
            <FieldLabel>{t("form.symbol")}</FieldLabel>
            <Combobox
              options={instrumentOptions(instruments)}
              value={symbol}
              onValueChange={setSymbol}
              placeholder={t("form.chooseSymbol")}
            />
          </Field>
          <Field>
            <FieldLabel>{t("form.timeframe")}</FieldLabel>
            <Select value={timeframe} onValueChange={setTimeframe}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TIMEFRAMES.map((tf) => (
                  <SelectItem key={tf} value={tf}>
                    {t(`import.timeframes.${tf}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>

        <Field>
          <FieldLabel>{t("import.tz")}</FieldLabel>
          <div className="flex flex-wrap items-center gap-2">
            <Segmented value={tzPreset} onValueChange={(v) => v && setTzPreset(v)}>
              {TZ_PRESETS.map((p) => (
                <SegmentedItem key={p.value} value={p.value}>
                  {p.label}
                </SegmentedItem>
              ))}
              <SegmentedItem value="custom">{t("import.custom")}</SegmentedItem>
            </Segmented>
            {tzPreset === "custom" ? (
              <Input
                value={tzCustom}
                onChange={(e) => setTzCustom(e.target.value)}
                placeholder={t("import.minutesPlaceholder")}
                className="w-36"
                inputMode="numeric"
              />
            ) : (
              <span className="text-xs text-ink-2">{formatOffsetLabel(tzOffsetMinutes)}</span>
            )}
          </div>
          <FieldHint>{t("import.tzHint")}</FieldHint>
        </Field>

        <FileDropZone
          file={file}
          dragging={dragging}
          onDragStateChange={setDragging}
          onFile={pickFile}
          inputRef={fileInputRef}
        />

        {tzInvalid && file ? <p className="text-xs text-loss">{t("import.invalidTz")}</p> : null}
        {!tzInvalid && previewError ? <p className="text-xs text-loss">{previewError}</p> : null}

        {!tzInvalid && preview ? <ParsePreview preview={preview} /> : null}

        {result ? <ImportSummary result={result} /> : null}
      </PanelBody>
      <PanelFooter>
        <span className="text-xs text-ink-3">{file ? file.name : t("import.noFile")}</span>
        <Button variant="primary" onClick={handleImport} disabled={!canImport}>
          {pending ? t("import.importing") : t("import.import")}
        </Button>
      </PanelFooter>
    </Panel>
  );
}

function FileDropZone({
  file,
  dragging,
  onDragStateChange,
  onFile,
  inputRef,
}: {
  file: File | null;
  dragging: boolean;
  onDragStateChange: (v: boolean) => void;
  onFile: (file: File | null) => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
}) {
  const t = useTranslations("backtest.import");
  return (
    <div
      role="button"
      tabIndex={0}
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
        accept=".csv,.txt"
        className="hidden"
        onChange={(e) => onFile(e.target.files?.[0] ?? null)}
      />
      {file ? (
        <>
          <FileText className="size-5 text-ink-2" aria-hidden />
          <span className="text-sm text-ink">{file.name}</span>
          <span className="text-xs text-ink-3">
            {t("fileReplace", { size: (file.size / (1024 * 1024)).toFixed(2) })}
          </span>
        </>
      ) : (
        <>
          <UploadCloud className="size-5 text-ink-3" aria-hidden />
          <span className="text-sm text-ink-2">{t("dropHere")}</span>
          <span className="text-xs text-ink-3">{t("dropHint")}</span>
        </>
      )}
    </div>
  );
}

function ParsePreview({ preview }: { preview: ParseCandleCsvResult }) {
  const t = useTranslations("backtest.import");
  const sample = preview.rows.slice(0, 5);
  return (
    <div className="flex flex-col gap-2 rounded-control border border-line bg-panel-sunken p-3">
      <div className="flex flex-wrap items-center gap-2 text-xs text-ink-2">
        <Badge tone="brand">{preview.format === "MT5" ? t("formatMt5") : t("formatGeneric")}</Badge>
        <span>{t("validRows", { count: preview.rows.length.toLocaleString() })}</span>
        {preview.skipped > 0 ? (
          <span className="text-warn">{t("skipped", { count: preview.skipped.toLocaleString() })}</span>
        ) : null}
      </div>

      {sample.length > 0 ? (
        <DataTable>
          <thead>
            <tr>
              <Th>{t("time")}</Th>
              <Th numeric>{t("open")}</Th>
              <Th numeric>{t("high")}</Th>
              <Th numeric>{t("low")}</Th>
              <Th numeric>{t("close")}</Th>
              <Th numeric>{t("volume")}</Th>
            </tr>
          </thead>
          <tbody>
            {sample.map((row) => (
              <tr key={row.ts}>
                <Td className="mono text-xs">{new Date(row.ts).toISOString().replace("T", " ").slice(0, 19)}</Td>
                <Td numeric className="mono">
                  {row.open}
                </Td>
                <Td numeric className="mono">
                  {row.high}
                </Td>
                <Td numeric className="mono">
                  {row.low}
                </Td>
                <Td numeric className="mono">
                  {row.close}
                </Td>
                <Td numeric className="mono">
                  {row.volume ?? "—"}
                </Td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      ) : (
        <p className="text-xs text-loss">{t("noValidRows")}</p>
      )}

      {preview.warnings.length > 0 ? (
        <ul className="flex flex-col gap-0.5 text-2xs text-ink-3">
          {preview.warnings.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function ImportSummary({ result }: { result: ActionResult<ImportReport> }) {
  const t = useTranslations("backtest.import");
  if (!result.ok) {
    return (
      <p className="rounded-control border border-loss/35 bg-loss-weak px-2.5 py-2 text-xs text-loss">
        {result.formError}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-1 rounded-control border border-profit/25 bg-profit-weak px-2.5 py-2 text-xs text-profit">
      <span>
        {result.skipped > 0
          ? t("summaryWithSkipped", {
              inserted: result.inserted.toLocaleString(),
              updated: result.updated.toLocaleString(),
              skipped: result.skipped.toLocaleString(),
            })
          : t("summary", { inserted: result.inserted.toLocaleString(), updated: result.updated.toLocaleString() })}
      </span>
      {result.warnings.length > 0 ? (
        <ul className="flex flex-col gap-0.5 text-2xs text-ink-2">
          {result.warnings.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
