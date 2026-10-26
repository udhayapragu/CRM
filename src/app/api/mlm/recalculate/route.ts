import { apiRoute } from "@/lib/api";
import { prisma } from "@/lib/db";
import { assertMlmEnabled, recalculateOrderCommissions } from "@/server/services/mlm";
import { audit } from "@/server/audit";

/** Re-run commission calculation for all attributed orders (idempotent). */
export const POST = apiRoute({ permission: "mlm:manage" }, async ({ user }) => {
  await assertMlmEnabled();
  const sales = await prisma.memberSale.findMany({ select: { orderId: true } });
  for (const s of sales) await prisma.$transaction((tx) => recalculateOrderCommissions(tx, s.orderId));
  await audit({ userId: user.id, action: "commission.recalculate", entityType: "Commission", summary: `Recalculated commissions for ${sales.length} order(s)` });
  return { orders: sales.length };
});
