"use client";

import * as React from "react";
import { ImageOff } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/cn";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty";

export interface AttachmentView {
  id: string;
  kind: string;
  externalUrl: string | null;
  storageKey: string | null;
  caption: string | null;
}

const KINDS = ["BEFORE", "AFTER", "OTHER"] as const;
type Kind = (typeof KINDS)[number];
// `kind` is typed as a plain string here, so a value outside the enum still
// needs something to render rather than a raw message-key path.
function isKind(kind: string): kind is Kind {
  return (KINDS as readonly string[]).includes(kind);
}

const KIND_TONE: Record<string, "neutral" | "loss" | "profit"> = {
  BEFORE: "neutral",
  AFTER: "profit",
  OTHER: "neutral",
};

/** Where an attachment's bytes come from. An upload has only a
 * `storageKey`, and is served by `GET /api/attachments/[id]`, which
 * re-checks ownership — the same rule as `attachment-uploader.tsx`. (This
 * comment used to say no serving route existed, and uploads rendered as a
 * placeholder long after one did.) */
function srcOf(a: AttachmentView): string | null {
  if (a.externalUrl) return a.externalUrl;
  if (a.storageKey) return `/api/attachments/${a.id}`;
  return null;
}

/** Before/after screenshots. Click one to open it full size. An attachment
 * with nothing to show renders a labeled placeholder rather than a broken
 * `<img>`. */
export function ScreenshotGallery({ attachments }: { attachments: AttachmentView[] }) {
  const t = useTranslations("trades.attachments");
  const [openId, setOpenId] = React.useState<string | null>(null);
  const open = attachments.find((a) => a.id === openId) ?? null;

  if (attachments.length === 0) {
    return (
      <EmptyState
        icon={<ImageOff className="size-4" />}
        title={t("galleryEmptyTitle")}
        description={t("galleryEmptyDescription")}
      />
    );
  }

  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        {attachments.map((a) => (
          <button
            key={a.id}
            type="button"
            onClick={() => srcOf(a) && setOpenId(a.id)}
            className={cn(
              "group relative flex aspect-video items-center justify-center overflow-hidden rounded-control border border-line bg-panel-sunken",
              srcOf(a) && "cursor-zoom-in",
            )}
          >
            {srcOf(a) ? (
              // eslint-disable-next-line @next/next/no-img-element -- external, unknown-dimension attachment URLs
              <img
                src={srcOf(a)!}
                alt={
                  a.caption ??
                  (isKind(a.kind) ? t(`kindAlt.${a.kind}`) : t("kindAltGeneric", { kind: a.kind.toLowerCase() }))
                }
                className="size-full object-cover transition-transform group-hover:scale-[1.02]"
              />
            ) : (
              <div className="flex flex-col items-center gap-1 text-ink-3">
                <ImageOff className="size-5" />
                <span className="text-2xs">{t("storedNoPreview")}</span>
              </div>
            )}
            <Badge tone={KIND_TONE[a.kind] ?? "neutral"} className="absolute top-1.5 left-1.5">
              {isKind(a.kind) ? t(`kindBadge.${a.kind}`) : a.kind}
            </Badge>
          </button>
        ))}
      </div>

      <Dialog open={open !== null} onOpenChange={(v) => !v && setOpenId(null)}>
        <DialogContent size="lg" className="max-h-[90vh]">
          {open && srcOf(open) ? (
            // eslint-disable-next-line @next/next/no-img-element -- a full-size lightbox of an attachment whose dimensions are unknown until it loads, served from our own authenticated route or an arbitrary https URL. next/image can optimise neither.
            <img src={srcOf(open)!} alt={open.caption ?? t("alt")} className="max-h-[85vh] w-full object-contain" />
          ) : null}
          {open?.caption ? (
            <p className="border-t border-line bg-panel-sunken px-4 py-2 text-xs text-ink-2">{open.caption}</p>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
