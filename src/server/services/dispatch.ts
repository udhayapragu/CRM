/**
 * Dispatch & fulfilment workflow.
 *
 *  pack  → creates a Shipment (PACKED) and increments packedQty.            No stock change.
 *  dispatch → records courier/tracking; posts DISPATCH ledger entries for the product and
 *             CONSUMPTION entries for packaging per consumption rules.     Stock leaves here, once.
 *  pickup / deliver → status only (deliver requires an authorised user confirmation).
 *  return → RETURN entries (and DAMAGE for written-off units).
 *
 * Double-deduction protection: the shipment row is locked, `dispatchedAt` may only be set once,
 * every ledger entry carries a deterministic idempotency key, and DB CHECK constraints keep
 * dispatchedQty ≤ packedQty ≤ quantity.
 */
import type { ShipmentStatus } from "@prisma/client";
import { type Tx } from "@/lib/db";
import { AppError, notFound } from "@/lib/errors";
import { audit } from "@/server/audit";
import { consumeReservation, postLedgerEntry, resolveProductItem, withLedgerTx } from "./inventory-ledger";
import { addOrderEvent, syncOrderReservations } from "./orders";
import { onOrderFulfilmentChanged } from "./mlm-hooks";

interface Actor {
  userId: string;
  ip?: string | null;
}

async function lockOrder(tx: Tx, orderId: string) {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "Order" WHERE id = ${orderId} FOR UPDATE`;
  if (!rows.length) throw notFound("Order");
}

export async function packOrder(
  orderId: string,
  input: { lines: { orderItemId: string; quantity: number }[]; notes?: string },
  actor: Actor,
) {
  return withLedgerTx(async (tx) => {
    await lockOrder(tx, orderId);
    const order = await tx.order.findUniqueOrThrow({ where: { id: orderId }, include: { items: true } });
    if (!["CONFIRMED", "PROCESSING", "READY_TO_PACK", "READY_TO_DISPATCH"].includes(order.status)) {
      throw new AppError("Only confirmed or processing orders can be packed.", 409, "INVALID_STATE");
    }
    const lines = input.lines.filter((l) => l.quantity > 0);
    if (!lines.length) throw new AppError("Enter a packed quantity for at least one item", 400, "NO_LINES");
    for (const l of lines) {
      const item = order.items.find((i) => i.id === l.orderItemId);
      if (!item) throw new AppError("Item does not belong to this order", 400, "BAD_LINE");
      if (!Number.isInteger(l.quantity)) throw new AppError("Quantities must be whole numbers", 400, "INVALID_QTY");
      if (item.packedQty + l.quantity > item.quantity) {
        throw new AppError(`Cannot pack ${l.quantity} × ${item.name}: only ${item.quantity - item.packedQty} left to pack`, 409, "OVER_PACK");
      }
    }
    const shipment = await tx.shipment.create({
      data: {
        orderId,
        status: "PACKED",
        packedById: actor.userId,
        notes: input.notes ?? null,
        isDemo: order.isDemo,
        lines: { create: lines.map((l) => ({ orderItemId: l.orderItemId, quantity: l.quantity })) },
      },
    });
    for (const l of lines) await tx.orderItem.update({ where: { id: l.orderItemId }, data: { packedQty: { increment: l.quantity } } });

    const items = await tx.orderItem.findMany({ where: { orderId } });
    const fullyPacked = items.every((i) => i.packedQty >= i.quantity);
    await tx.order.update({
      where: { id: orderId },
      data: { status: fullyPacked ? "READY_TO_DISPATCH" : "READY_TO_PACK", shippingStatus: "PACKED" },
    });
    const qty = lines.reduce((a, l) => a + l.quantity, 0);
    await addOrderEvent(tx, {
      orderId,
      type: "SHIPPING",
      actor: "USER",
      userId: actor.userId,
      fromValue: order.status,
      toValue: fullyPacked ? "READY_TO_DISPATCH" : "READY_TO_PACK",
      message: `Packed ${qty} unit(s)${fullyPacked ? " — order fully packed, ready to dispatch" : " (partial)"}`,
    });
    await audit({ userId: actor.userId, action: "shipment.pack", entityType: "Shipment", entityId: shipment.id, summary: `Packed ${qty} unit(s) for order #${order.number}`, ip: actor.ip }, tx);
    return shipment;
  });
}

