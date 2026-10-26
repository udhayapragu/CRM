import { apiRoute, parseBody } from "@/lib/api";
import { orderPatchSchema } from "@/lib/validation";
import { updateOrderDetails } from "@/server/services/orders";
import { getOrderDetail } from "@/server/services/queries";

export const GET = apiRoute<{ id: string }>({ permission: "orders:view" }, async ({ params, user }) => getOrderDetail(params.id, user.role));

export const PATCH = apiRoute<{ id: string }>({ permission: "orders:edit" }, async ({ req, params, user, ip }) => {
  const body = await parseBody(req, orderPatchSchema);
  return updateOrderDetails(params.id, body, { userId: user.id, ip });
});
