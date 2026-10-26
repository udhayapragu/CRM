import { apiRoute, parseBody } from "@/lib/api";
import { noteSchema } from "@/lib/validation";
import { addOrderNote } from "@/server/services/orders";

export const POST = apiRoute<{ id: string }>({ permission: "orders:view" }, async ({ req, params, user }) => {
  const body = await parseBody(req, noteSchema);
  await addOrderNote(params.id, body.note, user.id);
  return { ok: true };
});
