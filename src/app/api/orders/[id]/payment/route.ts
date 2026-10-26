import { apiRoute, parseBody } from "@/lib/api";
import { paymentStatusSchema } from "@/lib/validation";
import { changePaymentStatus } from "@/server/services/orders";

export const POST = apiRoute<{ id: string }>({ permission: "orders:edit" }, async ({ req, params, user, ip }) => {
  const body = await parseBody(req, paymentStatusSchema);
  return changePaymentStatus(params.id, body.paymentStatus, { userId: user.id, note: body.note, ip });
});
