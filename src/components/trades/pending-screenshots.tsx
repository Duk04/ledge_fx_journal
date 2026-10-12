"use client";

import * as React from "react";
import { UploadCloud, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/cn";
import { Segmented, SegmentedItem } from "@/components/ui/segmented";
import { useToast } from "@/components/ui/toast";
import {
  ACCEPTED_IMAGE_TYPES,
  ATTACHMENT_KINDS,
  imagesFromClipboard,
  validateImageFile,
  type AttachmentKindName,
} from "./attachment-files";

export interface PendingScreenshot {
  id: string;
  file: File;
  kind: AttachmentKindName;
  /** An object URL for the thumbnail; revoked when the entry goes. */
  previewUrl: string;
}

/**
 * Screenshots picked on the "Log trade" form, before the trade exists.
 *
 * WHY THEY WAIT. An attachment belongs to a trade, and the upload route
 * checks that the trade is the caller's (app/api/attachments/route.ts), so
 * there is nothing to upload TO until the trade is saved. The files are held
 * here, in the browser, and the form uploads them right after createTrade
 * returns an id. Nothing touches the server if the trade never saves.
 *
 * Drop, pick, or paste (Ctrl/⌘+V) — paste is how a chart usually gets out of
 * MT5 or TradingView, so it works anywhere on the page while this is
 * mounted, and only for image data.
 */
export function PendingScreenshots({
  value,
  onChange,
  disabled,
}: {
  value: PendingScreenshot[];
  onChange: (next: PendingScreenshot[]) => void;
  disabled?: boolean;
}) {
  const t = useTranslations("trades.attachments");
  const { toast } = useToast();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = React.useState(false);

  // Latest list for the paste listener and the unmount cleanup, without
  // re-subscribing on every change.
  const latest = React.useRef(value);
  React.useEffect(() => {
    latest.current = value;
  }, [value]);

  const add = React.useCallback(
    (files: File[]) => {
      const accepted: PendingScreenshot[] = [];
      for (const file of files) {
        const problem = validateImageFile(file);
        if (problem) {
          toast({ title: t("addFailed"), description: `${file.name}: ${t(problem)}`, tone: "loss" });
          continue;
        }
        accepted.push({
          id: crypto.randomUUID(),
          file,
          // Picked while logging the trade, a chart is usually the setup.
          kind: "BEFORE",
          previewUrl: URL.createObjectURL(file),
        });
      }
      if (accepted.length) onChange([...latest.current, ...accepted]);
    },
    [onChange, toast, t],
  );

  React.useEffect(() => {
    if (disabled) return;
    function onPaste(e: ClipboardEvent) {
      const images = imagesFromClipboard(e);
      if (images.length) {
        e.preventDefault();
        add(images);
      }
    }
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [add, disabled]);

  // Object URLs hold the file's bytes until revoked.
  React.useEffect(() => () => latest.current.forEach((p) => URL.revokeObjectURL(p.previewUrl)), []);

  function remove(id: string) {
    const gone = value.find((p) => p.id === id);
    if (gone) URL.revokeObjectURL(gone.previewUrl);
    onChange(value.filter((p) => p.id !== id));
  }

  function setKind(id: string, kind: AttachmentKindName) {
    onChange(value.map((p) => (p.id === id ? { ...p, kind } : p)));
  }

  return (
    <div className="flex flex-col gap-3">
      <div
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-disabled={disabled || undefined}
        onClick={() => !disabled && inputRef.current?.click()}
        onKeyDown={(e) => {
          if (disabled) return;
          if (e.key === "Enter" || e.key === " ") {
            // Enter inside the trade form must not submit it from here.
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (!disabled && e.dataTransfer.files.length) add(Array.from(e.dataTransfer.files));
        }}
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-panel border border-dashed px-4 py-5 text-center transition-colors",
          dragOver ? "border-brand bg-brand-weak" : "border-line-strong bg-panel-sunken hover:bg-hover",
          disabled && "pointer-events-none opacity-45",
        )}
      >
        <UploadCloud className="size-5 text-ink-3" aria-hidden />
        <p className="text-xs text-ink-2">
          {t.rich("dropzone", { upload: (chunks) => <span className="font-medium text-ink">{chunks}</span> })}
        </p>
        <p className="text-2xs text-ink-3">{t("dropzoneHint")}</p>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED_IMAGE_TYPES.join(",")}
          multiple
          className="sr-only"
          aria-label={t("pickFiles")}
          data-testid="trade-screenshots-input"
          onChange={(e) => {
            if (e.target.files?.length) add(Array.from(e.target.files));
            e.target.value = "";
          }}
        />
      </div>

      {value.length ? (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3" aria-label={t("screenshots")}>
          {value.map((p) => (
            <li key={p.id} className="flex flex-col gap-1.5">
              <div className="group relative aspect-video overflow-hidden rounded-control border border-line bg-panel-sunken">
                {/* eslint-disable-next-line @next/next/no-img-element -- a local object URL of a file not yet uploaded; next/image cannot load it */}
                <img src={p.previewUrl} alt={p.file.name} className="size-full object-cover" />
                <button
                  type="button"
                  onClick={() => remove(p.id)}
                  disabled={disabled}
                  aria-label={t("removePending", { name: p.file.name })}
                  className="absolute top-1.5 right-1.5 grid size-6 place-items-center rounded-inner bg-panel/90 text-ink-3 backdrop-blur-sm hover:text-loss"
                >
                  <X className="size-3.5" />
                </button>
              </div>
              <Segmented
                value={p.kind}
                onValueChange={(v) => v && setKind(p.id, v as AttachmentKindName)}
                aria-label={t("kindAria")}
                disabled={disabled}
              >
                {ATTACHMENT_KINDS.map((k) => (
                  <SegmentedItem key={k} value={k} className="flex-1 text-2xs">
                    {t(`kind.${k}`)}
                  </SegmentedItem>
                ))}
              </Segmented>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
