import { apiRoute, parseBody } from "@/lib/api";
import { itemUpdateSchema } from "@/lib/validation";
import { updateInventoryItem } from "@/server/services/inventory-ops";
import { getInventoryItemDetail, listLedger } from "@/server/services/queries";

export const GET = apiRoute<{ id: string }>({ permission: "inventory:view" }, async ({ params }) => {
  const [item, ledger] = await Promise.all([getInventoryItemDetail(params.id), listLedger({ itemId: params.id, pageSize: 100 })]);
  return { item, ledger };
});

export const PATCH = apiRoute<{ id: string }>({ permission: "inventory:manage" }, async ({ req, params, user, ip }) => {
  const body = await parseBody(req, itemUpdateSchema);
  return updateInventoryItem(params.id, body, { userId: user.id, ip });
});
