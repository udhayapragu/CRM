import { Prisma } from "@prisma/client";
import { apiRoute, parseBody } from "@/lib/api";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { commissionRuleSchema } from "@/lib/validation";
import { audit } from "@/server/audit";

export const GET = apiRoute({ permission: "mlm:view" }, async () => prisma.commissionRule.findMany({ orderBy: [{ level: "asc" }, { createdAt: "asc" }] }));

export const POST = apiRoute({ permission: "mlm:manage" }, async ({ req, user, ip }) => {
  const body = await parseBody(req, commissionRuleSchema);
  if (body.active && !body.legallyReviewed) throw new AppError("A rule can only be activated after it has been marked as legally reviewed", 400, "NOT_REVIEWED");
  const r = await prisma.commissionRule.create({
    data: { ...body, ratePercent: new Prisma.Decimal(body.ratePercent), reviewedAt: body.legallyReviewed ? new Date() : null },
  });
  await audit({ userId: user.id, action: "commission_rule.create", entityType: "CommissionRule", entityId: r.id, summary: `Rule "${r.name}" L${r.level} ${body.ratePercent}% (active ${r.active}, reviewed ${r.legallyReviewed})`, ip });
  return r;
});
