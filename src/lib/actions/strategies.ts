"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { fail, failFields, fieldErrorsFrom, ok, type ActionResult } from "./result";
import { requireUser } from "@/lib/session";
import { MAX_STRATEGY_CODE_CHARS, checkStrategySyntax } from "@/lib/backtest";

const paramValue = z.union([z.number(), z.string(), z.boolean()]);

const strategySchema = z.object({
  name: z.string().trim().min(1, "Name is required.").max(80, "Keep it under 80 characters."),
  description: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    z.string().trim().max(400, "Keep it under 400 characters.").optional(),
  ),
  code: z
    .string()
    .trim()
    .min(1, "Strategy code is required.")
    .max(MAX_STRATEGY_CODE_CHARS, `Keep it under ${MAX_STRATEGY_CODE_CHARS.toLocaleString()} characters.`),
  params: z.record(z.string(), paramValue).optional(),
});

export type StrategyInput = z.input<typeof strategySchema>;

/** Parses `code` as a cheap, immediate sanity check so a syntax error is
 * reported at save time rather than when a run is submitted minutes later.
 *
 * This used to call `compileStrategy`, which also RUNS the source — remote
 * code execution, given this app has open registration. `checkStrategySyntax`
 * compiles without invoking; see `src/lib/backtest/strategy-source.ts` for why
 * that is safe and what it gives up (the "defines onBar" check, which needs
 * execution and now happens in the workbench's Web Worker). */
function compileCheck(code: string): string | null {
  return checkStrategySyntax(code);
}

function revalidateStrategies() {
  revalidatePath("/backtest/strategies");
}

export async function createStrategy(input: StrategyInput): Promise<ActionResult<{ id: string }>> {
  const parsed = strategySchema.safeParse(input);
  if (!parsed.success) return failFields(fieldErrorsFrom(parsed.error));

  const compileError = compileCheck(parsed.data.code);
  if (compileError) return failFields({ code: [compileError] });

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
      return failFields({ name: [`You already have a strategy named "${parsed.data.name}".`] });
    }
    throw err;
  }
}

async function strategyOrError(userId: string, id: string) {
  const strategy = await prisma.strategy.findFirst({ where: { id, userId } });
  if (!strategy) return { error: fail("That strategy was not found.") as ActionResult };
  return { strategy };
}

export async function updateStrategy(id: string, input: StrategyInput): Promise<ActionResult> {
  const parsed = strategySchema.safeParse(input);
  if (!parsed.success) return failFields(fieldErrorsFrom(parsed.error));

  const compileError = compileCheck(parsed.data.code);
  if (compileError) return failFields({ code: [compileError] });

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
    return ok();
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return failFields({ name: [`You already have a strategy named "${parsed.data.name}".`] });
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
  return ok();
}
