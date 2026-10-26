import type { Order, OrderStatus, PaymentStatus, Prisma } from "@prisma/client";
import { prisma, type Tx } from "@/lib/db";
import { AppError, notFound } from "@/lib/errors";
import { audit } from "@/server/audit";
import { releaseOrderReservations, reserveStock, resolveProductItem, withLedgerTx } from "./inventory-ledger";
import { notify } from "./notifications";

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  NEW: "New",
  PENDING_PAYMENT: "Pending Payment",
  CONFIRMED: "Confirmed",
  PROCESSING: "Processing",
  READY_TO_PACK: "Ready to Pack",
  READY_TO_DISPATCH: "Ready to Dispatch",
  DISPATCHED: "Dispatched",
  DELIVERED: "Delivered",
  ON_HOLD: "On Hold",
  CANCELLED: "Cancelled",
  RETURNED: "Returned",
};

export const PRE_DISPATCH: OrderStatus[] = ["NEW", "PENDING_PAYMENT", "CONFIRMED", "PROCESSING", "READY_TO_PACK", "READY_TO_DISPATCH", "ON_HOLD"];
export const OPEN_FOR_FULFILMENT: OrderStatus[] = ["CONFIRMED", "PROCESSING", "READY_TO_PACK", "READY_TO_DISPATCH"];
const RESERVING: OrderStatus[] = ["CONFIRMED", "PROCESSING", "READY_TO_PACK", "READY_TO_DISPATCH", "ON_HOLD", "DISPATCHED"];

/**
 * Manual transitions an authorised user may make from the order screen.
 * DISPATCHED, DELIVERED and RETURNED are deliberately absent: they can only be reached through the
 * dispatch / delivery / returns workflows (or confirmed by the connected source).
 */
export const MANUAL_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  NEW: ["CONFIRMED", "PENDING_PAYMENT", "ON_HOLD", "CANCELLED"],
  PENDING_PAYMENT: ["CONFIRMED", "ON_HOLD", "CANCELLED"],
  CONFIRMED: ["PROCESSING", "READY_TO_PACK", "ON_HOLD", "CANCELLED"],
  PROCESSING: ["READY_TO_PACK", "ON_HOLD", "CANCELLED"],
  READY_TO_PACK: ["PROCESSING", "ON_HOLD", "CANCELLED"],
  READY_TO_DISPATCH: ["READY_TO_PACK", "ON_HOLD", "CANCELLED"],
  DISPATCHED: [],
  DELIVERED: [],
  ON_HOLD: ["NEW", "CONFIRMED", "PROCESSING", "READY_TO_PACK", "CANCELLED"],
  CANCELLED: [],
  RETURNED: [],
};

export function shouldReserve(o: Pick<Order, "status" | "paymentStatus">) {
  if (RESERVING.includes(o.status)) return true;
  return o.status === "NEW" && o.paymentStatus === "PAID";
}

export async function addOrderEvent(
  tx: Tx,
  e: { orderId: string; type: string; message: string; actor: "USER" | "SYNC" | "WEBHOOK" | "SYSTEM"; userId?: string | null; fromValue?: string | null; toValue?: string | null },
) {
  await tx.orderEvent.create({
    data: {
      orderId: e.orderId,
      type: e.type,
      message: e.message.slice(0, 1000),
      actor: e.actor,
      userId: e.userId ?? null,
      fromValue: e.fromValue ?? null,
      toValue: e.toValue ?? null,
    },
  });
}

/** Bring stock reservations in line with the order's current state. Safe to call repeatedly. */
export async function syncOrderReservations(tx: Tx, orderId: string) {
  const order = await tx.order.findUniqueOrThrow({ where: { id: orderId }, include: { items: true } });
  if (order.status === "CANCELLED" || order.status === "RETURNED" || order.status === "DELIVERED") {
    await releaseOrderReservations(tx, orderId);
    return;
  }
  const reserve = shouldReserve(order);
  for (const line of order.items) {
    const item = await resolveProductItem(tx, line.productId, line.variantId);
    if (!item) continue;
    const outstanding = reserve ? Math.max(0, line.quantity - line.dispatchedQty) : 0;
    await reserveStock(tx, { itemId: item.id, orderId, orderItemId: line.id, quantity: outstanding });
  }
}

