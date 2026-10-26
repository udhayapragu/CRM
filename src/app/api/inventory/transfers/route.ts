import { apiRoute, parseBody } from "@/lib/api";
import { transferSchema } from "@/lib/validation";
import { recordTransfer } from "@/server/services/inventory-ops";

export const POST = apiRoute({ permission: "inventory:adjust" }, async ({ req, user, ip }) => {
  const body = await parseBody(req, transferSchema);
  return recordTransfer(body, { userId: user.id, ip });
});
