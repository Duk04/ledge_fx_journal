/**
 * The daily checklist against Postgres: the list is per user, ticks are per
 * day, another user's item id is "not found", and an item that was ticked is
 * archived rather than deleted so its days keep their record.
 */
import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { dailyChecklist } from "@/lib/queries/checklist";
import { signInAs } from "../../../test/db/auth";
import { createUser } from "../../../test/db/factories";
import {
  addChecklistItem,
  moveChecklistItem,
  removeChecklistItem,
  renameChecklistItem,
  setDailyCheck,
} from "./checklist";

async function add(text: string) {
  const res = await addChecklistItem({ text });
  if (!res.ok) throw new Error(JSON.stringify(res));
  return res.id;
}

describe("daily checklist", () => {
  it("ticks an item for one day only", async () => {
    const user = await createUser();
    signInAs(user.id);
    const trend = await add("Check the 1H trend");
    await add("Wait for a 1m FVG");

    expect((await setDailyCheck({ itemId: trend, date: "2026-10-17", checked: true })).ok).toBe(true);
    // Ticking twice is not an error, and changes nothing.
    expect((await setDailyCheck({ itemId: trend, date: "2026-10-17", checked: true })).ok).toBe(true);

    const day = await dailyChecklist(user.id, "2026-10-17");
    expect(day.items.map((i) => [i.text, i.checked])).toEqual([
      ["Check the 1H trend", true],
      ["Wait for a 1m FVG", false],
    ]);
    expect([day.done, day.total]).toEqual([1, 2]);
    expect((await dailyChecklist(user.id, "2026-10-18")).done).toBe(0);

    await setDailyCheck({ itemId: trend, date: "2026-10-17", checked: false });
    expect((await dailyChecklist(user.id, "2026-10-17")).done).toBe(0);
  });

  it("treats another user's item as not found, and changes nothing", async () => {
    const alice = await createUser();
    const bob = await createUser();
    signInAs(bob.id);
    const bobs = await add("Bob's item");

    signInAs(alice.id);
    expect((await setDailyCheck({ itemId: bobs, date: "2026-10-17", checked: true })).ok).toBe(false);
    expect((await renameChecklistItem({ id: bobs, text: "mine now" })).ok).toBe(false);
    expect((await removeChecklistItem({ id: bobs })).ok).toBe(false);
    expect((await moveChecklistItem({ id: bobs, direction: "up" })).ok).toBe(false);

    const row = await prisma.checklistItem.findUniqueOrThrow({ where: { id: bobs }, include: { checks: true } });
    expect(row).toMatchObject({ text: "Bob's item", archivedAt: null, checks: [] });
    expect((await dailyChecklist(alice.id, "2026-10-17")).total).toBe(0);
  });

  it("archives a ticked item — kept on its days, gone from new ones — and deletes an unticked one", async () => {
    const user = await createUser();
    signInAs(user.id);
    const ticked = await add("Ticked once");
    const never = await add("Never ticked");
    await setDailyCheck({ itemId: ticked, date: "2026-10-16", checked: true });

    expect((await removeChecklistItem({ id: ticked })).ok).toBe(true);
    expect((await removeChecklistItem({ id: never })).ok).toBe(true);

    expect(await prisma.checklistItem.findUnique({ where: { id: never } })).toBeNull();
    const old = await dailyChecklist(user.id, "2026-10-16");
    expect(old.items).toMatchObject([{ text: "Ticked once", checked: true, archived: true }]);
    expect((await dailyChecklist(user.id, "2026-10-17")).items).toEqual([]);
    // An archived item is a record, not a control.
    expect((await setDailyCheck({ itemId: ticked, date: "2026-10-17", checked: true })).ok).toBe(false);
  });

  it("reorders, renames, and refuses a blank item", async () => {
    const user = await createUser();
    signInAs(user.id);
    await add("A");
    const b = await add("B");
    await moveChecklistItem({ id: b, direction: "up" });
    await renameChecklistItem({ id: b, text: "  B first  " });

    expect((await dailyChecklist(user.id, "2026-10-17")).items.map((i) => i.text)).toEqual(["B first", "A"]);
    expect((await addChecklistItem({ text: "   " })).ok).toBe(false);
  });
});
