import { apiRoute, parseBody } from "@/lib/api";
import { returnSchema } from "@/lib/validation";
import { recordReturn } from "@/server/services/dispatch";

export const POST = apiRoute<{ id: string }>({ permission: ["orders:edit", "inventory:adjust"] }, async ({ req, params, user, ip }) => {
  const body = await parseBody(req, returnSchema);
  return recordReturn(params.id, body, { userId: user.id, ip });
});
