"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { fail, failFields, fieldErrorsFrom, ok, type ActionResult } from "./result";

function revalidateTags() {
  revalidatePath("/settings");
}

const nameSchema = z.string().trim().min(1, "Name is required.").max(60, "Keep it under 60 characters.");
const colorSchema = z
  .string()
  .trim()
  .regex(/^#[0-9a-fA-F]{6}$/, "Use a 6-digit hex colour, e.g. #33488F.");
const kindSchema = z.enum(["SETUP", "MISTAKE"], { message: "Choose SETUP or MISTAKE." });

const createSchema = z.object({ name: nameSchema, kind: kindSchema, color: colorSchema });

export async function createTag(input: z.input<typeof createSchema>): Promise<ActionResult> {
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return failFields(fieldErrorsFrom(parsed.error));

  const user = await requireUser();

  const existing = await prisma.tag.findUnique({
    where: { userId_kind_name: { userId: user.id, kind: parsed.data.kind, name: parsed.data.name } },
  });
  if (existing) {
    return failFields({ name: ["A tag with this name already exists in this group."] });
  }

  const max = await prisma.tag.aggregate({
    where: { userId: user.id, kind: parsed.data.kind },
    _max: { sortOrder: true },
  });

  await prisma.tag.create({
    data: {
      userId: user.id,
      name: parsed.data.name,
      kind: parsed.data.kind,
      color: parsed.data.color,
      sortOrder: (max._max.sortOrder ?? -1) + 1,
    },
  });

  revalidateTags();
  return ok();
}

const updateSchema = z.object({ name: nameSchema, color: colorSchema });

/** Renames and/or recolours a tag. Reordering is a separate action (`reorderTag`). */
export async function updateTag(tagId: string, input: z.input<typeof updateSchema>): Promise<ActionResult> {
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) return failFields(fieldErrorsFrom(parsed.error));

  const user = await requireUser();
  const tag = await prisma.tag.findFirst({ where: { id: tagId, userId: user.id } });
  if (!tag) return fail("Tag not found.");

  const clash = await prisma.tag.findFirst({
    where: { userId: user.id, kind: tag.kind, name: parsed.data.name, NOT: { id: tagId } },
  });
  if (clash) {
    return failFields({ name: ["A tag with this name already exists in this group."] });
  }

  await prisma.tag.update({ where: { id: tagId }, data: { name: parsed.data.name, color: parsed.data.color } });
  revalidateTags();
  return ok();
}

/**
 * Swaps this tag's `sortOrder` with its neighbour on the given side, within
 * the same kind. A no-op (not an error) at either end of the list.
 */
export async function reorderTag(tagId: string, direction: "up" | "down"): Promise<ActionResult> {
  const user = await requireUser();
  const tag = await prisma.tag.findFirst({ where: { id: tagId, userId: user.id } });
  if (!tag) return fail("Tag not found.");

  const neighbor = await prisma.tag.findFirst({
    where: {
      userId: user.id,
      kind: tag.kind,
      sortOrder: direction === "up" ? { lt: tag.sortOrder } : { gt: tag.sortOrder },
    },
    orderBy: { sortOrder: direction === "up" ? "desc" : "asc" },
  });
  if (!neighbor) return ok();

  await prisma.$transaction([
    prisma.tag.update({ where: { id: tag.id }, data: { sortOrder: neighbor.sortOrder } }),
    prisma.tag.update({ where: { id: neighbor.id }, data: { sortOrder: tag.sortOrder } }),
  ]);

  revalidateTags();
  return ok();
}

/** Deleting a tag cascades to `trade_tags` (schema `onDelete: Cascade`) — the
 * usage-count warning is shown client-side before this is ever called. */
export async function deleteTag(tagId: string): Promise<ActionResult> {
  const user = await requireUser();
  const tag = await prisma.tag.findFirst({ where: { id: tagId, userId: user.id } });
  if (!tag) return fail("Tag not found.");

  await prisma.tag.delete({ where: { id: tagId } });
  revalidateTags();
  return ok();
}
