/**
 * Playbooks against Postgres: rule edits keep history, ownership is checked
 * on every link, a playbook change clears answers that belonged to the old
 * one, and the stats split by-the-book from rule-breaking trades.
 */
import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { listPlaybooks } from "@/lib/queries/playbooks";
import { buildFormData, defaultFormValues } from "@/components/trades/trade-form-values";
import { signInAs } from "../../../test/db/auth";
import { createAccount, createUser, ensureInstruments } from "../../../test/db/factories";
import { createPlaybook, setRuleCheck, setTradePlaybook, updatePlaybook } from "./playbooks";
import { createTrade } from "./trades";

async function setup() {
  await ensureInstruments("EURUSD");
  const user = await createUser();
  const account = await createAccount(user.id);
  signInAs(user.id);
  const pb = await createPlaybook({ name: "Breakout", rules: ["Trend agrees", "Risk ≤ 1%"] });
  if (!pb.ok) throw new Error(pb.formError);
  return { user, account, playbookId: pb.id };
}

async function trade(accountId: string, exitPrice: string, playbookId?: string) {
  const res = await createTrade(
    accountId,
    buildFormData(
      defaultFormValues({
        entryMode: "PRICE",
        symbol: "EURUSD",
        direction: "LONG",
        status: "CLOSED",
        openedAt: "2026-03-04T10:00:00.000Z",
        closedAt: "2026-03-04T12:00:00.000Z",
        entryPrice: "1.1000",
        exitPrice,
        stopLoss: "1.0990",
        volumeLots: "1",
        playbookId: playbookId ?? "",
      }),
    ),
  );
  if (!res.ok) throw new Error(res.formError ?? JSON.stringify(res.fieldErrors));
  return res.id;
}

describe("playbooks", () => {
  it("rewording keeps unchanged rules (and their answers), drops removed ones", async () => {
    const { account, playbookId } = await setup();
    const t = await trade(account.id, "1.1020", playbookId);
    const rules = await prisma.playbookRule.findMany({ where: { playbookId }, orderBy: { sortOrder: "asc" } });
    await setRuleCheck(account.id, t, rules[0].id, true);
    await setRuleCheck(account.id, t, rules[1].id, false);

    await updatePlaybook(playbookId, { name: "Breakout", rules: ["Risk ≤ 0.5%", "Trend agrees"] });
    const after = await prisma.playbookRule.findMany({ where: { playbookId }, orderBy: { sortOrder: "asc" } });
    expect(after.map((r) => r.text)).toEqual(["Risk ≤ 0.5%", "Trend agrees"]);
    expect(after[1].id).toBe(rules[0].id);
    expect(await prisma.tradeRuleCheck.findMany({ where: { tradeId: t }, select: { ruleId: true } })).toEqual([
      { ruleId: rules[0].id },
    ]);
  });

  it("splits stats into by-the-book and broke-a-rule", async () => {
    const { user, account, playbookId } = await setup();
    const rules = await prisma.playbookRule.findMany({ where: { playbookId } });
    const win = await trade(account.id, "1.1020", playbookId);
    const loss = await trade(account.id, "1.0990", playbookId);
    for (const r of rules) await setRuleCheck(account.id, win, r.id, true);
    await setRuleCheck(account.id, loss, rules[0].id, false);

    const [view] = await listPlaybooks(user.id, account.id);
    expect(view.byTheBook.closedCount).toBe(1);
    expect(view.byTheBook.netPnl).toBe(200);
    expect(view.brokeARule.closedCount).toBe(1);
    expect(view.compliance).toBeCloseTo(2 / 3);
  });

  it("changing a trade's playbook clears the old playbook's answers", async () => {
    const { account, playbookId } = await setup();
    const other = await createPlaybook({ name: "Reversal", rules: ["Divergence"] });
    if (!other.ok) throw new Error();
    const t = await trade(account.id, "1.1020", playbookId);
    const [rule] = await prisma.playbookRule.findMany({ where: { playbookId } });
    await setRuleCheck(account.id, t, rule.id, true);

    await setTradePlaybook(account.id, t, other.id);
    expect(await prisma.tradeRuleCheck.count({ where: { tradeId: t } })).toBe(0);
  });

  it("refuses another user's playbook, on a trade and in a rule check", async () => {
    const { account } = await setup();
    const t = await trade(account.id, "1.1020");
    const stranger = await createUser();
    signInAs(stranger.id);
    const theirs = await createPlaybook({ name: "Mine", rules: ["x"] });
    if (!theirs.ok) throw new Error();
    const [theirRule] = await prisma.playbookRule.findMany({ where: { playbookId: theirs.id } });

    const owner = await prisma.tradingAccount.findUniqueOrThrow({ where: { id: account.id } });
    signInAs(owner.userId);
    expect((await setTradePlaybook(account.id, t, theirs.id)).ok).toBe(false);
    expect((await setRuleCheck(account.id, t, theirRule.id, true)).ok).toBe(false);
    const created = await createTrade(
      account.id,
      buildFormData(
        defaultFormValues({
          entryMode: "PRICE",
          symbol: "EURUSD",
          entryPrice: "1.1",
          volumeLots: "1",
          playbookId: theirs.id,
        }),
      ),
    );
    expect(created.ok).toBe(false);
  });

  it("names are unique per user", async () => {
    await setup();
    expect(await createPlaybook({ name: "Breakout", rules: [] })).toMatchObject({ ok: false });
  });
});
