"use client";

import * as React from "react";
import { ImageOff } from "lucide-react";
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

const KIND_TONE: Record<string, "neutral" | "loss" | "profit"> = {
  BEFORE: "neutral",
  AFTER: "profit",
  OTHER: "neutral",
};

/** Before/after screenshots. Click one to open it full size. There's no
 * blob-storage serving route in this app yet, so an attachment recorded
 * with only a `storageKey` (no `externalUrl`) shows as a labeled
 * placeholder rather than a broken `<img>`. */
export function ScreenshotGallery({ attachments }: { attachments: AttachmentView[] }) {
  const [openId, setOpenId] = React.useState<string | null>(null);
  const open = attachments.find((a) => a.id === openId) ?? null;

  if (attachments.length === 0) {
    return (
      <EmptyState
        icon={<ImageOff className="size-4" />}
        title="No screenshots"
        description="This trade doesn't have any before/after chart screenshots attached."
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
            onClick={() => a.externalUrl && setOpenId(a.id)}
            className={cn(
              "group relative flex aspect-video items-center justify-center overflow-hidden rounded-[var(--radius-control)] border border-line bg-panel-sunken",
              a.externalUrl && "cursor-zoom-in",
            )}
          >
            {a.externalUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- external, unknown-dimension attachment URLs
              <img
                src={a.externalUrl}
                alt={a.caption ?? `${a.kind.toLowerCase()} screenshot`}
                className="size-full object-cover transition-transform group-hover:scale-[1.02]"
              />
            ) : (
              <div className="flex flex-col items-center gap-1 text-ink-3">
                <ImageOff className="size-5" />
                <span className="text-2xs">Stored file — no preview</span>
              </div>
            )}
            <Badge tone={KIND_TONE[a.kind] ?? "neutral"} className="absolute top-1.5 left-1.5">
              {a.kind}
            </Badge>
          </button>
        ))}
      </div>

      <Dialog open={open !== null} onOpenChange={(v) => !v && setOpenId(null)}>
        <DialogContent size="lg" className="max-h-[90vh]">
          {open?.externalUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- a full-size lightbox of an attachment whose dimensions are unknown until it loads, served from our own authenticated route or an arbitrary https URL. next/image can optimise neither.
            <img src={open.externalUrl} alt={open.caption ?? "Trade screenshot"} className="max-h-[85vh] w-full object-contain" />
          ) : null}
          {open?.caption ? <p className="border-t border-line bg-panel-sunken px-4 py-2 text-xs text-ink-2">{open.caption}</p> : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
