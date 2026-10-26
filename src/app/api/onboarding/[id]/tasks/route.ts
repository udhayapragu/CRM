import { apiRoute, parseBody } from "@/lib/api";
import { taskSchema } from "@/lib/validation";
import { addTask } from "@/server/services/onboarding";

export const POST = apiRoute<{ id: string }>({ permission: "onboarding:manage" }, async ({ req, params, user, ip }) => {
  const body = await parseBody(req, taskSchema);
  return addTask(params.id, body, { userId: user.id, ip });
});
