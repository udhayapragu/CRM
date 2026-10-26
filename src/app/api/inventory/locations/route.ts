import { apiRoute, parseBody } from "@/lib/api";
import { prisma } from "@/lib/db";
import { locationSchema } from "@/lib/validation";
import { createLocation } from "@/server/services/inventory-ops";

export const GET = apiRoute({ permission: "inventory:view" }, async () => prisma.inventoryLocation.findMany({ orderBy: [{ isDefault: "desc" }, { code: "asc" }] }));

export const POST = apiRoute({ permission: "inventory:manage" }, async ({ req, user, ip }) => {
  const body = await parseBody(req, locationSchema);
  return createLocation(body, { userId: user.id, ip });
});
