"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Camera, ChevronLeft, ChevronRight, ImagePlus } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/cn";
import {
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DirectionBadge,
  Money,
  Tip,
} from "@/components/ui";
import { formatInZone } from "@/lib/metrics/formatters";
import type { TradeListRow } from "@/lib/queries/trades";
import { AttachmentUploader, srcFor, type AttachmentView } from "./attachment-uploader";
import { TradeNotesField } from "./trade-notes-field";

/**
 * Screenshots from the trade list: a cell on each row that says how many the
 * trade has, and one dialog that opens on a row and walks the list from
 * there — paste the chart, write a line, Next. It is how a batch of imported
 * trades gets its screenshots without opening each one's page.
 *
 * `TradeShotsProvider` wraps the server-rendered table and owns the dialog;
 * the `ShotCell`s inside the table reach it through context. That keeps the
 * table a server component and — the reason there is ONE dialog rather than
 * an uploader per row — keeps a single `AttachmentUploader` on the page,
 * whose paste listener is on the document.
 *
 * Two things here are easy to get wrong:
 *
 *  - The dialog walks a SNAPSHOT of the rows taken when it opened. The list
 *    behind it can re-render mid-walk (an upload revalidates it), and under
 *    the "no screenshot" filter the trade just given one would drop out and
 *    shift every index after it.
 *
 *  - The uploader and the note field keep their own state and are remounted
 *    for each trade, so what they report is kept here, per trade, and handed
 *    back when the trade comes round again. Without that, stepping Next then
 *    Previous showed the trade as it was when the page loaded, without the
 *    screenshot added a moment ago. The note is kept twice — as typed, and as
 *    last saved — because Next can be clicked while its save is still on the
 *    way: the field must come back with the text AND know whether it landed.
 */

interface NoteState {
  /** The text as last typed and sent. */
  draft?: string;
  /** The text the server confirmed. */
  saved?: string;
}

interface ShotsContext {
  open: (tradeId: string) => void;
  /** The trade's screenshot count as this page last knew it; undefined when
   * nothing here has touched it and the server's number stands. */
  countOf: (tradeId: string) => number | undefined;
}

const Context = React.createContext<ShotsContext | null>(null);

export function TradeShotsProvider({
  rows,
  accountId,
  currency,
  timezone,
  uploadsEnabled,
  children,
}: {
  rows: TradeListRow[];
  accountId: string;
  currency: string;
  timezone: string;
  /** lib/storage.ts `uploadsAvailable()`: without it only links can be added. */
  uploadsEnabled: boolean;
  children: React.ReactNode;
}) {
  const t = useTranslations("trades.list.shots");
  const router = useRouter();
  const [queue, setQueue] = React.useState<TradeListRow[] | null>(null);
  const [index, setIndex] = React.useState(0);
  // Separate from `notes` so that saving a note does not re-render every
  // row's cell, which reads only the attachments.
  const [shots, setShots] = React.useState<Record<string, AttachmentView[]>>({});
  const [notes, setNotes] = React.useState<Record<string, NoteState>>({});
  const [uploading, setUploading] = React.useState(false);

  const context = React.useMemo<ShotsContext>(
    () => ({
      open: (tradeId) => {
        const at = rows.findIndex((r) => r.id === tradeId);
        if (at < 0) return;
        setQueue(rows);
        setIndex(at);
      },
      countOf: (tradeId) => shots[tradeId]?.length,
    }),
    [rows, shots],
  );

  function close() {
    // An upload in flight belongs to the uploader about to unmount; let it land.
    if (uploading) return;
    setQueue(null);
    // The rows behind the dialog are the server's: bring them up to date with
    // what was added here (counts, and the "no screenshot" filter's result).
    router.refresh();
  }

  const row = queue?.[index];
  const total = queue?.length ?? 0;

  return (
    <Context.Provider value={context}>
      {children}
      <Dialog open={row !== undefined} onOpenChange={(open) => !open && close()}>
        {row ? (
          <DialogContent size="lg">
            <DialogHeader
              title={t("title", { symbol: row.symbol })}
              description={
                <span className="flex flex-wrap items-center gap-2">
                  <DirectionBadge direction={row.direction} />
                  <span className="mono">{formatInZone(row.openedAt, timezone, "MMM dd, HH:mm")}</span>
                  <Money value={row.netPnl} currency={currency} signed />
                  <span>{t("position", { n: index + 1, total })}</span>
                </span>
              }
            />
            <DialogBody className="flex flex-col gap-4">
              <AttachmentUploader
                // One instance, re-keyed per trade: see the header.
                key={row.id}
                target={{ tradeId: row.id }}
                initialAttachments={shots[row.id] ?? row.attachments}
                uploadsEnabled={uploadsEnabled}
                onStateChange={(state) => {
                  setUploading(state.uploading);
                  setShots((prev) =>
                    prev[row.id] === state.attachments ? prev : { ...prev, [row.id]: state.attachments },
                  );
                }}
              />
              <TradeNotesField
                key={`notes-${row.id}`}
                accountId={accountId}
                tradeId={row.id}
                initialNotes={notes[row.id]?.draft ?? row.notes ?? ""}
                savedNotes={notes[row.id]?.saved ?? row.notes ?? ""}
                onCommit={(draft) => setNotes((prev) => ({ ...prev, [row.id]: { ...prev[row.id], draft } }))}
                onSaved={(saved) => setNotes((prev) => ({ ...prev, [row.id]: { ...prev[row.id], saved } }))}
              />
            </DialogBody>
            <DialogFooter className="justify-between">
              <div className="flex items-center gap-2">
                <Button
                  variant="default"
                  size="sm"
                  disabled={uploading || index === 0}
                  onClick={() => setIndex(index - 1)}
                >
                  <ChevronLeft aria-hidden /> {t("previous")}
                </Button>
                <Button
                  variant="default"
                  size="sm"
                  disabled={uploading || index >= total - 1}
                  onClick={() => setIndex(index + 1)}
                >
                  {t("next")} <ChevronRight aria-hidden />
                </Button>
              </div>
              <div className="flex items-center gap-2">
                <Button asChild variant="link" size="sm">
                  <Link href={`/trades/${row.id}`}>{t("openTrade")}</Link>
                </Button>
                <Button variant="primary" size="sm" disabled={uploading} onClick={close}>
                  {t("done")}
                </Button>
              </div>
            </DialogFooter>
          </DialogContent>
        ) : null}
      </Dialog>
    </Context.Provider>
  );
}

