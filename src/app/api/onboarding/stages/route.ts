import { apiRoute, parseBody } from "@/lib/api";
import { stageSchema } from "@/lib/validation";
import { createStage } from "@/server/services/onboarding";

export const POST = apiRoute({ permission: "settings:manage" }, async ({ req, user, ip }) => {
  const body = await parseBody(req, stageSchema);
  return createStage(body, { userId: user.id, ip });
});
