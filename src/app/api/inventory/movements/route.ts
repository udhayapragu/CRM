import { z } from "zod";
import { apiRoute, parseBody, parseQuery } from "@/lib/api";
import { movementSchema } from "@/lib/validation";
import { recordMovement } from "@/server/services/inventory-ops";
import { listLedger } from "@/server/services/queries";

const q = z.object({
  itemId: z.string().max(40).optional(),
  type: z.string().max(20).optional(),
  q: z.string().max(100).optional(),
  from: z.string().max(20).optional(),
  to: z.string().max(20).optional(),
  page: z.coerce.number().int().optional(),
  pageSize: z.coerce.number().int().optional(),
});

export const GET = apiRoute({ permission: "inventory:view" }, async ({ req }) => listLedger(parseQuery(req, q)));

export const POST = apiRoute({ permission: "inventory:adjust" }, async ({ req, user, ip }) => {
  const body = await parseBody(req, movementSchema);
  if (body.kind !== "ADJUSTMENT" && body.quantity < 0) body.quantity = Math.abs(body.quantity);
  return recordMovement(body, { userId: user.id, ip });
});