/**
 * A row's screenshot cell: a camera, and the count once there is one. Sits
 * in a `TrLink` row, whose whole area is a link — hence `relative`, which
 * lifts this above that overlay (components/ui/table.tsx).
 */
export function ShotCell({ tradeId, count }: { tradeId: string; count: number }) {
  const t = useTranslations("trades.list.shots");
  const dialog = React.useContext(Context);
  const n = dialog?.countOf(tradeId) ?? count;
  const label = t("open", { count: n });
  return (
    <Tip label={label}>
      <button
        type="button"
        aria-label={label}
        disabled={!dialog}
        onClick={() => dialog?.open(tradeId)}
        className={cn(
          "relative inline-flex h-7 items-center gap-1 rounded-control px-1.5",
          "transition-colors duration-[var(--dur-fast)] ease-[var(--ease-out)] hover:bg-hover",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand",
          // A count is information; an empty camera is only an offer, so it
          // is the fainter of the two.
          n > 0 ? "text-ink-2" : "text-ink-3",
        )}
      >
        <Camera className="size-4" aria-hidden />
        {n > 0 ? <span className="mono text-2xs">{n}</span> : null}
      </button>
    </Tip>
  );
}

/**
 * A trade's screenshots, large, for the list's Days view: the newest one
 * across the card, any others as a strip under it, each opening full size.
 *
 * These are the originals — there are no resized copies to serve instead —
 * which is why the table view shows a count and only this view, where seeing
 * the chart is the purpose, shows pictures. They load lazily, so a long page
 * of days fetches what is scrolled to.
 */
export function ShotGallery({ attachments }: { attachments: AttachmentView[] }) {
  const t = useTranslations("trades");
  const [openId, setOpenId] = React.useState<string | null>(null);
  const shown = attachments.filter((a) => srcFor(a) !== null);
  if (shown.length === 0) return null;
  const [first, ...rest] = shown;
  const open = shown.find((a) => a.id === openId);

  const image = (a: AttachmentView, className: string) => (
    <button
      key={a.id}
      type="button"
      aria-label={t("days.openShot")}
      onClick={() => setOpenId(a.id)}
      className={cn(
        "block cursor-zoom-in overflow-hidden rounded-control border border-line bg-panel-sunken",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand",
        className,
      )}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- attachment bytes come from our own authenticated route or an arbitrary https URL, neither of which next/image can optimise */}
      <img
        src={srcFor(a)!}
        alt={a.caption ?? t("attachments.alt")}
        loading="lazy"
        decoding="async"
        className="size-full object-cover"
      />
    </button>
  );

  return (
    <div className="flex flex-col gap-2">
      {image(first, "aspect-video w-full")}
      {rest.length > 0 ? (
        <div className="flex flex-wrap gap-2" aria-label={t("days.moreShots", { count: rest.length })}>
          {rest.map((a) => image(a, "aspect-video h-14"))}
        </div>
      ) : null}

      <Dialog open={open !== undefined} onOpenChange={(next) => !next && setOpenId(null)}>
        {open ? (
          <DialogContent size="lg" className="max-h-[90vh]" aria-describedby={undefined}>
            <DialogTitle className="sr-only">{open.caption ?? t("attachments.alt")}</DialogTitle>
            {/* eslint-disable-next-line @next/next/no-img-element -- a full-size view of an attachment whose dimensions are unknown until it loads, served from our own authenticated route or an arbitrary https URL. next/image can optimise neither. */}
            <img
              src={srcFor(open)!}
              alt={open.caption ?? t("attachments.alt")}
              className="max-h-[85vh] w-full object-contain"
            />
            {open.caption ? (
              <p className="border-t border-line bg-panel-sunken px-4 py-2 text-xs text-ink-2">{open.caption}</p>
            ) : null}
          </DialogContent>
        ) : null}
      </Dialog>
    </div>
  );
}

/** Where a trade's screenshot would be, in the Days view, when it has none:
 * the same dialog the camera cell opens, offered at the size of the gap. */
export function ShotPlaceholder({ tradeId }: { tradeId: string }) {
  const t = useTranslations("trades.list.shots");
  const dialog = React.useContext(Context);
  // Something added in the dialog shows here once the page behind it has
  // refreshed; until then the camera cell's count is what says so.
  if ((dialog?.countOf(tradeId) ?? 0) > 0) return null;
  return (
    <button
      type="button"
      disabled={!dialog}
      onClick={() => dialog?.open(tradeId)}
      className={cn(
        "flex h-20 w-full items-center justify-center gap-2 rounded-control border border-dashed border-line-strong",
        "bg-panel-sunken text-xs text-ink-3",
        "transition-colors duration-[var(--dur-fast)] ease-[var(--ease-out)] hover:bg-hover hover:text-ink-2",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand",
      )}
    >
      <ImagePlus className="size-4" aria-hidden />
      {t("open", { count: 0 })}
    </button>
  );
}
