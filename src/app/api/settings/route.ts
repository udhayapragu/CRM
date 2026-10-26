import { apiRoute, parseBody } from "@/lib/api";
import { settingsSchema } from "@/lib/validation";
import { audit } from "@/server/audit";
import { getSettings, updateSettings } from "@/server/services/settings";

export const GET = apiRoute({}, async () => getSettings());

export const PATCH = apiRoute({ permission: "settings:manage" }, async ({ req, user, ip }) => {
  const body = await parseBody(req, settingsSchema);
  const s = await updateSettings(body);
  await audit({ userId: user.id, action: "settings.update", entityType: "AppSetting", summary: `Settings updated: ${Object.keys(body).join(", ")}`, metadata: body, ip });
  return s;
});
