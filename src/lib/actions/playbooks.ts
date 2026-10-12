"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { diffRules } from "@/lib/playbook-stats";
import { accountOrFailure } from "./guard";
import { fail, failFields, ok, type ActionResult } from "./result";

/**
 * Playbooks and per-trade checklists. docs/PLAYBOOKS.md.
 * Every playbook query is scoped by userId; a trade is reached through an
 * account the user owns (accountOrFailure), and a playbook or rule attached to
 * it must belong to the same user.
 */

const playbookSchema = z.object({
  name: z.string().trim().min(1, "Give it a name.").max(80, "Keep it under 80 characters."),
  description: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    z.string().trim().max(2000).optional(),
  ),
  rules: z.array(z.string().max(300, "Keep each rule under 300 characters.")).max(30, "30 rules at most."),
});

export type PlaybookInput = z.input<typeof playbookSchema>;

function revalidate() {
  revalidatePath("/playbooks");
  revalidatePath("/trades");
}

function duplicateName(err: unknown) {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

export async function createPlaybook(input: PlaybookInput): Promise<ActionResult<{ id: string }>> {
  const user = await requireUser();
  const parsed = playbookSchema.safeParse(input);
  if (!parsed.success) return failFields(parsed.error.flatten().fieldErrors as Record<string, string[]>);
  try {
    const created = await prisma.playbook.create({
      data: {
        userId: user.id,
        name: parsed.data.name,
        description: parsed.data.description ?? null,
        rules: {
          create: diffRules([], parsed.data.rules).create.map((r) => ({ text: r.text, sortOrder: r.sortOrder })),
        },
      },
    });
    revalidate();
    return ok({ id: created.id });
  } catch (err) {
    if (duplicateName(err)) return failFields({ name: ["You already have a playbook with that name."] });
    throw err;
  }
}

export async function updatePlaybook(id: string, input: PlaybookInput): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = playbookSchema.safeParse(input);
  if (!parsed.success) return failFields(parsed.error.flatten().fieldErrors as Record<string, string[]>);
  const existing = await prisma.playbook.findFirst({ where: { id, userId: user.id }, include: { rules: true } });
  if (!existing) return fail("That playbook was not found.");

  const diff = diffRules(existing.rules, parsed.data.rules);
  try {
    await prisma.$transaction([
      prisma.playbook.update({
        where: { id },
        data: { name: parsed.data.name, description: parsed.data.description ?? null },
      }),
      prisma.playbookRule.deleteMany({ where: { playbookId: id, id: { in: diff.remove } } }),
      ...diff.keep.map((k) => prisma.playbookRule.update({ where: { id: k.id }, data: { sortOrder: k.sortOrder } })),
      prisma.playbookRule.createMany({ data: diff.create.map((c) => ({ ...c, playbookId: id })) }),
    ]);
  } catch (err) {
    if (duplicateName(err)) return failFields({ name: ["You already have a playbook with that name."] });
    throw err;
  }
  revalidate();
  return ok();
}

export async function setPlaybookArchived(id: string, archived: boolean): Promise<ActionResult> {
  const user = await requireUser();
  const updated = await prisma.playbook.updateMany({ where: { id, userId: user.id }, data: { isArchived: archived } });
  if (updated.count === 0) return fail("That playbook was not found.");
  revalidate();
  return ok();
}

/** Attach a trade to a playbook (or detach with null). Checks against rules
 * of a different playbook no longer apply and are removed. */
export async function setTradePlaybook(
  accountId: string,
  tradeId: string,
  playbookId: string | null,
): Promise<ActionResult> {
  const user = await requireUser();
  const found = await accountOrFailure(accountId);
  if ("failure" in found) return found.failure;
  const trade = await prisma.trade.findFirst({ where: { id: tradeId, accountId: found.account.id } });
  if (!trade) return fail("Trade not found.");
  if (playbookId) {
    const pb = await prisma.playbook.findFirst({ where: { id: playbookId, userId: user.id } });
    if (!pb) return fail("That playbook was not found.");
  }
  await prisma.$transaction([
    prisma.trade.update({ where: { id: trade.id }, data: { playbookId } }),
    prisma.tradeRuleCheck.deleteMany({
      where: { tradeId: trade.id, ...(playbookId ? { rule: { playbookId: { not: playbookId } } } : {}) },
    }),
  ]);
  revalidatePath(`/trades/${trade.id}`);
  revalidate();
  return ok();
}

/** Record whether one rule was followed on one trade; null clears it. */
export async function setRuleCheck(
  accountId: string,
  tradeId: string,
  ruleId: string,
  followed: boolean | null,
): Promise<ActionResult> {
  const found = await accountOrFailure(accountId);
  if ("failure" in found) return found.failure;
  const trade = await prisma.trade.findFirst({ where: { id: tradeId, accountId: found.account.id } });
  if (!trade?.playbookId) return fail("Pick a playbook for this trade first.");
  const rule = await prisma.playbookRule.findFirst({ where: { id: ruleId, playbookId: trade.playbookId } });
  if (!rule) return fail("That rule isn't part of this trade's playbook.");

  if (followed === null) {
    await prisma.tradeRuleCheck.deleteMany({ where: { tradeId, ruleId } });
  } else {
    await prisma.tradeRuleCheck.upsert({
      where: { tradeId_ruleId: { tradeId, ruleId } },
      create: { tradeId, ruleId, followed },
      update: { followed },
    });
  }
  revalidatePath(`/trades/${tradeId}`);
  revalidatePath("/playbooks");
  return ok();
}
