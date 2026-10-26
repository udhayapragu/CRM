/** Shared list/query functions used by server-rendered pages and the REST API. */
import type { InventoryCategory, OrderStatus, Prisma, Role } from "@prisma/client";
import { prisma } from "@/lib/db";
import { can } from "@/lib/auth/permissions";
import { notFound } from "@/lib/errors";
import { addDays, startOfDay } from "@/lib/utils";
import { delayedWhere } from "./orders";

export interface Paged {
  page?: number;
  pageSize?: number;
}

const pg = (p: Paged) => {
  const page = Math.max(1, Number(p.page) || 1);
  const pageSize = Math.min(100, Math.max(5, Number(p.pageSize) || 25));
  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize };
};

// ───────────── Orders ─────────────

export interface OrderListParams extends Paged {
  q?: string;
  status?: OrderStatus | "ATTENTION" | "DELAYED" | "";
  payment?: string;
  from?: string;
  to?: string;
  sort?: "orderDate" | "total" | "number" | "expectedDispatchDate";
  dir?: "asc" | "desc";
}

export function orderWhere(p: OrderListParams): Prisma.OrderWhereInput {
  const where: Prisma.OrderWhereInput = {};
  const and: Prisma.OrderWhereInput[] = [];
  if (p.q) {
    and.push({
      OR: [
        { number: { contains: p.q, mode: "insensitive" } },
        { customerName: { contains: p.q, mode: "insensitive" } },
        { items: { some: { OR: [{ sku: { contains: p.q, mode: "insensitive" } }, { name: { contains: p.q, mode: "insensitive" } }] } } },
        { shipments: { some: { trackingNumber: { contains: p.q, mode: "insensitive" } } } },
      ],
    });
  }
  if (p.status === "ATTENTION") and.push({ needsAttention: true });
  else if (p.status === "DELAYED") and.push(delayedWhere());
  else if (p.status) and.push({ status: p.status });
  if (p.payment) and.push({ paymentStatus: p.payment as Prisma.EnumPaymentStatusFilter["equals"] });
  if (p.from) and.push({ orderDate: { gte: startOfDay(new Date(p.from)) } });
  if (p.to) and.push({ orderDate: { lt: addDays(startOfDay(new Date(p.to)), 1) } });
  if (and.length) where.AND = and;
  return where;
}

export function redactOrder<T extends { customerEmail?: string | null; customerPhone?: string | null; billingAddress?: unknown; shippingAddress?: unknown }>(o: T, role: Role): T {
  if (can(role, "orders:view_pii")) return o;
  const addr = o.shippingAddress as Record<string, string> | null;
  return {
    ...o,
    customerEmail: o.customerEmail ? "•••• (restricted)" : null,
    customerPhone: o.customerPhone ? "•••• (restricted)" : null,
    billingAddress: null,
    shippingAddress: addr ? { city: addr.city, state: addr.state, country: addr.country } : null,
  };
}

export async function listOrders(p: OrderListParams, role: Role) {
  const { page, pageSize, skip, take } = pg(p);
  const where = orderWhere(p);
  const sortKey = p.sort ?? "orderDate";
  const [rows, total, statusCounts] = await Promise.all([
    prisma.order.findMany({
      where,
      orderBy: [{ [sortKey]: p.dir === "asc" ? "asc" : "desc" }, { id: "desc" }],
      skip,
      take,
      include: {
        items: { select: { id: true, name: true, sku: true, quantity: true } },
        shipments: { where: { status: { not: "CANCELLED" } }, select: { trackingNumber: true, courier: true, status: true }, take: 1, orderBy: { createdAt: "desc" } },
      },
    }),
    prisma.order.count({ where }),
    prisma.order.groupBy({ by: ["status"], _count: { _all: true } }),
  ]);
  const [attention, delayed] = await Promise.all([prisma.order.count({ where: { needsAttention: true } }), prisma.order.count({ where: delayedWhere() })]);
  return {
    rows: rows.map((r) => redactOrder(r, role)),
    total,
    page,
    pageSize,
    counts: { ...Object.fromEntries(statusCounts.map((s) => [s.status, s._count._all])), ATTENTION: attention, DELAYED: delayed } as Record<string, number>,
  };
}

