import { z } from "zod";
import { apiRoute, parseQuery } from "@/lib/api";
import { ORDER_STATUSES } from "@/lib/validation";
import { listOrders } from "@/server/services/queries";

const q = z.object({
  q: z.string().max(100).optional(),
  status: z.enum([...ORDER_STATUSES, "ATTENTION", "DELAYED", ""]).optional(),
  payment: z.string().max(30).optional(),
  from: z.string().max(20).optional(),
  to: z.string().max(20).optional(),
  sort: z.enum(["orderDate", "total", "number", "expectedDispatchDate"]).optional(),
  dir: z.enum(["asc", "desc"]).optional(),
  page: z.coerce.number().int().optional(),
  pageSize: z.coerce.number().int().optional(),
});

export const GET = apiRoute({ permission: "orders:view" }, async ({ req, user }) => listOrders(parseQuery(req, q), user.role));
