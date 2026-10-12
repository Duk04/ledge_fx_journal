"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
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
  const t = useTranslations("playbooks");
  const [editing, setEditing] = React.useState<PlaybookView | "new" | null>(null);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <Button variant="primary" onClick={() => setEditing("new")}>
          <Plus aria-hidden /> {t("newPlaybook")}
        </Button>
      </div>

      {playbooks.length === 0 ? (
        <Panel>
          <PanelBody>
            <EmptyState title={t("emptyTitle")} description={t("emptyDescription")} />
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
  const t = useTranslations("playbooks.card");
  const router = useRouter();
  const { toast } = useToast();
  const money = (n: number) => formatMoney(n, currency);
  const pct = (n: number | null) => (n === null ? "—" : formatPercent(n));
  const r = (n: number | null) => (n === null ? "—" : formatR(n));

  async function toggleArchive() {
    const res = await setPlaybookArchived(p.id, !p.isArchived);
    if (!res.ok) toast({ title: t("updateFailed"), description: res.formError, tone: "loss" });
    router.refresh();
  }

  const groups = [
    { label: t("groupAll"), s: p.all },
    { label: t("groupByTheBook"), s: p.byTheBook },
    { label: t("groupBrokeARule"), s: p.brokeARule },
  ];

  return (
    <Panel className={cn(p.isArchived && "opacity-70")}>
      <PanelHeader
        title={p.name}
        caption={
          p.isArchived
            ? t("archived")
            : p.compliance === null
              ? t("noChecklists")
              : t("compliance", { pct: pct(p.compliance) })
        }
        actions={
          <>
            <Button variant="ghost" size="sm" onClick={onEdit}>
              <Pencil aria-hidden /> {t("edit")}
            </Button>
            <Button variant="ghost" size="sm" onClick={toggleArchive}>
              {p.isArchived ? <ArchiveRestore aria-hidden /> : <Archive aria-hidden />}
              {p.isArchived ? t("restore") : t("archive")}
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
            <p className="text-xs text-ink-3">{t("noRules")}</p>
          )}
        </PanelBody>
        <div className="border-t border-line lg:border-t-0 lg:border-l">
          <DataTable>
            <thead>
              <tr>
                <Th aria-label={t("group")} />
                <Th numeric>{t("trades")}</Th>
                <Th numeric>{t("netPnl")}</Th>
                <Th numeric>{t("winRate")}</Th>
                <Th numeric>{t("expectancy")}</Th>
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
                <Badge tone="profit">{t("rulesPay")}</Badge>
              ) : (
                <Badge tone="warn">{t("rulesNotPaying")}</Badge>
              )}
            </p>
          ) : null}
        </div>
      </div>
    </Panel>
  );
}

function PlaybookDialog({ playbook, onClose }: { playbook: PlaybookView | null; onClose: () => void }) {
  const t = useTranslations("playbooks.dialog");
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
      if (res.formError) toast({ title: t("saveFailed"), description: res.formError, tone: "loss" });
      return;
    }
    toast({ title: playbook ? t("saved") : t("created") });
    onClose();
    router.refresh();
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <form onSubmit={submit}>
          <DialogHeader title={playbook ? t("editTitle") : t("newTitle")} />
          <DialogBody className="flex flex-col gap-3">
            <Field>
              <FieldLabel>{t("name")}</FieldLabel>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("namePlaceholder")} />
              <FieldError>{errors.name?.[0]}</FieldError>
            </Field>
            <Field>
              <FieldLabel optional>{t("description")}</FieldLabel>
              <Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
            </Field>
            <Field>
              <FieldLabel>{t("rules")}</FieldLabel>
              <Textarea
                rows={6}
                value={rules}
                onChange={(e) => setRules(e.target.value)}
                placeholder={t("rulesPlaceholder")}
              />
              <FieldHint>{t("rulesHint")}</FieldHint>
              <FieldError>{errors.rules?.[0]}</FieldError>
            </Field>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              {t("cancel")}
            </Button>
            <Button type="submit" variant="primary" disabled={pending}>
              {pending ? t("saving") : playbook ? t("save") : t("create")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
