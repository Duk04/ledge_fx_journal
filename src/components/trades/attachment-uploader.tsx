"use client";

import * as React from "react";
import { AlertTriangle, ImagePlus, Link2, Loader2, RefreshCw, Trash2, UploadCloud, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogFooter } from "@/components/ui/dialog";
import { Segmented, SegmentedItem } from "@/components/ui/segmented";
import { EmptyState } from "@/components/ui/empty";
import { useToast } from "@/components/ui/toast";
import { useOnlineStatus } from "@/components/pwa/use-online-status";
import { addExternalLink, deleteAttachment, setAttachmentKind, setCaption } from "@/lib/actions/attachments";

export interface AttachmentView {
  id: string;
  kind: "BEFORE" | "AFTER" | "OTHER";
  storageKey: string | null;
  externalUrl: string | null;
  caption: string | null;
  mimeType: string | null;
}

const ACCEPTED_TYPES = ["image/png", "image/jpeg", "image/webp", "image/avif"];
const MAX_BYTES = 8 * 1024 * 1024;
const KINDS = ["BEFORE", "AFTER", "OTHER"] as const;

type PendingUpload = {
  tempId: string;
  name: string;
  progress: number; // 0-100
  status: "uploading" | "error";
  error?: string;
  file: File;
};

function srcFor(a: Pick<AttachmentView, "id" | "storageKey" | "externalUrl">): string | null {
  if (a.storageKey) return `/api/attachments/${a.id}`;
  return a.externalUrl;
}

/** Returns a `trades.attachments` message key rather than text: this runs
 * outside a component, so the caller translates it. */
function clientValidate(file: File): "unsupportedType" | "tooLarge" | null {
  if (!ACCEPTED_TYPES.includes(file.type)) {
    return "unsupportedType";
  }
  if (file.size > MAX_BYTES) {
    return "tooLarge";
  }
  return null;
}

/**
 * Screenshot attachments for one trade: drop a file, pick one, or paste
 * (Ctrl/⌘+V) a chart screenshot straight from the clipboard — the paste
 * path matters more than the button, since it's how traders actually get a
 * chart out of MT5/TradingView and onto a trade.
 *
 * Fully self-contained: it fetches nothing on mount (the caller passes
 * `initialAttachments` from its own server-rendered data) and every mutation
 * (upload, caption, kind, delete) updates local state immediately rather
 * than waiting on a round trip through the parent's server component.
 */
