import { apiRoute, parseBody } from "@/lib/api";
import { stageSchema } from "@/lib/validation";
import { updateStage } from "@/server/services/onboarding";

export const PATCH = apiRoute<{ id: string }>({ permission: "settings:manage" }, async ({ req, params, user, ip }) => {
  const body = await parseBody(req, stageSchema.partial());
  return updateStage(params.id, body, { userId: user.id, ip });
});
