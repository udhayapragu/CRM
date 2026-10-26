import { apiRoute, parseBody } from "@/lib/api";
import { orderStatusSchema } from "@/lib/validation";
import { changeOrderStatus } from "@/server/services/orders";

export const POST = apiRoute<{ id: string }>({ permission: "orders:edit" }, async ({ req, params, user, ip }) => {
  const body = await parseBody(req, orderStatusSchema);
  return changeOrderStatus(params.id, body.status, { userId: user.id, note: body.note, ip });
});
