"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Archive, ArchiveRestore, Pencil, Plus } from "lucide-react";
import {
  Badge,
  Button,
  DataTable,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  EmptyState,
  Field,
  FieldError,
  FieldHint,
  FieldLabel,
  Input,
  Panel,
  PanelBody,
  PanelHeader,
  Td,
  Textarea,
  Th,
  useToast,
} from "@/components/ui";
import { cn } from "@/lib/cn";
import { formatMoney, formatPercent, formatR } from "@/lib/metrics/formatters";
import { createPlaybook, setPlaybookArchived, updatePlaybook } from "@/lib/actions/playbooks";
import type { PlaybookView } from "@/lib/queries/playbooks";

export function PlaybooksView({ playbooks, currency }: { playbooks: PlaybookView[]; currency: string }) {
  const [editing, setEditing] = React.useState<PlaybookView | "new" | null>(null);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <Button variant="primary" onClick={() => setEditing("new")}>
          <Plus aria-hidden /> New playbook
        </Button>
      </div>

      {playbooks.length === 0 ? (
        <Panel>
          <PanelBody>
            <EmptyState
              title="No playbooks yet"
              description="Write down a setup you trade and the rules that make a trade one of them. Then check each trade against it, and see whether following the rules actually pays."
            />
          </PanelBody>
        </Panel>
      ) : (
        playbooks.map((p) => <PlaybookCard key={p.id} playbook={p} currency={currency} onEdit={() => setEditing(p)} />)
      )}

      {editing ? (
        <PlaybookDialog playbook={editing === "new" ? null : editing} onClose={() => setEditing(null)} />
      ) : null}
    </div>
  );
}

function PlaybookCard({
  playbook: p,
  currency,
  onEdit,
}: {
  playbook: PlaybookView;
  currency: string;
  onEdit: () => void;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const money = (n: number) => formatMoney(n, currency);
  const pct = (n: number | null) => (n === null ? "—" : formatPercent(n));
  const r = (n: number | null) => (n === null ? "—" : formatR(n));

  async function toggleArchive() {
    const res = await setPlaybookArchived(p.id, !p.isArchived);
    if (!res.ok) toast({ title: "Couldn't update it", description: res.formError, tone: "loss" });
    router.refresh();
  }

  const groups = [
    { label: "All trades", s: p.all },
    { label: "By the book", s: p.byTheBook },
    { label: "Broke a rule", s: p.brokeARule },
  ];

  return (
    <Panel className={cn(p.isArchived && "opacity-70")}>
      <PanelHeader
        title={p.name}
        caption={
          p.isArchived
            ? "archived"
            : p.compliance === null
              ? "no checklists yet"
              : `${pct(p.compliance)} of rules followed`
        }
        actions={
          <>
            <Button variant="ghost" size="sm" onClick={onEdit}>
              <Pencil aria-hidden /> Edit
            </Button>
            <Button variant="ghost" size="sm" onClick={toggleArchive}>
              {p.isArchived ? <ArchiveRestore aria-hidden /> : <Archive aria-hidden />}
              {p.isArchived ? "Restore" : "Archive"}
            </Button>
          </>
        }
      />
      <div className="grid lg:grid-cols-2">
        <PanelBody className="flex flex-col gap-2">
          {p.description ? <p className="text-sm text-ink-2">{p.description}</p> : null}
          {p.rules.length ? (
            <ol className="flex flex-col gap-1.5">
              {p.rules.map((rule, i) => (
                <li key={rule.id} className="flex items-baseline justify-between gap-3 text-sm">
                  <span>
                    <span className="mono mr-2 text-ink-3">{i + 1}.</span>
                    {rule.text}
                  </span>
                  <span className="mono shrink-0 text-xs text-ink-3">
                    {rule.answered ? `${rule.followed}/${rule.answered}` : "—"}
                  </span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-xs text-ink-3">No rules written down yet.</p>
          )}
        </PanelBody>
        <div className="border-t border-line lg:border-t-0 lg:border-l">
          <DataTable>
            <thead>
              <tr>
                <Th aria-label="Group" />
                <Th numeric>Trades</Th>
                <Th numeric>Net P&amp;L</Th>
                <Th numeric>Win rate</Th>
                <Th numeric>Expectancy</Th>
              </tr>
            </thead>
            <tbody>
              {groups.map(({ label, s }) => (
                <tr key={label}>
                  <Td className="text-xs">{label}</Td>
                  <Td numeric className="mono text-xs">
                    {s.closedCount}
                  </Td>
                  <Td numeric className={cn("mono text-xs", s.netPnl > 0 ? "val-pos" : s.netPnl < 0 ? "val-neg" : "")}>
                    {money(s.netPnl)}
                  </Td>
                  <Td numeric className="mono text-xs">
                    {pct(s.winRate)}
                  </Td>
                  <Td numeric className="mono text-xs">
                    {r(s.expectancyR)}
                  </Td>
                </tr>
              ))}
            </tbody>
          </DataTable>
          {p.byTheBook.closedCount && p.brokeARule.closedCount ? (
            <p className="px-3 py-2 text-2xs text-ink-3">
              {(p.byTheBook.expectancyR ?? 0) > (p.brokeARule.expectancyR ?? 0) ? (
                <Badge tone="profit">Following the rules pays</Badge>
              ) : (
                <Badge tone="warn">Following the rules isn&rsquo;t paying — revisit them</Badge>
              )}
            </p>
          ) : null}
        </div>
      </div>
    </Panel>
  );
}

function PlaybookDialog({ playbook, onClose }: { playbook: PlaybookView | null; onClose: () => void }) {
  const router = useRouter();
  const { toast } = useToast();
  const [name, setName] = React.useState(playbook?.name ?? "");
  const [description, setDescription] = React.useState(playbook?.description ?? "");
  const [rules, setRules] = React.useState(playbook?.rules.map((r) => r.text).join("\n") ?? "");
  const [errors, setErrors] = React.useState<Record<string, string[]>>({});
  const [pending, setPending] = React.useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    const input = { name, description, rules: rules.split("\n") };
    const res = playbook ? await updatePlaybook(playbook.id, input) : await createPlaybook(input);
    setPending(false);
    if (!res.ok) {
      setErrors(res.fieldErrors ?? {});
      if (res.formError) toast({ title: "Couldn't save", description: res.formError, tone: "loss" });
      return;
    }
    toast({ title: playbook ? "Playbook saved" : "Playbook created" });
    onClose();
    router.refresh();
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <form onSubmit={submit}>
          <DialogHeader title={playbook ? "Edit playbook" : "New playbook"} />
          <DialogBody className="flex flex-col gap-3">
            <Field>
              <FieldLabel>Name</FieldLabel>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="London breakout" />
              <FieldError>{errors.name?.[0]}</FieldError>
            </Field>
            <Field>
              <FieldLabel optional>Description</FieldLabel>
              <Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
            </Field>
            <Field>
              <FieldLabel>Rules</FieldLabel>
              <Textarea
                rows={6}
                value={rules}
                onChange={(e) => setRules(e.target.value)}
                placeholder={"H4 trend agrees with the entry\nRetest of the Asian range high\nRisk ≤ 1%"}
              />
              <FieldHint>
                One per line. Rewording a rule makes it a new rule; reordering keeps each rule&rsquo;s history.
              </FieldHint>
              <FieldError>{errors.rules?.[0]}</FieldError>
            </Field>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={pending}>
              {pending ? "Saving…" : playbook ? "Save" : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
