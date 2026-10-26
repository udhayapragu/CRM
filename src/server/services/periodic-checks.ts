/** Periodic operational checks that raise in-app notifications (deduplicated per day). */
import { prisma } from "@/lib/db";
import { delayedWhere } from "./orders";
import { notify } from "./notifications";
import { checkStockAlerts } from "./inventory-ledger";

export async function runPeriodicChecks(now = new Date()) {
  const day = now.toISOString().slice(0, 10);
  const results = { delayedOrders: 0, delayedShipments: 0, pendingDispatch: 0, discrepancies: 0, stockAlerts: 0 };

  // Orders past their expected dispatch date
  const delayed = await prisma.order.findMany({ where: delayedWhere(now), select: { id: true, number: true, isDemo: true }, take: 200 });
  for (const o of delayed) {
    await notify({
      type: "DELAYED_SHIPMENT",
      severity: "warning",
      title: `Order #${o.number} is past its dispatch date`,
      message: "Expected dispatch date has passed and the order has not been dispatched.",
      link: `/orders/${o.id}`,
      dedupeKey: `delay:${o.id}:${day}`,
      isDemo: o.isDemo,
    });
  }
  results.delayedOrders = delayed.length;

  // Shipments in transit beyond their expected delivery date
  const late = await prisma.shipment.findMany({
    where: { status: { in: ["IN_TRANSIT", "AWAITING_PICKUP"] }, expectedDeliveryAt: { lt: now } },
    include: { order: { select: { id: true, number: true } } },
    take: 200,
  });
  for (const s of late) {
    await notify({
      type: "DELAYED_SHIPMENT",
      severity: "warning",
      title: `Shipment for order #${s.order.number} is overdue`,
      message: `${s.courier ?? "Courier"}${s.trackingNumber ? ` · ${s.trackingNumber}` : ""} — expected delivery has passed.`,
      link: `/orders/${s.order.id}`,
      dedupeKey: `latedelivery:${s.id}:${day}`,
      isDemo: s.isDemo,
    });
  }
  results.delayedShipments = late.length;

  // Daily pending dispatch summary
  const pending = await prisma.order.count({ where: { status: { in: ["CONFIRMED", "PROCESSING", "READY_TO_PACK", "READY_TO_DISPATCH"] } } });
  if (pending > 0) {
    await notify({
      type: "PENDING_DISPATCH",
      title: `${pending} order(s) awaiting dispatch`,
      message: "Open the Dispatch board to pack and ship them.",
      link: "/dispatch",
      dedupeKey: `pending:${day}`,
    });
  }
  results.pendingDispatch = pending;

  // Website stock vs physical stock — flag large, unusual differences
  const tracked = await prisma.inventoryItem.findMany({
    where: { category: "PRODUCT", active: true, product: { wpManageStock: true, deletedAtSource: null } },
    include: { product: { select: { id: true, name: true, wpStockQuantity: true } }, variant: { select: { wpStockQuantity: true } } },
    take: 2000,
  });
  for (const it of tracked) {
    const web = it.variantId ? it.variant?.wpStockQuantity : it.product?.wpStockQuantity;
    if (web === null || web === undefined) continue;
    const available = it.qtyOnHand - it.qtyReserved;
    const diff = Math.abs(web - available);
    if (diff >= Math.max(5, Math.ceil(Math.max(web, available) * 0.2))) {
      await notify({
        type: "STOCK_DISCREPANCY",
        severity: "warning",
        title: `Stock mismatch: ${it.name}`,
        message: `Website shows ${web}, physical available stock is ${available}. Verify a stock count or update the website.`,
        link: it.productId ? `/products/${it.productId}` : `/inventory/${it.id}`,
        dedupeKey: `mismatch:${it.id}:${day}`,
        isDemo: it.isDemo,
      });
      results.discrepancies++;
    }
  }

  // Low-stock sweep (items that crossed thresholds via reorder level changes etc.)
  const items = await prisma.inventoryItem.findMany({ where: { active: true }, select: { id: true, qtyOnHand: true, qtyReserved: true, reorderLevel: true } });
  for (const it of items) {
    if (it.qtyOnHand - it.qtyReserved <= it.reorderLevel) {
      await prisma.$transaction((tx) => checkStockAlerts(tx, it.id));
      results.stockAlerts++;
    }
  }
  return results;
}
