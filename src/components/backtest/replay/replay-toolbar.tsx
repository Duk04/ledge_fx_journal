"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import {
  Eraser,
  Keyboard,
  Minus,
  MousePointer2,
  RectangleHorizontal,
  Rows3,
  Slash,
  SquareArrowDown,
  SquareArrowUp,
  Trash2,
  Undo2,
} from "lucide-react";
import type { Timeframe } from "@prisma/client";
import {
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogHeader,
  Kbd,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Tip,
  useModKey,
} from "@/components/ui";
import { cn } from "@/lib/cn";
import type { ChartTool } from "./candlestick-chart";

export type PositionToolSide = "LONG" | "SHORT" | null;

const DRAW_TOOLS: { tool: ChartTool; icon: React.ReactNode; key: string }[] = [
  { tool: "cursor", icon: <MousePointer2 />, key: "V" },
  { tool: "trend", icon: <Slash />, key: "T" },
  { tool: "hline", icon: <Minus />, key: "H" },
  { tool: "rect", icon: <RectangleHorizontal />, key: "R" },
  { tool: "fib", icon: <Rows3 />, key: "F" },
];

/**
 * The strip above the replay chart: drawing tools, the position tools, the
 * drawing edits and the second-chart picker. Every button names its key in
 * its tooltip; the full list is behind the keyboard button.
 */
export function ReplayToolbar({
  tool,
  onTool,
  positionSide,
  onPositionSide,
  positionDisabled,
  canUndo,
  hasSelection,
  onUndo,
  onDeleteSelected,
  onClearAll,
  htfOptions,
  htf,
  onHtf,
}: {
  tool: ChartTool;
  onTool: (tool: ChartTool) => void;
  positionSide: PositionToolSide;
  onPositionSide: (side: PositionToolSide) => void;
  /** In a position or with an order pending: the tool would plan nothing. */
  positionDisabled: boolean;
  canUndo: boolean;
  hasSelection: boolean;
  onUndo: () => void;
  onDeleteSelected: () => void;
  onClearAll: () => void;
  htfOptions: Timeframe[];
  htf: Timeframe | null;
  onHtf: (tf: Timeframe | null) => void;
}) {
  const t = useTranslations("backtest.replay");
  const mod = useModKey();
  const [helpOpen, setHelpOpen] = React.useState(false);

  const toolLabel = (k: ChartTool) =>
    k === "cursor"
      ? t("tools.cursor")
      : k === "trend"
        ? t("tools.trend")
        : k === "hline"
          ? t("tools.hline")
          : k === "rect"
            ? t("tools.rect")
            : t("tools.fib");

  return (
    <div role="toolbar" aria-label={t("tools.label")} className="flex flex-wrap items-center gap-1">
      {DRAW_TOOLS.map(({ tool: k, icon, key }) => (
        <Tip key={k} label={`${toolLabel(k)} (${key})`}>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={toolLabel(k)}
            aria-pressed={tool === k}
            onClick={() => onTool(k)}
            className={cn(tool === k && "bg-brand-weak text-brand")}
          >
            {icon}
          </Button>
        </Tip>
      ))}

      <span className="mx-1 h-4 w-px bg-line" aria-hidden />

      {(
        [
          ["LONG", <SquareArrowUp key="l" />, t("tools.longTool"), "⇧B"],
          ["SHORT", <SquareArrowDown key="s" />, t("tools.shortTool"), "⇧S"],
        ] as const
      ).map(([side, icon, label, key]) => (
        <Tip key={side} label={`${label} (${key})`}>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={label}
            aria-pressed={positionSide === side}
            disabled={positionDisabled}
            onClick={() => onPositionSide(positionSide === side ? null : side)}
            className={cn(
              positionSide === side && (side === "LONG" ? "bg-profit-weak text-profit" : "bg-loss-weak text-loss"),
            )}
          >
            {icon}
          </Button>
        </Tip>
      ))}

      <span className="mx-1 h-4 w-px bg-line" aria-hidden />

      <Tip label={`${t("tools.undo")} (${mod}Z)`}>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={t("tools.undo")}
          disabled={!canUndo}
          onClick={onUndo}
        >
          <Undo2 />
        </Button>
      </Tip>
      <Tip label={`${t("tools.deleteSelected")} (Del)`}>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={t("tools.deleteSelected")}
          disabled={!hasSelection}
          onClick={onDeleteSelected}
        >
          <Eraser />
        </Button>
      </Tip>
      <Tip label={t("tools.clearAll")}>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={t("tools.clearAll")}
          disabled={!canUndo}
          onClick={onClearAll}
        >
          <Trash2 />
        </Button>
      </Tip>

      {htfOptions.length ? (
        <>
          <span className="mx-1 h-4 w-px bg-line" aria-hidden />
          <Select value={htf ?? "off"} onValueChange={(v) => onHtf(v === "off" ? null : (v as Timeframe))}>
            <SelectTrigger
              className="h-7 w-auto gap-1.5 text-xs whitespace-nowrap"
              aria-label={t("tools.htfAria")}
              title={`${t("tools.htf")} (M)`}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="off">
                {t("tools.htf")}: {t("tools.htfOff")}
              </SelectItem>
              {htfOptions.map((tf) => (
                <SelectItem key={tf} value={tf}>
                  {t("tools.htf")}: {tf}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </>
      ) : null}

      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={t("shortcutsTitle")}
        onClick={() => setHelpOpen(true)}
        className="ml-auto"
      >
        <Keyboard />
      </Button>

      <Dialog open={helpOpen} onOpenChange={setHelpOpen}>
        <DialogContent size="sm">
          <DialogHeader title={t("shortcutsTitle")} />
          <DialogBody>
            <dl className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-1.5 text-xs">
              {(
                [
                  ["Space", "playPause"],
                  ["→", "step"],
                  ["⇧ →", "step10"],
                  ["←", "back"],
                  ["+ / −", "speed"],
                  ["B", "buy"],
                  ["S", "sell"],
                  ["⇧B", "longTool"],
                  ["⇧S", "shortTool"],
                  ["C", "close"],
                  ["X", "cancel"],
                  ["V", "select"],
                  ["T · H · R · F", "drawTools"],
                  ["Esc", "escape"],
                  ["Del", "delete"],
                  [`${mod} Z`, "undo"],
                  ["M", "htf"],
                ] as const
              ).map(([keys, label]) => (
                <React.Fragment key={label}>
                  <dt>
                    <Kbd>{keys}</Kbd>
                  </dt>
                  <dd className="text-ink-2">{t(`keys.${label}`)}</dd>
                </React.Fragment>
              ))}
            </dl>
          </DialogBody>
        </DialogContent>
      </Dialog>
    </div>
  );
}
