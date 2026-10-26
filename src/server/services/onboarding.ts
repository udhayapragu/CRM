import { mkdir, readFile, unlink, writeFile } from "fs/promises";
import path from "path";
import { prisma, type Tx } from "@/lib/db";
import { env } from "@/lib/env";
import { randomToken } from "@/lib/crypto";
import { AppError, notFound } from "@/lib/errors";
import { audit } from "@/server/audit";
import { notify } from "./notifications";

export const DEFAULT_STAGES = [
  { key: "PRODUCT_IDEA", name: "Product Idea", color: "#a78bfa" },
  { key: "INFORMATION_PENDING", name: "Information Pending", color: "#c084fc" },
  { key: "DOCUMENTS_PENDING", name: "Documents Pending", color: "#e879f9" },
  { key: "DETAILS_COMPLETED", name: "Product Details Completed", color: "#818cf8" },
  { key: "PACKAGING_PENDING", name: "Packaging Pending", color: "#f472b6" },
  { key: "QUALITY_CHECK", name: "Quality Check", color: "#fbbf24" },
  { key: "APPROVED", name: "Approved", color: "#34d399" },
  { key: "READY_FOR_ONBOARDING", name: "Ready for Onboarding", color: "#2dd4bf" },
  { key: "ONBOARDING_IN_PROGRESS", name: "Onboarding In Progress", color: "#38bdf8" },
  { key: "LIVE", name: "Live on Website", color: "#d4af37", isTerminal: true },
  { key: "REJECTED_ON_HOLD", name: "Rejected or On Hold", color: "#f87171", isTerminal: true },
] as const;

export async function ensureDefaultStages(tx: Tx = prisma) {
  const count = await tx.onboardingStage.count();
  if (count > 0) return;
  await tx.onboardingStage.createMany({
    data: DEFAULT_STAGES.map((s, i) => ({ key: s.key, name: s.name, color: s.color, position: i, isTerminal: "isTerminal" in s ? s.isTerminal : false })),
  });
}

interface Actor {
  userId: string;
  ip?: string | null;
}

export interface OnboardingInput {
  title: string;
  sku?: string | null;
  category?: string | null;
  description?: string | null;
  stageId?: string;
  priority?: "LOW" | "MEDIUM" | "HIGH" | "URGENT";
  ownerId?: string | null;
  dueDate?: Date | null;
  productId?: string | null;
  holdReason?: string | null;
}

export async function createOnboardingItem(input: OnboardingInput, actor: Actor) {
  await ensureDefaultStages();
  const stage = input.stageId ? await prisma.onboardingStage.findUnique({ where: { id: input.stageId } }) : await prisma.onboardingStage.findFirst({ orderBy: { position: "asc" } });
  if (!stage) throw notFound("Stage");
  return prisma.$transaction(async (tx) => {
    const item = await tx.onboardingItem.create({ data: { ...input, stageId: stage.id } });
    await audit({ userId: actor.userId, action: "onboarding.create", entityType: "OnboardingItem", entityId: item.id, summary: `Onboarding item "${item.title}" created in ${stage.name}`, ip: actor.ip }, tx);
    return item;
  });
}

export async function updateOnboardingItem(id: string, input: Partial<OnboardingInput>, actor: Actor) {
  return prisma.$transaction(async (tx) => {
    const before = await tx.onboardingItem.findUnique({ where: { id }, include: { stage: true } });
    if (!before) throw notFound("Onboarding item");
    let stageChanged = false;
    if (input.stageId && input.stageId !== before.stageId) {
      const stage = await tx.onboardingStage.findUnique({ where: { id: input.stageId } });
      if (!stage) throw notFound("Stage");
      if (stage.key === "REJECTED_ON_HOLD" && !input.holdReason && !before.holdReason) {
        throw new AppError("Give a reason when moving an item to Rejected or On Hold", 400, "REASON_REQUIRED");
      }
      stageChanged = true;
      await tx.onboardingComment.create({ data: { itemId: id, userId: actor.userId, body: `Moved from "${before.stage.name}" to "${stage.name}"${input.holdReason ? ` — ${input.holdReason}` : ""}` } });
      if (stage.key === "QUALITY_CHECK" || stage.key === "APPROVED" || stage.key === "READY_FOR_ONBOARDING") {
        await notify(
          {
            type: "ONBOARDING_APPROVAL",
            title: `${before.title} → ${stage.name}`,
            message: stage.key === "QUALITY_CHECK" ? "Awaiting quality check / approval." : `Now in "${stage.name}".`,
            link: `/onboarding/${id}`,
            dedupeKey: `onb:${id}:${stage.key}`,
            isDemo: before.isDemo,
          },
          tx,
        );
      }
    }
    const item = await tx.onboardingItem.update({ where: { id }, data: { ...input, ...(stageChanged ? { stageEnteredAt: new Date() } : {}) } });
    await audit({ userId: actor.userId, action: stageChanged ? "onboarding.move" : "onboarding.update", entityType: "OnboardingItem", entityId: id, summary: `Onboarding "${item.title}" updated (${Object.keys(input).join(", ")})`, ip: actor.ip }, tx);
    return item;
  });
}

