import { apiRoute, parseBody } from "@/lib/api";
import { prisma } from "@/lib/db";
import { receiptSchema } from "@/lib/validation";
import { createPurchaseReceipt } from "@/server/services/inventory-ops";

export const GET = apiRoute({ permission: "inventory:view" }, async () =>
  prisma.purchaseReceipt.findMany({ orderBy: { receivedAt: "desc" }, take: 100, include: { supplier: true, lines: { include: { item: { select: { name: true, sku: true, unit: true } } } }, createdBy: { select: { name: true } } } }),
);

export const POST = apiRoute({ permission: "inventory:adjust" }, async ({ req, user, ip }) => {
  const body = await parseBody(req, receiptSchema);
  return createPurchaseReceipt(body, { userId: user.id, ip });
});
