import { apiRoute, parseBody } from "@/lib/api";
import { passwordChangeSchema } from "@/lib/validation";
import { changeOwnPassword } from "@/server/services/users";

export const POST = apiRoute({}, async ({ req, user }) => {
  const body = await parseBody(req, passwordChangeSchema);
  await changeOwnPassword(user.id, body.current, body.next);
  return { ok: true };
});
