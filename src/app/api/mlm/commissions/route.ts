import { apiRoute, parseBody } from "@/lib/api";
import { prisma } from "@/lib/db";
import { commissionActionSchema } from "@/lib/validation";
import { setCommissionStatus } from "@/server/services/mlm";

export const GET = apiRoute({ permission: "mlm:view" }, async ({ req }) => {
  const status = req.nextUrl.searchParams.get("status") || undefined;
  return prisma.commission.findMany({
    where: status ? { status: status as never } : {},
    orderBy: { createdAt: "desc" },
    take: 300,
    include: { member: { select: { id: true, name: true, referralCode: true } }, order: { select: { id: true, number: true } }, rule: { select: { name: true } } },
  });
});

export const POST = apiRoute({ permission: "mlm:approve" }, async ({ req, user }) => {
  const body = await parseBody(req, commissionActionSchema);
  return { changed: await setCommissionStatus(body.ids, body.to, user.id) };
});
