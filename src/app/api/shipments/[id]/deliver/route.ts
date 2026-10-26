import { apiRoute, parseBody } from "@/lib/api";
import { deliverSchema } from "@/lib/validation";
import { confirmDelivery } from "@/server/services/dispatch";

export const POST = apiRoute<{ id: string }>({ permission: "dispatch:manage" }, async ({ req, params, user, ip }) => {
  const body = await parseBody(req, deliverSchema);
  await confirmDelivery(params.id, body, { userId: user.id, ip });
  return { ok: true };
});
