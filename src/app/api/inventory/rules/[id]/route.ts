import { apiRoute } from "@/lib/api";
import { deleteConsumptionRule } from "@/server/services/inventory-ops";

export const DELETE = apiRoute<{ id: string }>({ permission: "inventory:manage" }, async ({ params, user, ip }) => {
  await deleteConsumptionRule(params.id, { userId: user.id, ip });
  return { ok: true };
});
