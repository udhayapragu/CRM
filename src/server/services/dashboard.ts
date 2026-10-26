/** Dashboard metrics — every number is computed from the database (synchronised + CRM data). */
import { Prisma, type OrderStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { addDays, dayKey, startOfDay, toNumber } from "@/lib/utils";
import { delayedWhere, ORDER_STATUS_LABELS } from "./orders";

export const BUSINESS_TZ = process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

const SALE_PAYMENT = ["PAID", "PARTIALLY_REFUNDED"] as const;
export const PENDING_STATUSES: OrderStatus[] = ["NEW", "PENDING_PAYMENT", "CONFIRMED", "ON_HOLD"];
export const PROCESSING_STATUSES: OrderStatus[] = ["PROCESSING", "READY_TO_PACK", "READY_TO_DISPATCH"];

/** Local-time bucket expression for a UTC timestamp column. */
function bucket(unit: "day" | "week" | "month", column: Prisma.Sql) {
  return Prisma.sql`date_trunc(${unit}, (${column} AT TIME ZONE 'UTC') AT TIME ZONE ${BUSINESS_TZ})`;
}

export async function getKpis() {
  const today = startOfDay();
  const [
    totalProducts,
    totalOrders,
    todaysOrders,
    dispatchedTodayRows,
    statusGroups,
    stockAgg,
    lowOut,
    packaging,
    onboarding,
    todaySales,
    totalSales,
  ] = await Promise.all([
    prisma.product.count({ where: { deletedAtSource: null } }),
    prisma.order.count(),
    prisma.order.count({ where: { orderDate: { gte: today } } }),
    prisma.shipment.findMany({ where: { dispatchedAt: { gte: today } }, select: { orderId: true }, distinct: ["orderId"] }),
    prisma.order.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.inventoryItem.aggregate({ where: { category: "PRODUCT", active: true }, _sum: { qtyOnHand: true, qtyReserved: true } }),
    prisma.$queryRaw<{ low: number; out: number }[]>`
      SELECT COUNT(*) FILTER (WHERE "qtyOnHand" > 0 AND "qtyOnHand" - "qtyReserved" <= "reorderLevel")::int AS low,
             COUNT(*) FILTER (WHERE "qtyOnHand" <= 0)::int AS out
      FROM "InventoryItem" WHERE active`,
    prisma.inventoryItem.aggregate({ where: { category: { not: "PRODUCT" }, active: true }, _sum: { qtyOnHand: true }, _count: { _all: true } }),
    prisma.onboardingItem.groupBy({ by: ["stageId"], _count: { _all: true } }),
    prisma.order.aggregate({ where: { orderDate: { gte: today }, paymentStatus: { in: [...SALE_PAYMENT] } }, _sum: { total: true, refundedTotal: true } }),
    prisma.order.aggregate({ where: { paymentStatus: { in: [...SALE_PAYMENT] } }, _sum: { total: true, refundedTotal: true } }),
  ]);
  const stages = await prisma.onboardingStage.findMany();
  const stageKey = new Map(stages.map((s) => [s.id, s.key]));
  const byStage = (keys: string[]) => onboarding.filter((g) => keys.includes(stageKey.get(g.stageId) ?? "")).reduce((s, g) => s + g._count._all, 0);
  const notAwaiting = ["READY_FOR_ONBOARDING", "ONBOARDING_IN_PROGRESS", "LIVE", "REJECTED_ON_HOLD"];
  const awaiting = onboarding.filter((g) => !notAwaiting.includes(stageKey.get(g.stageId) ?? "")).reduce((s, g) => s + g._count._all, 0);
  const count = (statuses: OrderStatus[]) => statusGroups.filter((g) => statuses.includes(g.status)).reduce((s, g) => s + g._count._all, 0);

  return {
    totalProducts,
    totalOrders,
    todaysOrders,
    dispatchedToday: dispatchedTodayRows.length,
    pendingOrders: count(PENDING_STATUSES),
    processingOrders: count(PROCESSING_STATUSES),
    deliveredOrders: count(["DELIVERED"]),
    cancelledOrders: count(["CANCELLED"]),
    totalAvailableStock: (stockAgg._sum.qtyOnHand ?? 0) - (stockAgg._sum.qtyReserved ?? 0),
    lowStockItems: lowOut[0]?.low ?? 0,
    outOfStockItems: lowOut[0]?.out ?? 0,
    readyForOnboarding: byStage(["READY_FOR_ONBOARDING"]),
    awaitingOnboarding: awaiting,
    packagingUnits: packaging._sum.qtyOnHand ?? 0,
    packagingSkus: packaging._count._all,
    todaysSales: toNumber(todaySales._sum.total) - toNumber(todaySales._sum.refundedTotal),
    totalRevenue: toNumber(totalSales._sum.total) - toNumber(totalSales._sum.refundedTotal),
  };
}

export async function getCharts() {
  const today = startOfDay();
  const from14 = addDays(today, -13);
  const [ordersDaily, dispatchDaily, weekly, monthly, statusGroups, stockItems, fast] = await Promise.all([
    prisma.$queryRaw<{ d: Date; n: number }[]>`
      SELECT ${bucket("day", Prisma.sql`"orderDate"`)} AS d, COUNT(*)::int AS n FROM "Order"
      WHERE "orderDate" >= ${from14} GROUP BY 1 ORDER BY 1`,
    prisma.$queryRaw<{ d: Date; n: number }[]>`
      SELECT ${bucket("day", Prisma.sql`"dispatchedAt"`)} AS d, COUNT(DISTINCT "orderId")::int AS n FROM "Shipment"
      WHERE "dispatchedAt" >= ${from14} GROUP BY 1 ORDER BY 1`,
    prisma.$queryRaw<{ d: Date; total: number; n: number }[]>`
      SELECT ${bucket("week", Prisma.sql`"orderDate"`)} AS d, COALESCE(SUM(total - "refundedTotal"),0)::float AS total, COUNT(*)::int AS n FROM "Order"
      WHERE "orderDate" >= ${addDays(today, -7 * 12)} AND "paymentStatus" IN ('PAID','PARTIALLY_REFUNDED') GROUP BY 1 ORDER BY 1`,
    prisma.$queryRaw<{ d: Date; total: number; n: number }[]>`
      SELECT ${bucket("month", Prisma.sql`"orderDate"`)} AS d, COALESCE(SUM(total - "refundedTotal"),0)::float AS total, COUNT(*)::int AS n FROM "Order"
      WHERE "orderDate" >= ${addDays(today, -365)} AND "paymentStatus" IN ('PAID','PARTIALLY_REFUNDED') GROUP BY 1 ORDER BY 1`,
    prisma.order.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.inventoryItem.findMany({
      where: { active: true },
      orderBy: [{ qtyOnHand: "asc" }],
      take: 12,
      select: { id: true, name: true, sku: true, category: true, qtyOnHand: true, qtyReserved: true, reorderLevel: true },
    }),
    prisma.$queryRaw<{ name: string; productId: string | null; qty: number }[]>`
      SELECT COALESCE(p.name, oi.name) AS name, oi."productId", SUM(oi.quantity)::int AS qty
      FROM "OrderItem" oi JOIN "Order" o ON o.id = oi."orderId"
      LEFT JOIN "Product" p ON p.id = oi."productId"
      WHERE o."orderDate" >= ${addDays(today, -30)} AND o.status NOT IN ('CANCELLED')
      GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 8`,
  ]);

  const days: { day: string; label: string; orders: number; dispatches: number }[] = [];
  for (let i = 0; i < 14; i++) {
    const d = addDays(from14, i);
    days.push({ day: dayKey(d), label: d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" }), orders: 0, dispatches: 0 });
  }
  const idx = new Map(days.map((d, i) => [d.day, i]));
  for (const r of ordersDaily) {
    const i = idx.get(dayKey(new Date(r.d)));
    if (i !== undefined) days[i].orders = r.n;
  }
  for (const r of dispatchDaily) {
    const i = idx.get(dayKey(new Date(r.d)));
    if (i !== undefined) days[i].dispatches = r.n;
  }

  return {
    daily: days,
    weekly: weekly.map((w) => ({ label: new Date(w.d).toLocaleDateString("en-IN", { day: "2-digit", month: "short" }), total: Math.round(w.total), orders: w.n })),
    monthly: monthly.map((m) => ({ label: new Date(m.d).toLocaleDateString("en-IN", { month: "short", year: "2-digit" }), total: Math.round(m.total), orders: m.n })),
    statusDistribution: statusGroups
      .map((g) => ({ status: g.status, label: ORDER_STATUS_LABELS[g.status], value: g._count._all }))
      .sort((a, b) => b.value - a.value),
    stockLevels: stockItems.map((s) => ({ name: s.name.length > 22 ? s.name.slice(0, 21) + "…" : s.name, sku: s.sku, available: s.qtyOnHand - s.qtyReserved, reorder: s.reorderLevel, onHand: s.qtyOnHand })),
    fastMoving: fast.map((f) => ({ name: f.name.length > 26 ? f.name.slice(0, 25) + "…" : f.name, productId: f.productId, qty: f.qty })),
    lowStockTrend: await lowStockTrend(30),
  };
}

/**
 * Number of inventory items at/below reorder level at the end of each of the last N days,
 * reconstructed from the immutable ledger (uses current reorder levels; ignores reservations).
 */
export async function lowStockTrend(daysBack: number) {
  const today = startOfDay();
  const from = addDays(today, -(daysBack - 1));
  const items = await prisma.inventoryItem.findMany({ where: { active: true }, select: { id: true, qtyOnHand: true, reorderLevel: true, createdAt: true } });
  if (!items.length) return [];
  const entries = await prisma.inventoryLedgerEntry.findMany({ where: { createdAt: { gte: from } }, select: { itemId: true, quantity: true, createdAt: true } });
  // Walk backwards from current balances.
  const balance = new Map(items.map((i) => [i.id, i.qtyOnHand]));
  const byDay = new Map<string, { itemId: string; quantity: number }[]>();
  for (const e of entries) {
    const k = dayKey(e.createdAt);
    if (!byDay.has(k)) byDay.set(k, []);
    byDay.get(k)!.push(e);
  }
  const out: { label: string; low: number }[] = [];
  for (let i = 0; i < daysBack; i++) {
    const d = addDays(today, -i);
    const k = dayKey(d);
    const endOfDay = addDays(d, 1);
    const low = items.filter((it) => it.createdAt < endOfDay && (balance.get(it.id) ?? 0) <= it.reorderLevel).length;
    out.push({ label: d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" }), low });
    // Undo this day's movements to get the previous day's closing balance.
    for (const e of byDay.get(k) ?? []) balance.set(e.itemId, (balance.get(e.itemId) ?? 0) - e.quantity);
  }
  return out.reverse();
}

export async function getActivityFeed(limit = 15) {
  const [events, ledger] = await Promise.all([
    prisma.orderEvent.findMany({ orderBy: { createdAt: "desc" }, take: limit, include: { order: { select: { id: true, number: true } }, user: { select: { name: true } } } }),
    prisma.inventoryLedgerEntry.findMany({ orderBy: { createdAt: "desc" }, take: limit, include: { item: { select: { id: true, name: true, unit: true } }, user: { select: { name: true } } } }),
  ]);
  const feed = [
    ...events.map((e) => ({ id: `e-${e.id}`, kind: "order" as const, at: e.createdAt, title: `Order #${e.order.number}`, message: e.message, href: `/orders/${e.order.id}`, actor: e.user?.name ?? e.actor })),
    ...ledger.map((l) => ({ id: `l-${l.id}`, kind: "stock" as const, at: l.createdAt, title: `${l.item.name}: ${l.quantity > 0 ? "+" : ""}${l.quantity} ${l.item.unit}`, message: `${l.type.replace("_", " ").toLowerCase()} — ${l.reason}`, href: `/inventory/${l.item.id}`, actor: l.user?.name ?? "System" })),
  ];
  return feed.sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, limit);
}

export async function getAttentionOrders(limit = 8) {
  const orders = await prisma.order.findMany({
    where: { OR: [{ needsAttention: true }, delayedWhere()] },
    orderBy: [{ needsAttention: "desc" }, { expectedDispatchDate: "asc" }],
    take: limit,
    select: { id: true, number: true, customerName: true, status: true, expectedDispatchDate: true, needsAttention: true, attentionReason: true, total: true, currency: true, isDemo: true },
  });
  const now = Date.now();
  return orders.map((o) => ({
    ...o,
    reason: o.attentionReason ?? (o.expectedDispatchDate && o.expectedDispatchDate.getTime() < now ? "Past expected dispatch date" : "Needs review"),
  }));
}
