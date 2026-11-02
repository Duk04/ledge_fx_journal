/**
 * Screenshots on a journal day, end to end against Postgres: the upload
 * route, the serve/delete route and the caption/link actions all find the
 * owner through the journal entry as well as through a trade, and none of
 * them lets another user reach the row. Storage is an in-memory map — the
 * drivers have their own tests (lib/storage.test.ts); what is under test here
 * is who may reach which row.
 */
import { describe, expect, it, vi } from "vitest";
import type * as Storage from "@/lib/storage";
import { prisma } from "@/lib/db";
import { addExternalLink, setCaption } from "@/lib/actions/attachments";
import { signInAs } from "../../../../test/db/auth";
import { createAccount, createUser, ensureInstruments } from "../../../../test/db/factories";
import { POST as upload } from "./route";
import { DELETE as remove, GET as serve } from "./[id]/route";

const objects = new Map<string, Buffer>();

vi.mock("@/lib/storage", async (importOriginal) => {
  const actual = await importOriginal<typeof Storage>();
  return {
    ...actual,
    uploadsAvailable: () => true,
    getStorage: () => ({
      kind: "local" as const,
      putObject: async ({ key, body }: { key: string; body: Buffer }) => void objects.set(key, body),
      getObject: async (key: string) => {
        const body = objects.get(key);
        return body ? { body, contentType: "image/png" } : null;
      },
      deleteObject: async (key: string) => void objects.delete(key),
      objectUrl: (key: string) => `memory://${key}`,
    }),
  };
});

/** A minimal but structurally real PNG: signature, then an IHDR chunk. */
function png(): Buffer {
  const buf = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf, 0);
  buf.writeUInt32BE(13, 8);
  buf.write("IHDR", 12, "ascii");
  buf.writeUInt32BE(800, 16);
  buf.writeUInt32BE(600, 20);
  return buf;
}

function uploadTo(fields: Record<string, string>) {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  form.set("file", new File([new Uint8Array(png())], "chart.png", { type: "image/png" }));
  return upload(new Request("http://ledger.test/api/attachments", { method: "POST", body: form }));
}

const params = (id: string) => ({ params: Promise.resolve({ id }) });

describe("journal-day screenshots", () => {
  it("an upload creates the day's entry and hangs the file off it", async () => {
    const user = await createUser();
    signInAs(user.id);

    const res = await uploadTo({ journalDate: "2026-03-04", kind: "BEFORE" });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string };

    const row = await prisma.attachment.findUniqueOrThrow({
      where: { id: body.id },
      include: { journalEntry: true },
    });
    expect(row.tradeId).toBeNull();
    expect(row.kind).toBe("BEFORE");
    expect(row.journalEntry?.userId).toBe(user.id);
    expect(row.journalEntry?.entryDate.toISOString()).toBe("2026-03-04T00:00:00.000Z");
    expect(row.storageKey?.startsWith(`${user.id}/journal/2026-03-04/`)).toBe(true);
  });

  it("refuses a day that is not a date, and creates no entry", async () => {
    const user = await createUser();
    signInAs(user.id);

    const res = await uploadTo({ journalDate: "2026-13-01" });
    expect(res.status).toBe(404);
    expect(await prisma.journalEntry.count({ where: { userId: user.id } })).toBe(0);
  });

  it("another user can neither fetch, delete, nor caption it", async () => {
    const alice = await createUser();
    const bob = await createUser();
    signInAs(alice.id);
    const { id } = (await (await uploadTo({ journalDate: "2026-03-05" })).json()) as { id: string };

    signInAs(bob.id);
    expect((await serve(new Request("http://ledger.test"), params(id))).status).toBe(404);
    expect((await remove(new Request("http://ledger.test"), params(id))).status).toBe(404);
    expect((await setCaption(id, "mine now")).ok).toBe(false);
    expect(await prisma.attachment.count({ where: { id } })).toBe(1);

    signInAs(alice.id);
    const own = await serve(new Request("http://ledger.test"), params(id));
    expect(own.status).toBe(200);
    expect(Buffer.from(await own.arrayBuffer()).equals(png())).toBe(true);
    expect((await remove(new Request("http://ledger.test"), params(id))).status).toBe(200);
    expect(await prisma.attachment.count({ where: { id } })).toBe(0);
  });

  it("links an https image to a day", async () => {
    const user = await createUser();
    signInAs(user.id);

    const res = await addExternalLink({ journalDate: "2026-03-06" }, "https://example.com/chart.png", "AFTER");
    if (!res.ok) throw new Error(JSON.stringify(res));
    const row = await prisma.attachment.findUniqueOrThrow({ where: { id: res.id }, include: { journalEntry: true } });
    expect(row).toMatchObject({ kind: "AFTER", tradeId: null, externalUrl: "https://example.com/chart.png" });
    expect(row.journalEntry?.userId).toBe(user.id);
  });

  it("the database refuses an attachment with no owner, or with two", async () => {
    const user = await createUser();
    const entry = await prisma.journalEntry.create({
      data: { userId: user.id, entryDate: new Date("2026-03-07T00:00:00.000Z") },
    });
    await expect(prisma.attachment.create({ data: { externalUrl: "https://example.com/a.png" } })).rejects.toThrow();

    await ensureInstruments("EURUSD");
    const account = await createAccount(user.id);
    const trade = await prisma.trade.create({
      data: {
        accountId: account.id,
        symbol: "EURUSD",
        direction: "LONG",
        openedAt: new Date(),
        entryPrice: "1.1",
        volumeLots: "1",
      },
    });
    await expect(
      prisma.attachment.create({
        data: { tradeId: trade.id, journalEntryId: entry.id, externalUrl: "https://e.com/b.png" },
      }),
    ).rejects.toThrow();
  });
});