export async function dispatchShipment(
  shipmentId: string,
  input: { courier: string; trackingNumber?: string; trackingUrl?: string; dispatchedAt?: Date; expectedDeliveryAt?: Date | null; notes?: string; awaitingPickup?: boolean },
  actor: Actor,
) {
  return withLedgerTx(async (tx) => {
    const locked = await tx.$queryRaw<{ id: string; orderId: string }[]>`SELECT id, "orderId" FROM "Shipment" WHERE id = ${shipmentId} FOR UPDATE`;
    if (!locked.length) throw notFound("Shipment");
    await lockOrder(tx, locked[0].orderId);
    const shipment = await tx.shipment.findUniqueOrThrow({
      where: { id: shipmentId },
      include: { lines: { include: { orderItem: true } }, order: true },
    });
    if (shipment.dispatchedAt || shipment.status !== "PACKED") {
      throw new AppError("This shipment has already been dispatched or cancelled.", 409, "ALREADY_DISPATCHED");
    }
    if (shipment.order.status === "CANCELLED" || shipment.order.status === "ON_HOLD") {
      throw new AppError(`Order is ${shipment.order.status.toLowerCase().replace("_", " ")}; resolve before dispatching.`, 409, "INVALID_STATE");
    }
    const dispatchedAt = input.dispatchedAt ?? new Date();
    const untracked: string[] = [];

    for (const line of shipment.lines) {
      const oi = line.orderItem;
      const productItem = await resolveProductItem(tx, oi.productId, oi.variantId);
      if (productItem) {
        await consumeReservation(tx, { itemId: productItem.id, orderItemId: oi.id, quantity: line.quantity });
        await postLedgerEntry(tx, {
          itemId: productItem.id,
          type: "DISPATCH",
          quantity: line.quantity,
          reason: `Dispatched for order #${shipment.order.number}`,
          referenceType: "SHIPMENT",
          referenceId: shipment.id,
          idempotencyKey: `shipment:${shipment.id}:dispatch:${oi.id}:${productItem.id}`,
          userId: actor.userId,
          isDemo: shipment.isDemo,
        });
      } else {
        untracked.push(oi.name);
      }
      // Packaging consumption — only where an explicit rule exists for the product.
      if (oi.productId) {
        const rules = await tx.consumptionRule.findMany({ where: { productId: oi.productId, active: true }, include: { material: true } });
        for (const rule of rules) {
          await postLedgerEntry(tx, {
            itemId: rule.materialId,
            type: "CONSUMPTION",
            quantity: rule.quantityPerUnit * line.quantity,
            reason: `Packaging for ${line.quantity} × ${oi.name} (order #${shipment.order.number})`,
            referenceType: "SHIPMENT",
            referenceId: shipment.id,
            idempotencyKey: `shipment:${shipment.id}:consume:${oi.id}:${rule.materialId}`,
            userId: actor.userId,
            isDemo: shipment.isDemo,
          });
        }
      }
      await tx.orderItem.update({ where: { id: oi.id }, data: { dispatchedQty: { increment: line.quantity } } });
    }

    const status: ShipmentStatus = input.awaitingPickup ? "AWAITING_PICKUP" : "IN_TRANSIT";
    const updated = await tx.shipment.update({
      where: { id: shipmentId },
      data: {
        status,
        courier: input.courier,
        trackingNumber: input.trackingNumber || null,
        trackingUrl: input.trackingUrl || null,
        notes: input.notes ?? shipment.notes,
        dispatchedAt,
        dispatchedById: actor.userId,
        expectedDeliveryAt: input.expectedDeliveryAt ?? null,
      },
    });

    const items = await tx.orderItem.findMany({ where: { orderId: shipment.orderId } });
    const allDispatched = items.every((i) => i.dispatchedQty >= i.quantity);
    await tx.order.update({
      where: { id: shipment.orderId },
      data: {
        status: allDispatched ? "DISPATCHED" : shipment.order.status,
        shippingStatus: status === "AWAITING_PICKUP" ? "AWAITING_PICKUP" : "IN_TRANSIT",
      },
    });
    await addOrderEvent(tx, {
      orderId: shipment.orderId,
      type: "SHIPPING",
      actor: "USER",
      userId: actor.userId,
      fromValue: shipment.order.status,
      toValue: allDispatched ? "DISPATCHED" : shipment.order.status,
      message:
        `Dispatched via ${input.courier}${input.trackingNumber ? ` (tracking ${input.trackingNumber})` : ""}` +
        (allDispatched ? "" : " — partial shipment") +
        (untracked.length ? `. No physical stock item linked for: ${untracked.join(", ")} (stock not deducted).` : ""),
    });
    await syncOrderReservations(tx, shipment.orderId);
    await audit(
      { userId: actor.userId, action: "shipment.dispatch", entityType: "Shipment", entityId: shipmentId, summary: `Dispatched order #${shipment.order.number} via ${input.courier}`, metadata: { trackingNumber: input.trackingNumber ?? null }, ip: actor.ip },
      tx,
    );
    return updated;
  });
}

