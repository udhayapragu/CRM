import { apiRoute } from "@/lib/api";
import { prisma } from "@/lib/db";
import { hasRunnableJob, kickQueue } from "@/server/integrations/wordpress/job-runner";

export const maxDuration = 60;

export const GET = apiRoute({ permission: "integration:view" }, async () => {
  // While someone watches the sync page, keep a paused/queued import moving (serverless hosts have no worker).
  if (await hasRunnableJob()) kickQueue();
  const jobs = await prisma.syncJob.findMany({ orderBy: { createdAt: "desc" }, take: 30 });
  const webhooks = await prisma.webhookEvent.findMany({ orderBy: { receivedAt: "desc" }, take: 20 });
  return { jobs, webhooks };
});
