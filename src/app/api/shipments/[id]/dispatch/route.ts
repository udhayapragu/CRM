import { apiRoute, parseBody } from "@/lib/api";
import { dispatchSchema } from "@/lib/validation";
import { dispatchShipment } from "@/server/services/dispatch";

export const POST = apiRoute<{ id: string }>({ permission: "dispatch:manage" }, async ({ req, params, user, ip }) => {
  const body = await parseBody(req, dispatchSchema);
  return dispatchShipment(params.id, body, { userId: user.id, ip });
});