export async function markPickedUp(shipmentId: string, actor: Actor) {
  return withLedgerTx(async (tx) => {
    const s = await tx.shipment.findUnique({ where: { id: shipmentId }, include: { order: true } });
    if (!s) throw notFound("Shipment");
    if (s.status !== "AWAITING_PICKUP") throw new AppError("Shipment is not awaiting pickup", 409, "INVALID_STATE");
    await tx.shipment.update({ where: { id: shipmentId }, data: { status: "IN_TRANSIT" } });
    await tx.order.update({ where: { id: s.orderId }, data: { shippingStatus: "IN_TRANSIT" } });
    await addOrderEvent(tx, { orderId: s.orderId, type: "SHIPPING", actor: "USER", userId: actor.userId, message: `Picked up by ${s.courier ?? "courier"} — in transit` });
    await audit({ userId: actor.userId, action: "shipment.pickup", entityType: "Shipment", entityId: shipmentId, summary: `Order #${s.order.number} picked up`, ip: actor.ip }, tx);
  });
}

export async function confirmDelivery(shipmentId: string, input: { deliveredAt?: Date; note?: string }, actor: Actor) {
  return withLedgerTx(async (tx) => {
    const s = await tx.shipment.findUnique({ where: { id: shipmentId }, include: { order: true } });
    if (!s) throw notFound("Shipment");
    if (!["IN_TRANSIT", "AWAITING_PICKUP"].includes(s.status)) {
      throw new AppError("Only dispatched shipments can be marked delivered", 409, "INVALID_STATE");
    }
    await lockOrder(tx, s.orderId);
    await tx.shipment.update({
      where: { id: shipmentId },
      data: { status: "DELIVERED", deliveredAt: input.deliveredAt ?? new Date(), deliveredById: actor.userId, deliveryNote: input.note ?? null },
    });
    const [items, shipments] = await Promise.all([
      tx.orderItem.findMany({ where: { orderId: s.orderId } }),
      tx.shipment.findMany({ where: { orderId: s.orderId, status: { not: "CANCELLED" } } }),
    ]);
    const done = items.every((i) => i.dispatchedQty >= i.quantity) && shipments.every((x) => x.status === "DELIVERED" || x.status === "RETURNED");
    if (done) await tx.order.update({ where: { id: s.orderId }, data: { status: "DELIVERED", shippingStatus: "DELIVERED" } });
    await addOrderEvent(tx, {
      orderId: s.orderId,
      type: "SHIPPING",
      actor: "USER",
      userId: actor.userId,
      fromValue: s.order.status,
      toValue: done ? "DELIVERED" : s.order.status,
      message: `Delivery confirmed by authorised user${input.note ? ` — ${input.note}` : ""}`,
    });
    await audit({ userId: actor.userId, action: "shipment.deliver", entityType: "Shipment", entityId: shipmentId, summary: `Delivery confirmed for order #${s.order.number}`, ip: actor.ip }, tx);
    if (done) await onOrderFulfilmentChanged(tx, s.orderId);
  });
}

