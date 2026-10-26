import { apiRoute } from "@/lib/api";
import { resolveAttention } from "@/server/services/orders";

export const POST = apiRoute<{ id: string }>({ permission: "orders:edit" }, async ({ params, user }) => {
  await resolveAttention(params.id, user.id);
  return { ok: true };
});
