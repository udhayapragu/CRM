import { apiRoute, parseBody } from "@/lib/api";
import { connectionSchema } from "@/lib/validation";
import { getPrimaryConnection, publicConnection, saveConnection } from "@/server/integrations/wordpress/connection-service";

export const GET = apiRoute({ permission: "integration:view" }, async () => {
  const c = await getPrimaryConnection();
  return { connection: c ? publicConnection(c) : null };
});

export const PUT = apiRoute({ permission: "integration:manage" }, async ({ req, user, ip }) => {
  const body = await parseBody(req, connectionSchema);
  const saved = await saveConnection(body, { userId: user.id, ip });
  return { connection: publicConnection(saved) };
});