export async function addTask(itemId: string, input: { title: string; assigneeId?: string | null; dueDate?: Date | null }, actor: Actor) {
  const item = await prisma.onboardingItem.findUnique({ where: { id: itemId } });
  if (!item) throw notFound("Onboarding item");
  const t = await prisma.onboardingTask.create({ data: { itemId, ...input } });
  await audit({ userId: actor.userId, action: "onboarding.task_add", entityType: "OnboardingItem", entityId: itemId, summary: `Task "${input.title}" added` });
  return t;
}

export async function updateTask(taskId: string, input: { done?: boolean; title?: string; assigneeId?: string | null; dueDate?: Date | null }) {
  return prisma.onboardingTask.update({ where: { id: taskId }, data: { ...input, ...(input.done !== undefined ? { doneAt: input.done ? new Date() : null } : {}) } });
}

export async function deleteTask(taskId: string) {
  await prisma.onboardingTask.delete({ where: { id: taskId } });
}

export async function addComment(itemId: string, body: string, actor: Actor) {
  return prisma.onboardingComment.create({ data: { itemId, body, userId: actor.userId } });
}

// ── Documents (local disk storage; mount a persistent volume or swap for S3 in production) ──

const ALLOWED_MIME = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "text/plain",
  "text/csv",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/msword",
  "application/vnd.ms-excel",
]);

function storagePath(key: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(key)) throw new AppError("Invalid storage key", 400, "BAD_KEY");
  return path.resolve(env.uploadDir, "onboarding", key);
}

export async function saveDocument(itemId: string, file: File, actor: Actor) {
  const item = await prisma.onboardingItem.findUnique({ where: { id: itemId } });
  if (!item) throw notFound("Onboarding item");
  if (file.size > env.uploadMaxBytes) throw new AppError(`File is larger than ${Math.round(env.uploadMaxBytes / 1048576)} MB`, 413, "TOO_LARGE");
  if (!ALLOWED_MIME.has(file.type)) throw new AppError("Unsupported file type (allowed: PDF, images, Word, Excel, CSV, text)", 415, "BAD_TYPE");
  const key = randomToken(18).replace(/[^A-Za-z0-9_-]/g, "");
  const dest = storagePath(key);
  await mkdir(path.dirname(dest), { recursive: true });
  await writeFile(dest, Buffer.from(await file.arrayBuffer()));
  const safeName = file.name.replace(/[^\w.\- ()]/g, "_").slice(0, 150) || "document";
  const doc = await prisma.onboardingDocument.create({ data: { itemId, fileName: safeName, mimeType: file.type, sizeBytes: file.size, storageKey: key, uploadedById: actor.userId } });
  await audit({ userId: actor.userId, action: "onboarding.document_upload", entityType: "OnboardingItem", entityId: itemId, summary: `Uploaded ${safeName}`, ip: actor.ip });
  return doc;
}

export async function readDocument(docId: string) {
  const doc = await prisma.onboardingDocument.findUnique({ where: { id: docId } });
  if (!doc) throw notFound("Document");
  try {
    return { doc, data: await readFile(storagePath(doc.storageKey)) };
  } catch {
    throw new AppError("File is missing from storage", 410, "FILE_MISSING");
  }
}

export async function deleteDocument(docId: string, actor: Actor) {
  const doc = await prisma.onboardingDocument.delete({ where: { id: docId } });
  await unlink(storagePath(doc.storageKey)).catch(() => {});
  await audit({ userId: actor.userId, action: "onboarding.document_delete", entityType: "OnboardingItem", entityId: doc.itemId, summary: `Deleted ${doc.fileName}`, ip: actor.ip });
}

export async function updateStage(id: string, input: { name?: string; color?: string; position?: number }, actor: Actor) {
  const s = await prisma.onboardingStage.update({ where: { id }, data: input });
  await audit({ userId: actor.userId, action: "onboarding.stage_update", entityType: "OnboardingStage", entityId: id, summary: `Stage "${s.name}" updated`, ip: actor.ip });
  return s;
}

export async function createStage(input: { name: string; color?: string }, actor: Actor) {
  const max = await prisma.onboardingStage.aggregate({ _max: { position: true } });
  const key = input.name.toUpperCase().replace(/[^A-Z0-9]+/g, "_").slice(0, 40) + "_" + randomToken(3).toUpperCase().replace(/[^A-Z0-9]/g, "X");
  const s = await prisma.onboardingStage.create({ data: { key, name: input.name, color: input.color ?? "#8b5cf6", position: (max._max.position ?? 0) + 1 } });
  await audit({ userId: actor.userId, action: "onboarding.stage_create", entityType: "OnboardingStage", entityId: s.id, summary: `Stage "${s.name}" created`, ip: actor.ip });
  return s;
}
