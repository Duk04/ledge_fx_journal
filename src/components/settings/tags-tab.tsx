"use client";

import * as React from "react";
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
  return (
    <div className="flex flex-col gap-4">
      <TagGroup kind="SETUP" title="Setup tags" tags={initialTags.setup} />
      <TagGroup kind="MISTAKE" title="Mistake tags" tags={initialTags.mistake} />
    </div>
  );
}

function TagGroup({ kind, title, tags }: { kind: "SETUP" | "MISTAKE"; title: string; tags: TagRow[] }) {
  const [adding, setAdding] = React.useState(false);

  return (
    <Panel>
      <PanelHeader
        title={title}
        caption={`${tags.length} tag${tags.length === 1 ? "" : "s"}`}
        actions={
          <Button variant="default" size="sm" onClick={() => setAdding((v) => !v)}>
            <Plus /> New tag
          </Button>
        }
      />
      <PanelBody padded={false}>
        {adding ? <NewTagForm kind={kind} onDone={() => setAdding(false)} /> : null}
        {tags.length === 0 && !adding ? (
          <p className="px-3 py-6 text-center text-xs text-ink-3">No tags yet.</p>
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
      toast({ title: "Tag created." });
      setName("");
      setColor(TAG_SWATCHES[0]);
      onDone();
    } else {
      setError(result.formError ?? Object.values(result.fieldErrors ?? {})[0]?.[0] ?? "Could not create tag.");
    }
  }

  return (
    <div className="flex flex-col gap-2 border-b border-line px-3 py-3">
      <div className="flex items-center gap-2">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Tag name"
          className="max-w-56"
          autoFocus
        />
        <Button size="sm" variant="primary" onClick={submit} disabled={pending || !name.trim()}>
          Add
        </Button>
        <Button size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
      <ColorSwatchPicker value={color} onChange={setColor} error={error ?? undefined} />
    </div>
  );
}

function TagRowItem({ tag, isFirst, isLast }: { tag: TagRow; isFirst: boolean; isLast: boolean }) {
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
      toast({ title: "Tag updated." });
      setEditing(false);
    } else {
      setError(result.formError ?? Object.values(result.fieldErrors ?? {})[0]?.[0] ?? "Could not save.");
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
      toast({ title: "Tag deleted." });
      setDeleteOpen(false);
    } else {
      toast({ title: "Could not delete", description: result.formError, tone: "loss" });
    }
  }

  if (editing) {
    return (
      <li className="flex flex-col gap-2 px-3 py-3">
        <div className="flex items-center gap-2">
          <Input value={name} onChange={(e) => setName(e.target.value)} className="max-w-56" autoFocus />
          <Button size="sm" variant="default" onClick={saveEdit} disabled={pending || !name.trim()}>
            Save
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
            Cancel
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
        <Button variant="ghost" size="icon-sm" aria-label="Move up" disabled={isFirst} onClick={() => move("up")}>
          <ChevronUp />
        </Button>
        <Button variant="ghost" size="icon-sm" aria-label="Move down" disabled={isLast} onClick={() => move("down")}>
          <ChevronDown />
        </Button>
        <Button variant="ghost" size="icon-sm" aria-label="Edit tag" onClick={() => setEditing(true)}>
          <Pencil />
        </Button>
        <Button variant="ghost" size="icon-sm" aria-label="Delete tag" onClick={() => setDeleteOpen(true)}>
          <Trash2 className="text-loss" />
        </Button>
      </div>

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent size="sm">
          <DialogHeader
            title="Delete tag"
            description={
              tag.tradeCount > 0
                ? `"${tag.name}" is used on ${tag.tradeCount} trade${tag.tradeCount === 1 ? "" : "s"}. Deleting it removes the tag from those trades — the trades themselves are unaffected.`
                : `Delete "${tag.name}"? This cannot be undone.`
            }
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleteOpen(false)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={confirmDelete} disabled={pending}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </li>
  );
}
