import { apiRoute, parseBody } from "@/lib/api";
import { AppError } from "@/lib/errors";
import { rateLimit } from "@/lib/rate-limit";
import { syncSchema } from "@/lib/validation";
import { audit } from "@/server/audit";
import { getPrimaryConnection } from "@/server/integrations/wordpress/connection-service";
import { enqueueSync, kickQueue } from "@/server/integrations/wordpress/job-runner";

/** "Sync now": queue a job and start processing it in the background. */
export const POST = apiRoute({ permission: "integration:manage" }, async ({ req, user, ip }) => {
  if (!rateLimit(`sync:${user.id}`, 6, 60_000).ok) throw new AppError("Too many sync requests — please wait a minute", 429, "RATE_LIMITED");
  const body = await parseBody(req, syncSchema);
  const c = await getPrimaryConnection();
  if (!c) throw new AppError("No WordPress connection configured", 400, "NO_CONNECTION");
  if (!c.enabled) throw new AppError("Enable synchronisation first (after a successful connection test)", 409, "DISABLED");
  const { job, deduplicated } = await enqueueSync(c.id, body.type, "MANUAL", { fullResync: body.fullResync, requestedBy: user.id });
  await audit({ userId: user.id, action: "integration.sync_now", entityType: "SyncJob", entityId: job.id, summary: `Manual ${body.type.toLowerCase()} sync requested${body.fullResync ? " (full re-import)" : ""}`, ip });
  kickQueue();
  return { job, deduplicated };
});
