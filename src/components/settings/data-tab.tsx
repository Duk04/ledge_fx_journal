"use client";

import { useTranslations } from "next-intl";

import * as React from "react";
import { Download, FileJson, RefreshCw, Upload } from "lucide-react";
import { Panel, PanelHeader, PanelBody, Button, useToast } from "@/components/ui";
import { recomputeDerivedColumns } from "@/app/(app)/settings/actions";
import { restoreFromExport, type RestoreSummary } from "@/lib/actions/restore";

export function DataTab() {
  const t = useTranslations("settings.data");
  const [pending, setPending] = React.useState(false);
  const { toast } = useToast();

  async function handleRecompute() {
    setPending(true);
    const result = await recomputeDerivedColumns();
    setPending(false);
    if (result.ok) {
      toast({ title: t("recomputed", { count: result.updated ?? 0 }) });
    } else {
      toast({ title: t("couldNotRecompute"), description: result.formError, tone: "loss" });
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Panel>
        <PanelHeader title={t("export")} caption={t("exportCaption")} />
        <PanelBody className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm text-ink">{t("csvTitle")}</p>
              <p className="text-xs text-ink-3">{t("csvCaption")}</p>
            </div>
            <Button asChild variant="default" size="sm">
              <a href="/api/export/trades">
                <Download /> {t("csv")}
              </a>
            </Button>
          </div>
          <div className="flex items-center justify-between gap-3 border-t border-line pt-3">
            <div>
              <p className="text-sm text-ink">{t("jsonTitle")}</p>
              <p className="text-xs text-ink-3">{t("jsonCaption")}</p>
            </div>
            <Button asChild variant="default" size="sm">
              <a href="/api/export/data">
                <Download /> {t("json")}
              </a>
            </Button>
          </div>
          <p className="border-t border-line pt-3 text-2xs text-ink-3">{t("notIncluded")}</p>
        </PanelBody>
      </Panel>

      <Panel>
        <PanelHeader title={t("derived")} caption={t("derivedCaption")} />
        <PanelBody className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
          <p className="max-w-md text-xs text-ink-3">{t("derivedBody")}</p>
          <Button variant="default" size="sm" onClick={handleRecompute} disabled={pending} className="shrink-0">
            <RefreshCw /> {t("recompute")}
          </Button>
        </PanelBody>
      </Panel>

      <RestorePanel />
    </div>
  );
}

/**
 * Restore from a JSON export. No button on this tab is `primary`: every
 * action here is occasional, and none is the thing the page is "for".
 * The summary stays on screen after the toast, because "what was skipped and
 * why" is the part someone needs to read, and a toast is gone in seconds.
 */
function RestorePanel() {
  const t = useTranslations("settings.restore");
  const { toast } = useToast();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [file, setFile] = React.useState<File | null>(null);
  const [pending, setPending] = React.useState(false);
  const [result, setResult] = React.useState<{ fileName: string; summary: RestoreSummary } | null>(null);

  async function handleRestore() {
    if (!file) return;
    setPending(true);
    const formData = new FormData();
    formData.set("file", file);
    const res = await restoreFromExport(formData);
    setPending(false);
    if (!res.ok) {
      toast({ title: t("couldNotRestore"), description: res.formError, tone: "loss" });
      return;
    }
    const summary: RestoreSummary = res;
    setResult({ fileName: file.name, summary });
    setFile(null);
    if (inputRef.current) inputRef.current.value = "";
    toast({ title: t("done", { accounts: summary.accounts, trades: summary.trades }) });
  }

  return (
    <Panel>
      <PanelHeader title={t("title")} caption={t("caption")} />
      <PanelBody className="flex flex-col gap-3">
        <p className="max-w-prose text-xs text-ink-3">{t("body")}</p>
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={inputRef}
            type="file"
            accept=".json,application/json"
            className="hidden"
            data-testid="restore-file"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
          <Button size="sm" onClick={() => inputRef.current?.click()} disabled={pending}>
            <FileJson /> {t("choose")}
          </Button>
          <span className="min-w-0 truncate text-xs text-ink-2">{file ? file.name : t("noFile")}</span>
          <Button size="sm" onClick={handleRestore} disabled={!file || pending} className="ml-auto">
            <Upload /> {pending ? t("restoring") : t("submit")}
          </Button>
        </div>
        {result ? <RestoreResult fileName={result.fileName} summary={result.summary} /> : null}
      </PanelBody>
    </Panel>
  );
}

function RestoreResult({ fileName, summary }: { fileName: string; summary: RestoreSummary }) {
  const t = useTranslations("settings.restore");
  const s = summary.skipped;
  const created = [
    t("createdAccounts", { count: summary.accounts }),
    t("createdTrades", { count: summary.trades }),
    summary.balanceEvents ? t("createdBalanceEvents", { count: summary.balanceEvents }) : null,
    summary.journalEntries ? t("createdJournal", { count: summary.journalEntries }) : null,
    summary.tagsCreated ? t("createdTags", { count: summary.tagsCreated }) : null,
    summary.playbooksCreated ? t("createdPlaybooks", { count: summary.playbooksCreated }) : null,
    summary.strategies ? t("createdStrategies", { count: summary.strategies }) : null,
    summary.attachments ? t("createdAttachments", { count: summary.attachments }) : null,
  ].filter((line): line is string => line !== null);
  const skipped = [
    s.backtestAccounts ? t("skippedBacktest", { count: s.backtestAccounts }) : null,
    s.unknownSymbolTrades
      ? t("skippedUnknownSymbols", { count: s.unknownSymbolTrades, symbols: s.unknownSymbols.join(", ") })
      : null,
    s.invalidTrades ? t("skippedInvalidTrades", { count: s.invalidTrades }) : null,
    s.journalDays ? t("skippedJournal", { count: s.journalDays }) : null,
    s.uploadedAttachments ? t("skippedUploads", { count: s.uploadedAttachments }) : null,
    s.unsafeLinks ? t("skippedLinks", { count: s.unsafeLinks }) : null,
    s.ruleChecks ? t("skippedRuleChecks", { count: s.ruleChecks }) : null,
    s.strategies ? t("skippedStrategies", { count: s.strategies }) : null,
    s.symbolAliases ? t("skippedAliases", { count: s.symbolAliases }) : null,
  ].filter((line): line is string => line !== null);

  return (
    <div className="flex flex-col gap-2 border-t border-line pt-3 text-xs" data-testid="restore-result">
      <p className="font-medium text-ink">{t("resultTitle", { file: fileName })}</p>
      <div>
        <p className="text-ink-3">{t("created")}</p>
        <p className="text-ink-2">{created.join(" · ")}</p>
      </div>
      <div>
        <p className="text-ink-3">{t("skippedTitle")}</p>
        {skipped.length ? (
          <ul className="list-disc pl-4 text-ink-2">
            {skipped.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        ) : (
          <p className="text-ink-2">{t("nothingSkipped")}</p>
        )}
      </div>
    </div>
  );
}
