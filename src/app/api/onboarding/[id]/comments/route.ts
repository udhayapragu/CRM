import { apiRoute, parseBody } from "@/lib/api";
import { commentSchema } from "@/lib/validation";
import { addComment } from "@/server/services/onboarding";

export const POST = apiRoute<{ id: string }>({ permission: "onboarding:manage" }, async ({ req, params, user, ip }) => {
  const body = await parseBody(req, commentSchema);
  return addComment(params.id, body.body, { userId: user.id, ip });
});
