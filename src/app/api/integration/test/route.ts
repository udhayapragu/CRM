import { apiRoute } from "@/lib/api";
import { AppError } from "@/lib/errors";
import { rateLimit } from "@/lib/rate-limit";
import { getPrimaryConnection, publicConnection, testConnection } from "@/server/integrations/wordpress/connection-service";
import { prisma } from "@/lib/db";

export const POST = apiRoute({ permission: "integration:manage" }, async ({ user, ip }) => {
  if (!rateLimit(`wptest:${user.id}`, 10, 60_000).ok) throw new AppError("Please wait a moment before testing again", 429, "RATE_LIMITED");
  const c = await getPrimaryConnection();
  if (!c) throw new AppError("Save the connection settings first", 400, "NO_CONNECTION");
  const result = await testConnection(c.id, { userId: user.id, ip });
  const updated = await prisma.wordPressConnection.findUniqueOrThrow({ where: { id: c.id } });
  return { result, connection: publicConnection(updated) };
});
