import { z } from "zod";
import { apiRoute, parseBody } from "@/lib/api";
import { getProductDetail, updateProductSettings } from "@/server/services/products";

export const GET = apiRoute<{ id: string }>({ permission: "products:view" }, async ({ params }) => getProductDetail(params.id));

export const PATCH = apiRoute<{ id: string }>({ permission: "products:edit" }, async ({ req, params, user, ip }) => {
  const body = await parseBody(req, z.object({ lowStockThreshold: z.coerce.number().int().min(0).max(1_000_000) }));
  return updateProductSettings(params.id, body, { userId: user.id, ip });
});
