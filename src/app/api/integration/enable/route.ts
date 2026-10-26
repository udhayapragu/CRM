import { z } from "zod";
import { apiRoute, parseBody } from "@/lib/api";
import { AppError } from "@/lib/errors";
import { getPrimaryConnection, publicConnection, setConnectionEnabled } from "@/server/integrations/wordpress/connection-service";
import { enqueueSync, kickQueue } from "@/server/integrations/wordpress/job-runner";
import { prisma } from "@/lib/db";

export const POST = apiRoute({ permission: "integration:manage" }, async ({ req, user, ip }) => {
  const { enabled } = await parseBody(req, z.object({ enabled: z.boolean() }));
  const c = await getPrimaryConnection();
  if (!c) throw new AppError("No connection configured", 400, "NO_CONNECTION");
  const wasEnabled = c.enabled;
  const updated = await setConnectionEnabled(c.id, enabled, { userId: user.id, ip });
  if (enabled && !wasEnabled) {
    const neverSynced = !c.lastSuccessfulSyncAt;
    await enqueueSync(c.id, "FULL", neverSynced ? "INITIAL" : "MANUAL", { fullResync: neverSynced, requestedBy: user.id });
    kickQueue();
  }
  return { connection: publicConnection(await prisma.wordPressConnection.findUniqueOrThrow({ where: { id: updated.id } })) };
});
