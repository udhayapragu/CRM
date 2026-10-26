import { z } from "zod";
import { apiRoute, parseQuery } from "@/lib/api";
import { dispatchBoard } from "@/server/services/queries";

const q = z.object({
  view: z.enum(["to-pack", "ready", "awaiting-pickup", "in-transit", "dispatched-today", "delivered", "delayed"]).default("to-pack"),
  q: z.string().max(100).optional(),
  from: z.string().max(20).optional(),
  to: z.string().max(20).optional(),
  page: z.coerce.number().int().optional(),
});

export const GET = apiRoute({ permission: "dispatch:view" }, async ({ req, user }) => {
  const p = parseQuery(req, q);
  return dispatchBoard(p.view, p, user.role);
});
