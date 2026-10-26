import { apiRoute, parseBody } from "@/lib/api";
import { prisma } from "@/lib/db";
import { ruleSchema } from "@/lib/validation";
import { upsertConsumptionRule } from "@/server/services/inventory-ops";

export const GET = apiRoute({ permission: "inventory:view" }, async () =>
  prisma.consumptionRule.findMany({ include: { product: { select: { id: true, name: true, sku: true } }, material: { select: { id: true, name: true, sku: true, unit: true } } }, orderBy: { createdAt: "desc" } }),
);

export const POST = apiRoute({ permission: "inventory:manage" }, async ({ req, user, ip }) => {
  const body = await parseBody(req, ruleSchema);
  return upsertConsumptionRule(body, { userId: user.id, ip });
});
