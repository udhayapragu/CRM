import { apiRoute } from "@/lib/api";
import { prisma } from "@/lib/db";

export const GET = apiRoute({ permission: "integration:view" }, async () => {
  const jobs = await prisma.syncJob.findMany({ orderBy: { createdAt: "desc" }, take: 30 });
  const webhooks = await prisma.webhookEvent.findMany({ orderBy: { receivedAt: "desc" }, take: 20 });
  return { jobs, webhooks };
});
