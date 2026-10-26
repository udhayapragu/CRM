import { apiRoute } from "@/lib/api";
import { prisma } from "@/lib/db";
import { notFound } from "@/lib/errors";

export const GET = apiRoute<{ id: string }>({ permission: "integration:view" }, async ({ params }) => {
  const job = await prisma.syncJob.findUnique({ where: { id: params.id }, include: { logs: { orderBy: { createdAt: "asc" }, take: 500 } } });
  if (!job) throw notFound("Job");
  return job;
});
