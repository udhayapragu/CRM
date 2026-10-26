import { apiRoute, parseBody } from "@/lib/api";
import { trackProductSchema } from "@/lib/validation";
import { trackProduct } from "@/server/services/inventory-ops";

export const POST = apiRoute<{ id: string }>({ permission: "inventory:manage" }, async ({ req, params, user, ip }) => {
  const body = await parseBody(req, trackProductSchema);
  return trackProduct({ productId: params.id, ...body }, { userId: user.id, ip });
});
