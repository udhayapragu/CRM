import { apiRoute, parseBody } from "@/lib/api";
import { attributeSchema } from "@/lib/validation";
import { attributeOrderToMember } from "@/server/services/mlm";

export const POST = apiRoute<{ id: string }>({ permission: "mlm:manage" }, async ({ req, params, user }) => {
  const body = await parseBody(req, attributeSchema);
  await attributeOrderToMember(params.id, body.memberId, user.id);
  return { ok: true };
});
