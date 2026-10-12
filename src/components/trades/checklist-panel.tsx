"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Panel,
  PanelBody,
  PanelHeader,
  Segmented,
  SegmentedItem,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  useToast,
} from "@/components/ui";
import { setRuleCheck, setTradePlaybook } from "@/lib/actions/playbooks";
import type { TradeDetail } from "@/lib/queries/trades";

const NONE = "__none__";

/**
 * Which setup this trade was, and whether it followed that setup's rules.
 * Unanswered is its own state — "didn't record" is not "didn't follow".
 */
export function ChecklistPanel({
  accountId,
  tradeId,
  playbook,
  options,
}: {
  accountId: string;
  tradeId: string;
  playbook: TradeDetail["playbook"];
  options: { id: string; name: string }[];
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = React.useTransition();

  const run = (fn: () => Promise<{ ok: boolean; formError?: string }>) =>
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) toast({ title: "Couldn't save that", description: res.formError, tone: "loss" });
      else router.refresh();
    });

  const answered = playbook?.rules.filter((r) => r.followed !== null).length ?? 0;
  const broken = playbook?.rules.filter((r) => r.followed === false).length ?? 0;

  return (
    <Panel>
      <PanelHeader
        title="Playbook"
        caption={
          playbook && playbook.rules.length
            ? broken
              ? `${broken} rule(s) broken`
              : answered === playbook.rules.length
                ? "by the book"
                : `${answered} of ${playbook.rules.length} answered`
            : undefined
        }
      />
      <PanelBody className="flex flex-col gap-3">
        {options.length === 0 && !playbook ? (
          <p className="text-xs text-ink-3">
            No playbooks yet.{" "}
            <Link href="/playbooks" className="text-brand hover:underline">
              Write one
            </Link>{" "}
            to check trades against its rules.
          </p>
        ) : (
          <Select
            value={playbook?.id ?? NONE}
            disabled={pending}
            onValueChange={(v) => run(() => setTradePlaybook(accountId, tradeId, v === NONE ? null : v))}
          >
            <SelectTrigger aria-label="Playbook">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>No playbook</SelectItem>
              {playbook && !options.some((o) => o.id === playbook.id) ? (
                <SelectItem value={playbook.id}>{playbook.name}</SelectItem>
              ) : null}
              {options.map((o) => (
                <SelectItem key={o.id} value={o.id}>
                  {o.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {playbook?.rules.map((rule) => (
          <div key={rule.id} className="flex items-center justify-between gap-3">
            <span className="text-sm text-ink" id={`rule-${rule.id}`}>
              {rule.text}
            </span>
            <Segmented
              aria-labelledby={`rule-${rule.id}`}
              value={rule.followed === null ? "" : rule.followed ? "yes" : "no"}
              onValueChange={(v) => run(() => setRuleCheck(accountId, tradeId, rule.id, v === "" ? null : v === "yes"))}
            >
              <SegmentedItem value="yes">Followed</SegmentedItem>
              <SegmentedItem value="no">Broke</SegmentedItem>
            </Segmented>
          </div>
        ))}
        {playbook && playbook.rules.length === 0 ? (
          <p className="text-xs text-ink-3">This playbook has no rules written down yet.</p>
        ) : null}
      </PanelBody>
    </Panel>
  );
}
