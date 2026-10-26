import { apiRoute, parseBody } from "@/lib/api";
import { taskUpdateSchema } from "@/lib/validation";
import { deleteTask, updateTask } from "@/server/services/onboarding";

export const PATCH = apiRoute<{ taskId: string }>({ permission: "onboarding:manage" }, async ({ req, params }) => {
  const body = await parseBody(req, taskUpdateSchema);
  return updateTask(params.taskId, body);
});

export const DELETE = apiRoute<{ taskId: string }>({ permission: "onboarding:manage" }, async ({ params }) => {
  await deleteTask(params.taskId);
  return { ok: true };
});
