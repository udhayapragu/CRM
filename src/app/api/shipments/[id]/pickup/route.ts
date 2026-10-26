import { apiRoute } from "@/lib/api";
import { markPickedUp } from "@/server/services/dispatch";

export const POST = apiRoute<{ id: string }>({ permission: "dispatch:manage" }, async ({ params, user, ip }) => {
  await markPickedUp(params.id, { userId: user.id, ip });
  return { ok: true };
});