export function AttachmentUploader({
  tradeId,
  initialAttachments,
}: {
  tradeId: string;
  initialAttachments: AttachmentView[];
}) {
  const t = useTranslations("trades.attachments");
  const { toast } = useToast();
  const online = useOnlineStatus();
  const [attachments, setAttachments] = React.useState(initialAttachments);
  const [uploads, setUploads] = React.useState<PendingUpload[]>([]);
  const [dragOver, setDragOver] = React.useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = React.useState<string | null>(null);
  const [linkOpen, setLinkOpen] = React.useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const containerRef = React.useRef<HTMLDivElement>(null);

  const upload = React.useCallback(
    (file: File, tempId: string = crypto.randomUUID()) => {
      const problem = clientValidate(file);
      if (problem) {
        toast({ title: t("addFailed"), description: t(problem), tone: "loss" });
        return;
      }
      if (!online) {
        toast({
          title: t("offlineTitle"),
          description: t("offlineUpload"),
          tone: "warn",
        });
        return;
      }

      setUploads((prev) => {
        const existing = prev.find((u) => u.tempId === tempId);
        if (existing)
          return prev.map((u) =>
            u.tempId === tempId ? { ...u, status: "uploading", progress: 0, error: undefined } : u,
          );
        return [...prev, { tempId, name: file.name, progress: 0, status: "uploading", file }];
      });

      const form = new FormData();
      form.set("tradeId", tradeId);
      form.set("file", file);
      form.set("kind", "OTHER");

      const xhr = new XMLHttpRequest();
      xhr.open("POST", "/api/attachments");
      xhr.upload.onprogress = (e) => {
        if (!e.lengthComputable) return;
        const pct = Math.round((e.loaded / e.total) * 100);
        setUploads((prev) => prev.map((u) => (u.tempId === tempId ? { ...u, progress: pct } : u)));
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          let row: AttachmentView | null = null;
          try {
            row = JSON.parse(xhr.responseText);
          } catch {
            /* fall through to the error path below */
          }
          if (row) {
            setAttachments((prev) => [row!, ...prev]);
            setUploads((prev) => prev.filter((u) => u.tempId !== tempId));
            toast({ title: t("added"), tone: "profit" });
            return;
          }
        }
        let message = t("uploadFailedSentence");
        try {
          message = JSON.parse(xhr.responseText)?.error ?? message;
        } catch {
          /* keep default message */
        }
        setUploads((prev) => prev.map((u) => (u.tempId === tempId ? { ...u, status: "error", error: message } : u)));
      };
      xhr.onerror = () => {
        setUploads((prev) =>
          prev.map((u) => (u.tempId === tempId ? { ...u, status: "error", error: t("networkError") } : u)),
        );
      };
      xhr.send(form);
    },
    [tradeId, toast, online, t],
  );

  // `useCallback` purely so the paste effect below can depend on it
  // honestly. It does nothing but fan out to `upload`, so its identity only
  // ever changes when `upload`'s does.
  const handleFiles = React.useCallback(
    (files: FileList | File[]) => {
      Array.from(files).forEach((file) => upload(file));
    },
    [upload],
  );

  // Paste anywhere while this component is mounted. Scoped to image data
  // specifically, so pasting text into some unrelated field on the page is
  // completely unaffected — this only ever fires for an actual image.
  React.useEffect(() => {
    function onPaste(e: ClipboardEvent) {
      const items = e.clipboardData?.items;
      if (!items) return;
      const imageFiles: File[] = [];
      for (const item of items) {
        if (item.kind === "file" && item.type.startsWith("image/")) {
          const file = item.getAsFile();
          if (file) imageFiles.push(file);
        }
      }
      if (imageFiles.length) {
        e.preventDefault();
        handleFiles(imageFiles);
      }
    }
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [handleFiles]);

  function retry(pending: PendingUpload) {
    upload(pending.file, pending.tempId);
  }

  function dismissFailed(tempId: string) {
    setUploads((prev) => prev.filter((u) => u.tempId !== tempId));
  }

  async function onDeleteConfirmed() {
    if (!confirmDeleteId) return;
    const id = confirmDeleteId;
    setConfirmDeleteId(null);
    const prevList = attachments;
    setAttachments((prev) => prev.filter((a) => a.id !== id));
    const result = await deleteAttachment(id);
    if (!result.ok) {
      setAttachments(prevList);
      toast({ title: t("deleteFailed"), description: result.formError, tone: "loss" });
    } else {
      toast({ title: t("deleted") });
    }
  }

  async function onKindChange(id: string, kind: (typeof KINDS)[number]) {
    setAttachments((prev) => prev.map((a) => (a.id === id ? { ...a, kind } : a)));
    const result = await setAttachmentKind(id, kind);
    if (!result.ok) {
      toast({ title: t("updateFailed"), description: result.formError, tone: "loss" });
    }
  }

  async function onCaptionBlur(id: string, value: string) {
    const original = attachments.find((a) => a.id === id)?.caption ?? "";
    if (value === original) return;
    const result = await setCaption(id, value.trim() ? value.trim() : null);
    if (!result.ok) {
      toast({ title: t("captionFailed"), description: result.formError, tone: "loss" });
    }
  }

  async function onAddLink(formData: FormData) {
    const url = String(formData.get("url") ?? "");
    const result = await addExternalLink(tradeId, url, "OTHER");
    if (!result.ok) {
      toast({
        title: t("linkFailed"),
        description: result.formError ?? result.fieldErrors?.url?.[0],
        tone: "loss",
      });
      return;
    }
    setAttachments((prev) => [
      { id: result.id!, kind: "OTHER", storageKey: null, externalUrl: url, caption: null, mimeType: null },
      ...prev,
    ]);
    setLinkOpen(false);
    toast({ title: t("linkAdded"), tone: "profit" });
  }

  const isEmpty = attachments.length === 0 && uploads.length === 0;

  return (
    <div ref={containerRef} className="flex flex-col gap-3">
      {!online ? (
        <div className="flex items-center gap-2 rounded-control border border-warn/30 bg-warn-weak px-2.5 py-1.5 text-xs text-warn">
          <AlertTriangle className="size-3.5 shrink-0" />
          {t("offlineBanner")}
        </div>
      ) : null}

      {/* ------------------------------------------------------- drop zone */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => fileInputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") fileInputRef.current?.click();
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files);
        }}
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-[var(--radius-panel)] border border-dashed px-4 py-6 text-center transition-colors",
          dragOver
            ? "border-brand bg-brand-weak"
            : "border-line-strong bg-panel-sunken hover:border-line-strong hover:bg-hover",
        )}
      >
        <UploadCloud className="size-5 text-ink-3" aria-hidden />
        <p className="text-xs text-ink-2">
          {t.rich("dropzone", { upload: (chunks) => <span className="font-medium text-ink">{chunks}</span> })}
        </p>
        <p className="text-2xs text-ink-3">{t("dropzoneHint")}</p>
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPTED_TYPES.join(",")}
          multiple
          className="sr-only"
          onChange={(e) => {
            if (e.target.files?.length) handleFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      <div className="flex items-center justify-between">
        <span className="label">{t("screenshots")}</span>
        <Button type="button" variant="ghost" size="sm" onClick={() => setLinkOpen(true)}>
          <Link2 /> {t("addLinkInstead")}
        </Button>
      </div>

      {isEmpty ? (
        <EmptyState
          icon={<ImagePlus className="size-4" />}
          title={t("emptyTitle")}
          description={t("emptyDescription")}
        />
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {uploads.map((u) => (
            <div
              key={u.tempId}
              className="relative flex aspect-video flex-col items-center justify-center gap-1.5 overflow-hidden rounded-control border border-line bg-panel-sunken px-2 text-center"
            >
              {u.status === "uploading" ? (
                <>
                  <Loader2 className="size-4 animate-spin text-ink-3" aria-hidden />
                  <span className="max-w-full truncate text-2xs text-ink-3">{u.name}</span>
                  <div className="h-1 w-3/4 overflow-hidden rounded-full bg-inset">
                    <div className="h-full bg-brand transition-[width]" style={{ width: `${u.progress}%` }} />
                  </div>
                </>
              ) : (
                <>
                  <AlertTriangle className="size-4 text-loss" aria-hidden />
                  <span className="max-w-full truncate text-2xs text-loss">{u.error ?? t("uploadFailed")}</span>
                  <div className="flex items-center gap-1">
                    <Button type="button" variant="default" size="sm" onClick={() => retry(u)}>
                      <RefreshCw /> {t("retry")}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t("dismiss")}
                      onClick={() => dismissFailed(u.tempId)}
                    >
                      <X />
                    </Button>
                  </div>
                </>
              )}
            </div>
          ))}

          {attachments.map((a) => (
            <AttachmentTile
              key={a.id}
              attachment={a}
              onKindChange={(kind) => onKindChange(a.id, kind)}
              onCaptionBlur={(value) => onCaptionBlur(a.id, value)}
              onDelete={() => setConfirmDeleteId(a.id)}
            />
          ))}
        </div>
      )}

      {/* ------------------------------------------------------- delete confirm */}
      <Dialog open={confirmDeleteId !== null} onOpenChange={(v) => !v && setConfirmDeleteId(null)}>
        <DialogContent size="sm">
          <DialogHeader title={t("deleteTitle")} description={t("deleteDescription")} />
          <DialogFooter>
            <Button variant="default" size="sm" onClick={() => setConfirmDeleteId(null)}>
              {t("cancel")}
            </Button>
            <Button variant="danger" size="sm" onClick={onDeleteConfirmed}>
              <Trash2 /> {t("delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ------------------------------------------------------- external link */}
      <Dialog open={linkOpen} onOpenChange={setLinkOpen}>
        <DialogContent size="sm">
          <DialogHeader title={t("linkTitle")} description={t("linkDescription")} />
          <form action={onAddLink}>
            <div className="flex flex-col gap-3 p-4">
              <Input name="url" type="url" placeholder="https://..." required autoFocus />
            </div>
            <DialogFooter>
              <Button type="button" variant="default" size="sm" onClick={() => setLinkOpen(false)}>
                {t("cancel")}
              </Button>
              <Button type="submit" variant="primary" size="sm">
                {t("add")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function AttachmentTile({
  attachment,
  onKindChange,
  onCaptionBlur,
  onDelete,
}: {
  attachment: AttachmentView;
  onKindChange: (kind: (typeof KINDS)[number]) => void;
  onCaptionBlur: (value: string) => void;
  onDelete: () => void;
}) {
  const t = useTranslations("trades.attachments");
  const [open, setOpen] = React.useState(false);
  const [caption, setCaptionValue] = React.useState(attachment.caption ?? "");
  const src = srcFor(attachment);

  return (
    <div className="flex flex-col gap-1.5">
      <div className="group relative aspect-video overflow-hidden rounded-control border border-line bg-panel-sunken">
        {src ? (
          <button type="button" className="block size-full cursor-zoom-in" onClick={() => setOpen(true)}>
            {/* eslint-disable-next-line @next/next/no-img-element -- attachment bytes come from our own authenticated route or an arbitrary https URL, neither of which next/image can optimise */}
            <img
              src={src}
              alt={attachment.caption ?? t("alt")}
              className="size-full object-cover transition-transform group-hover:scale-[1.02]"
            />
          </button>
        ) : (
          <div className="grid size-full place-items-center text-ink-3">
            <ImagePlus className="size-5" />
          </div>
        )}

        <Badge tone={attachment.kind === "AFTER" ? "profit" : "neutral"} className="absolute top-1.5 left-1.5">
          {t(`kindBadge.${attachment.kind}`)}
        </Badge>
        <button
          type="button"
          onClick={onDelete}
          aria-label={t("deleteAria")}
          className="absolute top-1.5 right-1.5 grid size-6 place-items-center rounded-inner bg-panel/90 text-ink-3 opacity-0 backdrop-blur-sm transition-opacity group-hover:opacity-100 hover:text-loss"
        >
          <Trash2 className="size-3.5" />
        </button>
      </div>

      <Segmented
        value={attachment.kind}
        onValueChange={(v) => v && onKindChange(v as (typeof KINDS)[number])}
        aria-label={t("kindAria")}
      >
        {KINDS.map((k) => (
          <SegmentedItem key={k} value={k} className="flex-1 text-2xs">
            {t(`kind.${k}`)}
          </SegmentedItem>
        ))}
      </Segmented>

      <Input
        defaultValue={caption}
        placeholder={t("captionPlaceholder")}
        className="h-7 text-xs"
        onChange={(e) => setCaptionValue(e.target.value)}
        onBlur={(e) => onCaptionBlur(e.target.value)}
      />

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent size="lg" className="max-h-[90vh]">
          {src ? (
            // eslint-disable-next-line @next/next/no-img-element -- a full-size lightbox of an attachment whose dimensions are unknown until it loads, served from our own authenticated route or an arbitrary https URL. next/image can optimise neither.
            <img src={src} alt={attachment.caption ?? t("alt")} className="max-h-[85vh] w-full object-contain" />
          ) : null}
          {caption ? (
            <p className="border-t border-line bg-panel-sunken px-4 py-2 text-xs text-ink-2">{caption}</p>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