export async function changeOrderStatus(
  orderId: string,
  to: OrderStatus,
  opts: { userId: string; note?: string; ip?: string | null },
) {
  return withLedgerTx(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${orderId} FOR UPDATE`;
    const order = await tx.order.findUnique({ where: { id: orderId }, include: { shipments: true } });
    if (!order) throw notFound("Order");
    if (order.status === to) return order;
    if (!MANUAL_TRANSITIONS[order.status].includes(to)) {
      throw new AppError(
        `Cannot change status from ${ORDER_STATUS_LABELS[order.status]} to ${ORDER_STATUS_LABELS[to]} manually` +
          (["DISPATCHED", "DELIVERED", "RETURNED"].includes(to) ? " — use the Dispatch or Returns workflow." : "."),
        409,
        "INVALID_TRANSITION",
      );
    }
    if (to === "CANCELLED" && order.shipments.some((s) => s.dispatchedAt)) {
      throw new AppError("Order has dispatched shipments; record a return instead of cancelling.", 409, "ALREADY_DISPATCHED");
    }
    const data: Prisma.OrderUpdateInput = { status: to };
    if (to === "CANCELLED") {
      // Packed but undispatched shipments are cancelled and packed counts released.
      for (const s of order.shipments.filter((s) => s.status === "PACKED")) {
        const lines = await tx.shipmentLine.findMany({ where: { shipmentId: s.id } });
        for (const l of lines) await tx.orderItem.update({ where: { id: l.orderItemId }, data: { packedQty: { decrement: l.quantity } } });
        await tx.shipment.update({ where: { id: s.id }, data: { status: "CANCELLED" } });
      }
      data.shippingStatus = "NOT_SHIPPED";
      data.needsAttention = false;
      data.attentionReason = null;
    }
    const updated = await tx.order.update({ where: { id: orderId }, data });
    await addOrderEvent(tx, {
      orderId,
      type: "STATUS",
      fromValue: order.status,
      toValue: to,
      actor: "USER",
      userId: opts.userId,
      message: `Status changed to ${ORDER_STATUS_LABELS[to]}${opts.note ? ` — ${opts.note}` : ""}`,
    });
    await syncOrderReservations(tx, orderId);
    await audit(
      { userId: opts.userId, action: "order.status", entityType: "Order", entityId: orderId, summary: `Order #${order.number}: ${order.status} → ${to}`, ip: opts.ip },
      tx,
    );
    return updated;
  });
}

export async function changePaymentStatus(orderId: string, to: PaymentStatus, opts: { userId: string; note?: string; ip?: string | null }) {
  return withLedgerTx(async (tx) => {
    const order = await tx.order.findUnique({ where: { id: orderId } });
    if (!order) throw notFound("Order");
    if (order.paymentStatus === to) return order;
    const updated = await tx.order.update({
      where: { id: orderId },
      data: { paymentStatus: to, paidAt: to === "PAID" ? order.paidAt ?? new Date() : order.paidAt },
    });
    await addOrderEvent(tx, {
      orderId,
      type: "PAYMENT",
      fromValue: order.paymentStatus,
      toValue: to,
      actor: "USER",
      userId: opts.userId,
      message: `Payment status set to ${to.replace(/_/g, " ").toLowerCase()}${opts.note ? ` — ${opts.note}` : ""}`,
    });
    await syncOrderReservations(tx, orderId);
    await audit(
      { userId: opts.userId, action: "order.payment", entityType: "Order", entityId: orderId, summary: `Order #${order.number}: payment ${order.paymentStatus} → ${to}`, ip: opts.ip },
      tx,
    );
    return updated;
  });
}

export async function updateOrderDetails(
  orderId: string,
  patch: { expectedDispatchDate?: Date | null; internalNotes?: string | null },
  opts: { userId: string; ip?: string | null },
) {
  return prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({ where: { id: orderId } });
    if (!order) throw notFound("Order");
    const updated = await tx.order.update({ where: { id: orderId }, data: patch });
    await audit({ userId: opts.userId, action: "order.update", entityType: "Order", entityId: orderId, summary: `Order #${order.number} details updated`, metadata: { fields: Object.keys(patch) }, ip: opts.ip }, tx);
    return updated;
  });
}

export async function addOrderNote(orderId: string, note: string, userId: string) {
  const order = await prisma.order.findUnique({ where: { id: orderId }, select: { id: true } });
  if (!order) throw notFound("Order");
  await addOrderEvent(prisma, { orderId, type: "NOTE", message: note, actor: "USER", userId });
}

export async function resolveAttention(orderId: string, userId: string) {
  await prisma.$transaction(async (tx) => {
    const o = await tx.order.update({ where: { id: orderId }, data: { needsAttention: false, attentionReason: null } });
    await addOrderEvent(tx, { orderId, type: "NOTE", message: "Attention flag resolved", actor: "USER", userId });
    await audit({ userId, action: "order.attention_resolved", entityType: "Order", entityId: orderId, summary: `Order #${o.number} attention resolved` }, tx);
  });
}

export async function flagAttention(tx: Tx, order: Pick<Order, "id" | "number" | "isDemo">, reason: string) {
  await tx.order.update({ where: { id: order.id }, data: { needsAttention: true, attentionReason: reason.slice(0, 500) } });
  await notify(
    {
      type: "ORDER_ATTENTION",
      severity: "warning",
      title: `Order #${order.number} needs attention`,
      message: reason,
      link: `/orders/${order.id}`,
      dedupeKey: `attn:${order.id}:${reason.slice(0, 60)}`,
      isDemo: order.isDemo,
    },
    tx,
  );
}

/** Orders that are past their expected dispatch date but not yet dispatched. */
export function delayedWhere(now = new Date()): Prisma.OrderWhereInput {
  return {
    status: { in: ["NEW", "CONFIRMED", "PROCESSING", "READY_TO_PACK", "READY_TO_DISPATCH"] },
    expectedDispatchDate: { lt: now },
  };
}
