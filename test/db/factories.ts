/**
 * Minimal row builders for db tests. Every user gets a unique email, so tests
 * never need cleanup between them: the whole scratch schema is dropped at the
 * end of the run (test/db/global-setup.ts).
 */
import { randomUUID } from "node:crypto";
import type { UserRole } from "@prisma/client";
import { prisma } from "@/lib/db";
import { seedInstruments } from "@/lib/instruments";

export async function createUser(opts: { role?: UserRole; timezone?: string; sessionsValidFrom?: Date } = {}) {
  return prisma.user.create({
    data: {
      email: `${randomUUID()}@test.local`,
      role: opts.role ?? "MEMBER",
      timezone: opts.timezone ?? "UTC",
      sessionsValidFrom: opts.sessionsValidFrom ?? null,
    },
  });
}

export async function createAccount(userId: string, opts: { currency?: string; startingBalance?: number } = {}) {
  return prisma.tradingAccount.create({
    data: {
      userId,
      label: `Test ${randomUUID().slice(0, 8)}`,
      platform: "MT5",
      accountType: "DEMO",
      currency: opts.currency ?? "USD",
      startingBalance: (opts.startingBalance ?? 10_000).toString(),
    },
  });
}

/** Upserts the named instruments from the same spec table the seed uses. */
export async function ensureInstruments(...symbols: string[]) {
  for (const symbol of symbols) {
    const spec = seedInstruments.find((i) => i.symbol === symbol);
    if (!spec) throw new Error(`No seed spec for ${symbol}`);
    await prisma.instrument.upsert({ where: { symbol }, update: {}, create: spec });
  }
}