export async function getOrderDetail(id: string, role: Role) {
  const order = await prisma.order.findUnique({
    where: { id },
    include: {
      items: { include: { product: { select: { id: true, name: true, imageUrl: true } }, reservations: { where: { status: "ACTIVE" } } } },
      events: { orderBy: { createdAt: "asc" }, include: { user: { select: { name: true } } } },
      shipments: { orderBy: { createdAt: "asc" }, include: { lines: { include: { orderItem: { select: { name: true } } } } } },
      returns: { include: { lines: { include: { orderItem: { select: { name: true } } } } } },
      memberSale: { include: { member: { select: { id: true, name: true, referralCode: true } } } },
      commissions: { include: { member: { select: { name: true } } } },
      connection: { select: { siteUrl: true } },
    },
  });
  if (!order) throw notFound("Order");
  return redactOrder(order, role);
}

// ───────────── Inventory ─────────────

export interface ItemListParams extends Paged {
  q?: string;
  category?: InventoryCategory | "";
  stock?: "low" | "out" | "ok" | "";
  archived?: string;
  sort?: "name" | "sku" | "qtyOnHand" | "lastMovementAt" | "category";
  dir?: "asc" | "desc";
}

export async function listInventoryItems(p: ItemListParams) {
  const { page, pageSize, skip, take } = pg(p);
  const where: Prisma.InventoryItemWhereInput = { active: p.archived === "1" ? false : true };
  if (p.q) where.OR = [{ name: { contains: p.q, mode: "insensitive" } }, { sku: { contains: p.q, mode: "insensitive" } }];
  if (p.category) where.category = p.category;
  if (p.stock) {
    const rows = await prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM "InventoryItem" WHERE
      CASE ${p.stock}::text
        WHEN 'out' THEN "qtyOnHand" <= 0
        WHEN 'low' THEN "qtyOnHand" > 0 AND "qtyOnHand" - "qtyReserved" <= "reorderLevel"
        ELSE "qtyOnHand" - "qtyReserved" > "reorderLevel" END`;
    where.id = { in: rows.map((r) => r.id) };
  }
  const sortKey = p.sort ?? "name";
  const [rows, total, byCategory] = await Promise.all([
    prisma.inventoryItem.findMany({ where, orderBy: [{ [sortKey]: p.dir === "desc" ? "desc" : "asc" }, { id: "asc" }], skip, take, include: { supplier: { select: { id: true, name: true } }, product: { select: { id: true, name: true } } } }),
    prisma.inventoryItem.count({ where }),
    prisma.inventoryItem.groupBy({ by: ["category"], where: { active: true }, _count: { _all: true }, _sum: { qtyOnHand: true } }),
  ]);
  return { rows, total, page, pageSize, byCategory };
}

export async function getInventoryItemDetail(id: string) {
  const item = await prisma.inventoryItem.findUnique({
    where: { id },
    include: {
      supplier: true,
      product: { select: { id: true, name: true, wpStockQuantity: true } },
      variant: { select: { id: true, name: true, wpStockQuantity: true } },
      stockLevels: { include: { location: true } },
      reservations: { where: { status: "ACTIVE" }, include: { order: { select: { id: true, number: true, customerName: true } } } },
      usedInRules: { include: { product: { select: { id: true, name: true } } } },
    },
  });
  if (!item) throw notFound("Inventory item");
  return item;
}

export async function listLedger(p: Paged & { itemId?: string; type?: string; q?: string; from?: string; to?: string }) {
  const { page, pageSize, skip, take } = pg(p);
  const where: Prisma.InventoryLedgerEntryWhereInput = {};
  if (p.itemId) where.itemId = p.itemId;
  if (p.type) where.type = p.type as Prisma.EnumLedgerTypeFilter["equals"];
  if (p.q) where.OR = [{ reason: { contains: p.q, mode: "insensitive" } }, { item: { name: { contains: p.q, mode: "insensitive" } } }, { item: { sku: { contains: p.q, mode: "insensitive" } } }];
  if (p.from || p.to) where.createdAt = { ...(p.from ? { gte: startOfDay(new Date(p.from)) } : {}), ...(p.to ? { lt: addDays(startOfDay(new Date(p.to)), 1) } : {}) };
  const [rows, total] = await Promise.all([
    prisma.inventoryLedgerEntry.findMany({ where, orderBy: { createdAt: "desc" }, skip, take, include: { item: { select: { id: true, name: true, sku: true, unit: true } }, user: { select: { name: true } }, location: { select: { code: true } } } }),
    prisma.inventoryLedgerEntry.count({ where }),
  ]);
  return { rows, total, page, pageSize };
}

// ───────────── Dispatch ─────────────

export type DispatchView = "to-pack" | "ready" | "awaiting-pickup" | "in-transit" | "dispatched-today" | "delivered" | "delayed";

export async function dispatchBoard(view: DispatchView, p: Paged & { q?: string; from?: string; to?: string }, role: Role) {
  const { page, pageSize, skip, take } = pg(p);
  const today = startOfDay();
  const now = new Date();
  const counts = {
    "to-pack": await prisma.order.count({ where: { status: { in: ["CONFIRMED", "PROCESSING", "READY_TO_PACK"] } } }),
    ready: await prisma.shipment.count({ where: { status: "PACKED" } }),
    "awaiting-pickup": await prisma.shipment.count({ where: { status: "AWAITING_PICKUP" } }),
    "in-transit": await prisma.shipment.count({ where: { status: "IN_TRANSIT" } }),
    "dispatched-today": await prisma.shipment.count({ where: { dispatchedAt: { gte: today } } }),
    delivered: await prisma.shipment.count({ where: { status: "DELIVERED", deliveredAt: { gte: addDays(today, -7) } } }),
    delayed:
      (await prisma.order.count({ where: delayedWhere(now) })) +
      (await prisma.shipment.count({ where: { status: { in: ["IN_TRANSIT", "AWAITING_PICKUP"] }, expectedDeliveryAt: { lt: now } } })),
  };

  const q = p.q ? { OR: [{ number: { contains: p.q, mode: "insensitive" as const } }, { customerName: { contains: p.q, mode: "insensitive" as const } }] } : {};
  if (view === "to-pack") {
    const where: Prisma.OrderWhereInput = { status: { in: ["CONFIRMED", "PROCESSING", "READY_TO_PACK"] }, ...q };
    const [rows, total] = await Promise.all([
      prisma.order.findMany({ where, orderBy: [{ expectedDispatchDate: "asc" }], skip, take, include: { items: true } }),
      prisma.order.count({ where }),
    ]);
    return { kind: "orders" as const, rows: rows.map((r) => redactOrder(r, role)), total, page, pageSize, counts };
  }
  if (view === "delayed") {
    const where: Prisma.OrderWhereInput = { ...delayedWhere(now), ...q };
    const [orders, shipments] = await Promise.all([
      prisma.order.findMany({ where, orderBy: { expectedDispatchDate: "asc" }, take: 100, include: { items: true } }),
      prisma.shipment.findMany({ where: { status: { in: ["IN_TRANSIT", "AWAITING_PICKUP"] }, expectedDeliveryAt: { lt: now } }, include: { order: true, lines: { include: { orderItem: true } } }, take: 100 }),
    ]);
    return { kind: "delayed" as const, orders: orders.map((r) => redactOrder(r, role)), shipments: shipments.map((s) => ({ ...s, order: redactOrder(s.order, role) })), total: orders.length + shipments.length, page: 1, pageSize: 200, counts };
  }
  const sWhere: Prisma.ShipmentWhereInput =
    view === "ready"
      ? { status: "PACKED" }
      : view === "awaiting-pickup"
        ? { status: "AWAITING_PICKUP" }
        : view === "in-transit"
          ? { status: "IN_TRANSIT" }
          : view === "delivered"
            ? { status: "DELIVERED", deliveredAt: { gte: p.from ? startOfDay(new Date(p.from)) : addDays(today, -7), ...(p.to ? { lt: addDays(startOfDay(new Date(p.to)), 1) } : {}) } }
            : { dispatchedAt: { gte: p.from ? startOfDay(new Date(p.from)) : today, ...(p.to ? { lt: addDays(startOfDay(new Date(p.to)), 1) } : {}) } };
  if (p.q) sWhere.OR = [{ trackingNumber: { contains: p.q, mode: "insensitive" } }, { order: q }];
  const [rows, total] = await Promise.all([
    prisma.shipment.findMany({ where: sWhere, orderBy: { createdAt: "desc" }, skip, take, include: { order: true, lines: { include: { orderItem: true } } } }),
    prisma.shipment.count({ where: sWhere }),
  ]);
  return { kind: "shipments" as const, rows: rows.map((s) => ({ ...s, order: redactOrder(s.order, role) })), total, page, pageSize, counts };
}

// ───────────── Audit ─────────────

export async function listAudit(p: Paged & { q?: string; entityType?: string; userId?: string }) {
  const { page, pageSize, skip, take } = pg(p);
  const where: Prisma.AuditLogWhereInput = {};
  if (p.q) where.OR = [{ summary: { contains: p.q, mode: "insensitive" } }, { action: { contains: p.q, mode: "insensitive" } }];
  if (p.entityType) where.entityType = p.entityType;
  if (p.userId) where.userId = p.userId;
  const [rows, total] = await Promise.all([
    prisma.auditLog.findMany({ where, orderBy: { createdAt: "desc" }, skip, take, include: { user: { select: { name: true, email: true } } } }),
    prisma.auditLog.count({ where }),
  ]);
  return { rows, total, page, pageSize };
}
