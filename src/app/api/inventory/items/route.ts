import { z } from "zod";
import { apiRoute, parseBody, parseQuery } from "@/lib/api";
import { CATEGORIES, itemCreateSchema } from "@/lib/validation";
import { createInventoryItem } from "@/server/services/inventory-ops";
import { listInventoryItems } from "@/server/services/queries";

const q = z.object({
  q: z.string().max(100).optional(),
  category: z.enum(CATEGORIES).or(z.literal("")).optional(),
  stock: z.enum(["low", "out", "ok", ""]).optional(),
  archived: z.string().optional(),
  sort: z.enum(["name", "sku", "qtyOnHand", "lastMovementAt", "category"]).optional(),
  dir: z.enum(["asc", "desc"]).optional(),
  page: z.coerce.number().int().optional(),
  pageSize: z.coerce.number().int().optional(),
});

export const GET = apiRoute({ permission: "inventory:view" }, async ({ req }) => listInventoryItems(parseQuery(req, q)));

export const POST = apiRoute({ permission: "inventory:manage" }, async ({ req, user, ip }) => {
  const body = await parseBody(req, itemCreateSchema);
  return createInventoryItem(body, { userId: user.id, ip });
});
