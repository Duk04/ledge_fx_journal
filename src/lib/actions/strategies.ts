"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/session";
import { compileStrategy } from "@/lib/backtest";

export interface ActionResult {
  ok: boolean;
  fieldErrors?: Record<string, string[]>;
  formError?: string;
}

function fieldErrorsFrom(error: z.ZodError): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    (out[key] ??= []).push(issue.message);
  }
  return out;
}

const paramValue = z.union([z.number(), z.string(), z.boolean()]);

const strategySchema = z.object({
  name: z.string().trim().min(1, "Name is required.").max(80, "Keep it under 80 characters."),
  description: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    z.string().trim().max(400, "Keep it under 400 characters.").optional(),
  ),
  code: z.string().trim().min(1, "Strategy code is required."),
  params: z.record(z.string(), paramValue).optional(),
});

export type StrategyInput = z.input<typeof strategySchema>;

/** Compiles `code` as a cheap, immediate sanity check — the same compiler the
 * run path uses (`compileStrategy`, see sandbox.ts). Catching a typo'd
 * `onBar` here, at save time, beats discovering it only once a run form is
 * submitted minutes later. */
function compileCheck(code: string): string | null {
  try {
    compileStrategy(code);
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

function revalidateStrategies() {
  revalidatePath("/backtest/strategies");
}

export async function createStrategy(input: StrategyInput): Promise<ActionResult & { id?: string }> {
  const parsed = strategySchema.safeParse(input);
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrorsFrom(parsed.error) };

  const compileError = compileCheck(parsed.data.code);
  if (compileError) return { ok: false, fieldErrors: { code: [compileError] } };

  const user = await requireUser();

  try {
    const strategy = await prisma.strategy.create({
      data: {
        userId: user.id,
        name: parsed.data.name,
        description: parsed.data.description ?? null,
        code: parsed.data.code,
        params: (parsed.data.params ?? {}) as Prisma.InputJsonValue,
      },
    });
    revalidateStrategies();
    return { ok: true, id: strategy.id };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return { ok: false, fieldErrors: { name: [`You already have a strategy named "${parsed.data.name}".`] } };
    }
    throw err;
  }
}

async function strategyOrError(userId: string, id: string) {
  const strategy = await prisma.strategy.findFirst({ where: { id, userId } });
  if (!strategy) return { error: { ok: false, formError: "That strategy was not found." } as ActionResult };
  return { strategy };
}

export async function updateStrategy(id: string, input: StrategyInput): Promise<ActionResult> {
  const parsed = strategySchema.safeParse(input);
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrorsFrom(parsed.error) };

  const compileError = compileCheck(parsed.data.code);
  if (compileError) return { ok: false, fieldErrors: { code: [compileError] } };

  const user = await requireUser();
  const { error } = await strategyOrError(user.id, id);
  if (error) return error;

  try {
    await prisma.strategy.update({
      where: { id },
      data: {
        name: parsed.data.name,
        description: parsed.data.description ?? null,
        code: parsed.data.code,
        params: (parsed.data.params ?? {}) as Prisma.InputJsonValue,
      },
    });
    revalidateStrategies();
    return { ok: true };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return { ok: false, fieldErrors: { name: [`You already have a strategy named "${parsed.data.name}".`] } };
    }
    throw err;
  }
}

export async function deleteStrategy(id: string): Promise<ActionResult> {
  const user = await requireUser();
  const { error } = await strategyOrError(user.id, id);
  if (error) return error;

  await prisma.strategy.delete({ where: { id } });
  revalidateStrategies();
  return { ok: true };
}
