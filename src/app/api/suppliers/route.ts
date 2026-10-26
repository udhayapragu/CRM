import { apiRoute, parseBody } from "@/lib/api";
import { prisma } from "@/lib/db";
import { supplierSchema } from "@/lib/validation";
import { upsertSupplier } from "@/server/services/inventory-ops";

export const GET = apiRoute({ permission: "inventory:view" }, async () =>
  prisma.supplier.findMany({ orderBy: { name: "asc" }, include: { _count: { select: { items: true, receipts: true } } } }),
);

export const POST = apiRoute({ permission: "inventory:manage" }, async ({ req, user, ip }) => {
  const body = await parseBody(req, supplierSchema);
  return upsertSupplier(null, body, { userId: user.id, ip });
});
