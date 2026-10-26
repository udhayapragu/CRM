import { apiRoute, parseBody } from "@/lib/api";
import { prisma } from "@/lib/db";
import { payoutSchema } from "@/lib/validation";
import { createPayout } from "@/server/services/mlm";

export const GET = apiRoute({ permission: "mlm:view" }, async () => prisma.payout.findMany({ orderBy: { paidAt: "desc" }, take: 200, include: { member: { select: { name: true, referralCode: true } }, _count: { select: { commissions: true } } } }));

export const POST = apiRoute({ permission: "mlm:pay" }, async ({ req, user }) => {
  const body = await parseBody(req, payoutSchema);
  return createPayout(body.memberId, body.reference, user.id);
});
