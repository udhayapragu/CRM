import { apiRoute, parseBody } from "@/lib/api";
import { supplierSchema } from "@/lib/validation";
import { upsertSupplier } from "@/server/services/inventory-ops";

export const PATCH = apiRoute<{ id: string }>({ permission: "inventory:manage" }, async ({ req, params, user, ip }) => {
  const body = await parseBody(req, supplierSchema);
  return upsertSupplier(params.id, body, { userId: user.id, ip });
});
