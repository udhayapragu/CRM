import { z } from "zod";
import { apiRoute, parseQuery } from "@/lib/api";
import { listAudit } from "@/server/services/queries";

const q = z.object({ q: z.string().max(100).optional(), entityType: z.string().max(50).optional(), userId: z.string().max(40).optional(), page: z.coerce.number().int().optional() });

export const GET = apiRoute({ permission: "audit:view" }, async ({ req }) => listAudit(parseQuery(req, q)));
