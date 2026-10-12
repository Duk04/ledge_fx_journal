"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { CloudDownload } from "lucide-react";
import {
  Button,
  Field,
  FieldLabel,
  FieldRow,
  Input,
  Panel,
  PanelBody,
  PanelFooter,
  PanelHeader,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  useToast,
} from "@/components/ui";
import { downloadCandles } from "@/lib/actions/market-data";
import { defaultDownloadRange } from "@/lib/candles/oanda";
import type { InstrumentOption } from "@/lib/queries/instruments";

const TIMEFRAMES = ["M1", "M5", "M15", "M30", "H1", "H4", "D1", "W1"] as const;
type Tf = (typeof TIMEFRAMES)[number];

/**
 * Backtest → Data: fetch bars from OANDA instead of importing a file
 * (lib/actions/market-data.ts). Without a token it explains how to get one;
 * for a non-owner the button is disabled with the reason, since writing
 * shared candles is owner-only.
 */
export function CandleDownloadPanel({
  instruments,
  configured,
  canWrite,
}: {
  /** Already filtered to the symbols OANDA has. */
  instruments: InstrumentOption[];
  configured: boolean;
  canWrite: boolean;
}) {
  const t = useTranslations("backtest.download");
  const { toast } = useToast();
  const router = useRouter();
  const [symbol, setSymbol] = React.useState(instruments[0]?.symbol ?? "EURUSD");
  const [timeframe, setTimeframe] = React.useState<Tf>("M15");
  const [range, setRange] = React.useState(() => defaultDownloadRange("M15"));
  const [rangeTouched, setRangeTouched] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  const [result, setResult] = React.useState<string | null>(null);

  if (!configured) {
    return (
      <Panel>
        <PanelHeader title={t("setupTitle")} caption={t("caption")} />
        <PanelBody className="flex flex-col gap-2 text-xs text-ink-2">
          <p>{t("setupIntro")}</p>
          <ol className="list-decimal space-y-1 pl-5">
            <li>{t("step1")}</li>
            <li>{t("step2")}</li>
            <li>{t("step3")}</li>
          </ol>
          <p className="text-ink-3">{t("starterHint")}</p>
        </PanelBody>
      </Panel>
    );
  }

  function changeTimeframe(tf: Tf) {
    setTimeframe(tf);
    // Keep a hand-picked range; otherwise follow the timeframe's default
    // span, which stays inside the per-download bar limit.
    if (!rangeTouched) setRange(defaultDownloadRange(tf));
  }

  function submit() {
    setResult(null);
    startTransition(async () => {
      const res = await downloadCandles({ symbol, timeframe, from: range.from, to: range.to });
      if (!res.ok) {
        toast({ title: t("failed"), description: res.formError, tone: "loss" });
        return;
      }
      const message = t("done", {
        inserted: res.inserted.toLocaleString("en-US"),
        existing: res.existing.toLocaleString("en-US"),
      });
      setResult(message);
      toast({ title: message, tone: "profit" });
      router.refresh();
    });
  }

  return (
    <Panel>
      <PanelHeader title={t("title")} caption={t("caption")} />
      <PanelBody className="flex flex-col gap-3">
        <FieldRow>
          <Field>
            <FieldLabel>{t("symbol")}</FieldLabel>
            <Select value={symbol} onValueChange={setSymbol}>
              <SelectTrigger>
                <SelectValue />
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
          <Field>
            <FieldLabel>{t("timeframe")}</FieldLabel>
            <Select value={timeframe} onValueChange={(v) => changeTimeframe(v as Tf)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TIMEFRAMES.map((tf) => (
                  <SelectItem key={tf} value={tf}>
                    {tf}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </FieldRow>
        <FieldRow>
          <Field>
            <FieldLabel>{t("from")}</FieldLabel>
            <Input
              type="date"
              value={range.from}
              onChange={(e) => {
                setRangeTouched(true);
                setRange((r) => ({ ...r, from: e.target.value }));
              }}
            />
          </Field>
          <Field>
            <FieldLabel>{t("to")}</FieldLabel>
            <Input
              type="date"
              value={range.to}
              onChange={(e) => {
                setRangeTouched(true);
                setRange((r) => ({ ...r, to: e.target.value }));
              }}
            />
          </Field>
        </FieldRow>
        {result ? (
          <p role="status" className="text-xs text-ink-2">
            {result}
          </p>
        ) : null}
      </PanelBody>
      <PanelFooter className="justify-end">
        <Button
          variant="default"
          onClick={submit}
          disabled={pending || !canWrite || !range.from || !range.to}
          title={canWrite ? undefined : t("ownerOnly")}
        >
          <CloudDownload /> {pending ? t("downloading") : t("submit")}
        </Button>
      </PanelFooter>
    </Panel>
  );
}
