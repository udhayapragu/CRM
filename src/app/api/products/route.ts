import { z } from "zod";
import { apiRoute, parseQuery } from "@/lib/api";
import { listProducts } from "@/server/services/products";

const q = z.object({
  q: z.string().max(100).optional(),
  filter: z.enum(["all", "in", "low", "out", "untracked", "active", "draft", "recent", "removed"]).optional(),
  category: z.string().max(100).optional(),
  sort: z.enum(["name", "sku", "price", "onhand", "available", "updated", "created"]).optional(),
  dir: z.enum(["asc", "desc"]).optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(5).max(100).optional(),
});

export const GET = apiRoute({ permission: "products:view" }, async ({ req }) => listProducts(parseQuery(req, q)));
