import { apiRoute, parseBody } from "@/lib/api";
import { userUpdateSchema } from "@/lib/validation";
import { updateUser } from "@/server/services/users";

export const PATCH = apiRoute<{ id: string }>({ permission: "users:manage" }, async ({ req, params, user, ip }) => {
  const body = await parseBody(req, userUpdateSchema);
  const u = await updateUser(params.id, body, { userId: user.id, ip });
  return { id: u.id, role: u.role, active: u.active };
});
