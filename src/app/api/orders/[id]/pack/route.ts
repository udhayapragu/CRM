import { apiRoute, parseBody } from "@/lib/api";
import { packSchema } from "@/lib/validation";
import { packOrder } from "@/server/services/dispatch";

export const POST = apiRoute<{ id: string }>({ permission: "dispatch:manage" }, async ({ req, params, user, ip }) => {
  const body = await parseBody(req, packSchema);
  return packOrder(params.id, body, { userId: user.id, ip });
});
