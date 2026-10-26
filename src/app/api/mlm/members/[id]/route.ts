import { apiRoute, parseBody } from "@/lib/api";
import { prisma } from "@/lib/db";
import { notFound } from "@/lib/errors";
import { toNumber } from "@/lib/utils";
import { memberUpdateSchema } from "@/lib/validation";
import { audit } from "@/server/audit";
import { memberTree } from "@/server/services/mlm";

export const GET = apiRoute<{ id: string }>({ permission: "mlm:view" }, async ({ params }) => {
  const member = await prisma.member.findUnique({
    where: { id: params.id },
    include: { sponsor: { select: { id: true, name: true, referralCode: true } }, sales: { include: { order: { select: { id: true, number: true, total: true, status: true, orderDate: true } } } }, commissions: { orderBy: { createdAt: "desc" }, take: 100 }, payouts: { orderBy: { paidAt: "desc" } } },
  });
  if (!member) throw notFound("Member");
  const sum = (s: string[]) => member.commissions.filter((c) => s.includes(c.status)).reduce((a, c) => a + toNumber(c.amount), 0);
  return { member, tree: await memberTree(member.id, 3), totals: { pending: sum(["PENDING"]), approved: sum(["APPROVED"]), paid: sum(["PAID"]), sales: member.sales.reduce((a, s) => a + toNumber(s.order.total), 0) } };
});

export const PATCH = apiRoute<{ id: string }>({ permission: "mlm:manage" }, async ({ req, params, user, ip }) => {
  const body = await parseBody(req, memberUpdateSchema);
  const before = await prisma.member.findUnique({ where: { id: params.id } });
  if (!before) throw notFound("Member");
  const m = await prisma.member.update({ where: { id: params.id }, data: { ...body, ...(body.status === "ACTIVE" && !before.activatedAt ? { activatedAt: new Date() } : {}) } });
  await audit({ userId: user.id, action: "member.update", entityType: "Member", entityId: m.id, summary: `Member ${m.name} updated${body.status ? ` (status ${body.status})` : ""}`, ip });
  return m;
});
