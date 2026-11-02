/**
 * What a new attachment hangs off: a trade, or a day's journal entry
 * (prisma/schema.prisma, `Attachment` — exactly one of the two). Shared by the
 * uploader in the browser and the route/actions that re-check it on the server.
 */
export type AttachmentTarget = { tradeId: string } | { journalDate: string };
