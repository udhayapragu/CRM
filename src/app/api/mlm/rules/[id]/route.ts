import { Prisma } from "@prisma/client";
import { apiRoute, parseBody } from "@/lib/api";
import { prisma } from "@/lib/db";
import { AppError, notFound } from "@/lib/errors";
import { commissionRuleSchema } from "@/lib/validation";
import { audit } from "@/server/audit";

export const PATCH = apiRoute<{ id: string }>({ permission: "mlm:manage" }, async ({ req, params, user, ip }) => {
  const body = await parseBody(req, commissionRuleSchema.partial());
  const before = await prisma.commissionRule.findUnique({ where: { id: params.id } });
  if (!before) throw notFound("Rule");
  const reviewed = body.legallyReviewed ?? before.legallyReviewed;
  const active = body.active ?? before.active;
  if (active && !reviewed) throw new AppError("A rule can only be active once marked as legally reviewed", 400, "NOT_REVIEWED");
  const r = await prisma.commissionRule.update({
    where: { id: params.id },
    data: {
      ...body,
      ...(body.ratePercent !== undefined ? { ratePercent: new Prisma.Decimal(body.ratePercent) } : {}),
      ...(body.legallyReviewed && !before.legallyReviewed ? { reviewedAt: new Date() } : {}),
      ...(body.legallyReviewed === false ? { active: false } : {}),
    },
  });
  await audit({ userId: user.id, action: "commission_rule.update", entityType: "CommissionRule", entityId: r.id, summary: `Rule "${r.name}" updated (active ${r.active}, reviewed ${r.legallyReviewed})`, ip });
  return r;
});
