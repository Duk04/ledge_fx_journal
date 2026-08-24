import "server-only";
import { prisma } from "@/lib/db";
import { toPlain } from "@/lib/decimal-bridge";
import type { TagKind } from "@prisma/client";

/**
 * Settings reads: profile, tags (grouped by kind), and the instrument
 * reference table. Tags are user-scoped; instruments are shared reference
 * data (see docs/DATA-MODEL.md) with no owner, so `listInstruments` takes no
 * userId.
 */

export type ProfileView = {
  id: string;
  name: string | null;
  email: string;
  timezone: string;
};

export async function getProfile(userId: string): Promise<ProfileView> {
  return prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { id: true, name: true, email: true, timezone: true },
  });
}

export type TagRow = {
  id: string;
  name: string;
  kind: TagKind;
  color: string;
  sortOrder: number;
  /** How many trades currently carry this tag — shown as a delete warning. */
  tradeCount: number;
};

export type TagsGrouped = {
  setup: TagRow[];
  mistake: TagRow[];
};

/** SETUP and MISTAKE tags, each sorted by `sortOrder` — the two groups the Tags tab manages. */
export async function listTagsGrouped(userId: string): Promise<TagsGrouped> {
  const tags = await prisma.tag.findMany({
    where: { userId, kind: { in: ["SETUP", "MISTAKE"] } },
    orderBy: [{ kind: "asc" }, { sortOrder: "asc" }],
    include: { _count: { select: { tradeTags: true } } },
  });

  const mapped: TagRow[] = tags.map((t) => ({
    id: t.id,
    name: t.name,
    kind: t.kind,
    color: t.color,
    sortOrder: t.sortOrder,
    tradeCount: t._count.tradeTags,
  }));

  return {
    setup: mapped.filter((t) => t.kind === "SETUP"),
    mistake: mapped.filter((t) => t.kind === "MISTAKE"),
  };
}

export type InstrumentRow = {
  symbol: string;
  displayName: string;
  pipSize: string;
  contractSize: string;
  digits: number;
  baseCurrency: string | null;
  quoteCurrency: string;
  assetClass: string;
  isActive: boolean;
};

/** The full instrument reference table — shared across all users, not scoped to one. */
export async function listInstruments(): Promise<InstrumentRow[]> {
  const rows = await prisma.instrument.findMany({
    orderBy: [{ assetClass: "asc" }, { symbol: "asc" }],
  });

  return rows.map((r) => ({
    symbol: r.symbol,
    displayName: r.displayName,
    pipSize: toPlain(r.pipSize)!,
    contractSize: toPlain(r.contractSize)!,
    digits: r.digits,
    baseCurrency: r.baseCurrency,
    quoteCurrency: r.quoteCurrency,
    assetClass: r.assetClass,
    isActive: r.isActive,
  }));
}
