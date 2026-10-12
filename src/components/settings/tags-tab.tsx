"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { ChevronUp, ChevronDown, Pencil, Trash2, Plus } from "lucide-react";
import {
  Panel,
  PanelHeader,
  PanelBody,
  Badge,
  Button,
  Input,
  useToast,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
} from "@/components/ui";
import { ColorSwatchPicker, TAG_SWATCHES } from "./color-swatch-picker";
import { createTag, updateTag, reorderTag, deleteTag } from "@/lib/actions/tags";
import type { TagRow, TagsGrouped } from "@/lib/queries/settings";

export function TagsTab({ initialTags }: { initialTags: TagsGrouped }) {
  const tr = useTranslations("settings.tags");
  return (
    <div className="flex flex-col gap-4">
      <TagGroup kind="SETUP" title={tr("setup")} tags={initialTags.setup} />
      <TagGroup kind="MISTAKE" title={tr("mistake")} tags={initialTags.mistake} />
    </div>
  );
}

function TagGroup({ kind, title, tags }: { kind: "SETUP" | "MISTAKE"; title: string; tags: TagRow[] }) {
  const tr = useTranslations("settings.tags");
  const [adding, setAdding] = React.useState(false);

  return (
    <Panel>
      <PanelHeader
        title={title}
        caption={tr("count", { count: tags.length })}
        actions={
          <Button variant="default" size="sm" onClick={() => setAdding((v) => !v)}>
            <Plus /> {tr("newTag")}
          </Button>
        }
      />
      <PanelBody padded={false}>
        {adding ? <NewTagForm kind={kind} onDone={() => setAdding(false)} /> : null}
        {tags.length === 0 && !adding ? (
          <p className="px-3 py-6 text-center text-xs text-ink-3">{tr("none")}</p>
        ) : (
          <ul className="divide-y divide-line-faint">
            {tags.map((t, i) => (
              <TagRowItem key={t.id} tag={t} isFirst={i === 0} isLast={i === tags.length - 1} />
            ))}
          </ul>
        )}
      </PanelBody>
    </Panel>
  );
}

function NewTagForm({ kind, onDone }: { kind: "SETUP" | "MISTAKE"; onDone: () => void }) {
  const tr = useTranslations("settings.tags");
  const [name, setName] = React.useState("");
  const [color, setColor] = React.useState(TAG_SWATCHES[0]);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);
  const { toast } = useToast();

  async function submit() {
    setPending(true);
    setError(null);
    const result = await createTag({ name, kind, color });
    setPending(false);
    if (result.ok) {
      toast({ title: tr("created") });
      setName("");
      setColor(TAG_SWATCHES[0]);
      onDone();
    } else {
      setError(result.formError ?? Object.values(result.fieldErrors ?? {})[0]?.[0] ?? tr("couldNotCreate"));
    }
  }

  return (
    <div className="flex flex-col gap-2 border-b border-line px-3 py-3">
      <div className="flex items-center gap-2">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={tr("namePlaceholder")}
          className="max-w-56"
          autoFocus
        />
        <Button size="sm" variant="primary" onClick={submit} disabled={pending || !name.trim()}>
          {tr("add")}
        </Button>
        <Button size="sm" variant="ghost" onClick={onDone}>
          {tr("cancel")}
        </Button>
      </div>
      <ColorSwatchPicker value={color} onChange={setColor} error={error ?? undefined} />
    </div>
  );
}

function TagRowItem({ tag, isFirst, isLast }: { tag: TagRow; isFirst: boolean; isLast: boolean }) {
  const tr = useTranslations("settings.tags");
  const [editing, setEditing] = React.useState(false);
  const [name, setName] = React.useState(tag.name);
  const [color, setColor] = React.useState(tag.color);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = React.useState(false);
  const { toast } = useToast();

  async function saveEdit() {
    setPending(true);
    setError(null);
    const result = await updateTag(tag.id, { name, color });
    setPending(false);
    if (result.ok) {
      toast({ title: tr("updated") });
      setEditing(false);
    } else {
      setError(result.formError ?? Object.values(result.fieldErrors ?? {})[0]?.[0] ?? tr("couldNotSave"));
    }
  }

  async function move(direction: "up" | "down") {
    await reorderTag(tag.id, direction);
  }

  async function confirmDelete() {
    setPending(true);
    const result = await deleteTag(tag.id);
    setPending(false);
    if (result.ok) {
      toast({ title: tr("deleted") });
      setDeleteOpen(false);
    } else {
      toast({ title: tr("couldNotDelete"), description: result.formError, tone: "loss" });
    }
  }

  if (editing) {
    return (
      <li className="flex flex-col gap-2 px-3 py-3">
        <div className="flex items-center gap-2">
          <Input value={name} onChange={(e) => setName(e.target.value)} className="max-w-56" autoFocus />
          <Button size="sm" variant="default" onClick={saveEdit} disabled={pending || !name.trim()}>
            {tr("save")}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setEditing(false);
              setName(tag.name);
              setColor(tag.color);
              setError(null);
            }}
          >
            {tr("cancel")}
          </Button>
        </div>
        <ColorSwatchPicker value={color} onChange={setColor} error={error ?? undefined} />
      </li>
    );
  }

  return (
    <li className="flex items-center gap-3 px-3 py-2">
      <span aria-hidden className="size-3 shrink-0 rounded-full" style={{ background: tag.color }} />
      <span className="min-w-0 flex-1 truncate text-sm text-ink">{tag.name}</span>
      <Badge tone="neutral">
        {tag.tradeCount} trade{tag.tradeCount === 1 ? "" : "s"}
      </Badge>
      <div className="flex shrink-0 items-center gap-0.5">
        <Button variant="ghost" size="icon-sm" aria-label={tr("moveUp")} disabled={isFirst} onClick={() => move("up")}>
          <ChevronUp />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={tr("moveDown")}
          disabled={isLast}
          onClick={() => move("down")}
        >
          <ChevronDown />
        </Button>
        <Button variant="ghost" size="icon-sm" aria-label={tr("edit")} onClick={() => setEditing(true)}>
          <Pencil />
        </Button>
        <Button variant="ghost" size="icon-sm" aria-label={tr("delete")} onClick={() => setDeleteOpen(true)}>
          <Trash2 className="text-loss" />
        </Button>
      </div>

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent size="sm">
          <DialogHeader
            title={tr("deleteTitle")}
            description={
              tag.tradeCount > 0
                ? tr("deleteUsed", { name: tag.name, count: tag.tradeCount })
                : tr("deleteUnused", { name: tag.name })
            }
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleteOpen(false)}>
              {tr("cancel")}
            </Button>
            <Button variant="danger" onClick={confirmDelete} disabled={pending}>
              {tr("deleteConfirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </li>
  );
}