export async function cancelPackedShipment(shipmentId: string, actor: Actor) {
  return withLedgerTx(async (tx) => {
    const s = await tx.shipment.findUnique({ where: { id: shipmentId }, include: { lines: true, order: true } });
    if (!s) throw notFound("Shipment");
    if (s.status !== "PACKED") throw new AppError("Only packed (not yet dispatched) shipments can be cancelled", 409, "INVALID_STATE");
    for (const l of s.lines) await tx.orderItem.update({ where: { id: l.orderItemId }, data: { packedQty: { decrement: l.quantity } } });
    await tx.shipment.update({ where: { id: shipmentId }, data: { status: "CANCELLED" } });
    if (s.order.status === "READY_TO_DISPATCH") await tx.order.update({ where: { id: s.orderId }, data: { status: "READY_TO_PACK" } });
    const remaining = await tx.shipment.count({ where: { orderId: s.orderId, status: { notIn: ["CANCELLED"] } } });
    if (!remaining) await tx.order.update({ where: { id: s.orderId }, data: { shippingStatus: "NOT_SHIPPED" } });
    await addOrderEvent(tx, { orderId: s.orderId, type: "SHIPPING", actor: "USER", userId: actor.userId, message: "Packed shipment cancelled (unpacked)" });
    await audit({ userId: actor.userId, action: "shipment.cancel", entityType: "Shipment", entityId: shipmentId, summary: `Packed shipment cancelled for order #${s.order.number}`, ip: actor.ip }, tx);
  });
}

export async function recordReturn(
  orderId: string,
  input: { reason: string; lines: { orderItemId: string; quantity: number; condition: "RESTOCK" | "DAMAGED" }[] },
  actor: Actor,
) {
  return withLedgerTx(async (tx) => {
    await lockOrder(tx, orderId);
    const order = await tx.order.findUniqueOrThrow({ where: { id: orderId }, include: { items: true } });
    const lines = input.lines.filter((l) => l.quantity > 0);
    if (!lines.length) throw new AppError("Enter a returned quantity for at least one item", 400, "NO_LINES");
    for (const l of lines) {
      const it = order.items.find((i) => i.id === l.orderItemId);
      if (!it) throw new AppError("Item does not belong to this order", 400, "BAD_LINE");
      if (it.returnedQty + l.quantity > it.dispatchedQty) {
        throw new AppError(`Cannot return ${l.quantity} × ${it.name}: only ${it.dispatchedQty - it.returnedQty} dispatched and not yet returned`, 409, "OVER_RETURN");
      }
    }
    const ret = await tx.orderReturn.create({
      data: { orderId, reason: input.reason, createdById: actor.userId, isDemo: order.isDemo, lines: { create: lines } },
    });
    for (const l of lines) {
      const it = order.items.find((i) => i.id === l.orderItemId)!;
      const productItem = await resolveProductItem(tx, it.productId, it.variantId);
      if (productItem) {
        await postLedgerEntry(tx, {
          itemId: productItem.id,
          type: "RETURN",
          quantity: l.quantity,
          reason: `Customer return, order #${order.number}: ${input.reason}`,
          referenceType: "RETURN",
          referenceId: ret.id,
          idempotencyKey: `return:${ret.id}:${it.id}:in`,
          userId: actor.userId,
          isDemo: order.isDemo,
        });
        if (l.condition === "DAMAGED") {
          await postLedgerEntry(tx, {
            itemId: productItem.id,
            type: "DAMAGE",
            quantity: l.quantity,
            reason: `Returned damaged, order #${order.number}`,
            referenceType: "RETURN",
            referenceId: ret.id,
            idempotencyKey: `return:${ret.id}:${it.id}:damage`,
            userId: actor.userId,
            isDemo: order.isDemo,
          });
        }
      }
      await tx.orderItem.update({ where: { id: it.id }, data: { returnedQty: { increment: l.quantity } } });
    }
    const items = await tx.orderItem.findMany({ where: { orderId } });
    const fullyReturned = items.every((i) => i.returnedQty >= i.quantity);
    if (fullyReturned) await tx.order.update({ where: { id: orderId }, data: { status: "RETURNED", shippingStatus: "RETURNED" } });
    const qty = lines.reduce((a, l) => a + l.quantity, 0);
    await addOrderEvent(tx, {
      orderId,
      type: "RETURN",
      actor: "USER",
      userId: actor.userId,
      fromValue: order.status,
      toValue: fullyReturned ? "RETURNED" : order.status,
      message: `Return recorded: ${qty} unit(s) — ${input.reason}`,
    });
    await audit({ userId: actor.userId, action: "order.return", entityType: "Order", entityId: orderId, summary: `Return of ${qty} unit(s) on order #${order.number}`, ip: actor.ip }, tx);
    await onOrderFulfilmentChanged(tx, orderId);
    return ret;
  });
}
