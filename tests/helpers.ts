import { Prisma, type OrderStatus, type PaymentStatus, type Role } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getDefaultLocationId, postLedgerEntry, withLedgerTx } from "@/server/services/inventory-ledger";
import { syncOrderReservations } from "@/server/services/orders";
import { resetRateLimits } from "@/lib/rate-limit";

const TABLES = [
  "Commission", "Payout", "MemberSale", "Member", "CommissionRule", "OrderEvent", "ShipmentLine", "Shipment", "OrderReturnLine", "OrderReturn",
  "StockReservation", "OrderItem", "Order", "PurchaseReceiptLine", "PurchaseReceipt", "ConsumptionRule", "InventoryLedgerEntry", "StockLevel",
  "InventoryItem", "InventoryLocation", "ProductVariant", "Product", "Supplier", "OnboardingTask", "OnboardingComment", "OnboardingDocument",
  "OnboardingItem", "OnboardingStage", "NotificationRead", "Notification", "SyncLog", "SyncJob", "WebhookEvent", "WordPressConnection",
  "AuditLog", "Session", "AppSetting", "User",
];

/** Wipe the test database. TRUNCATE does not fire the ledger's row-level DELETE guard. */
export async function resetDb() {
  await prisma.$executeRawUnsafe(`TRUNCATE ${TABLES.map((t) => `"${t}"`).join(", ")} RESTART IDENTITY CASCADE`);
  resetRateLimits();
}

let n = 0;
export async function makeUser(role: Role = "SUPER_ADMIN") {
  n++;
  return prisma.user.create({ data: { email: `user${n}-${Date.now()}@test.local`, name: `User ${n}`, role, passwordHash: "x" } });
}

export async function makeItem(opts: { sku: string; opening?: number; category?: "PRODUCT" | "BOTTLE" | "LABEL" | "CAP" | "BOX"; productId?: string; reorderLevel?: number; userId?: string }) {
  const item = await prisma.inventoryItem.create({
    data: { name: opts.sku, sku: opts.sku, category: opts.category ?? "BOTTLE", productId: opts.productId ?? null, reorderLevel: opts.reorderLevel ?? 0 },
  });
  if (opts.opening) {
    await withLedgerTx(async (tx) => {
      const loc = await getDefaultLocationId(tx);
      await postLedgerEntry(tx, { itemId: item.id, locationId: loc, type: "OPENING", quantity: opts.opening!, reason: "Opening stock", idempotencyKey: `opening:${item.id}:${loc}`, userId: opts.userId });
    });
  }
  return prisma.inventoryItem.findUniqueOrThrow({ where: { id: item.id } });
}

export async function makeProduct(name = "Test Perfume", sku = "TP-1") {
  return prisma.product.create({ data: { name, sku, source: "MANUAL", price: new Prisma.Decimal(1000) } });
}

export async function makeOrder(opts: { lines: { productId: string; quantity: number; price?: number }[]; status?: OrderStatus; paymentStatus?: PaymentStatus; number?: string }) {
  const total = opts.lines.reduce((s, l) => s + (l.price ?? 1000) * l.quantity, 0);
  const order = await prisma.order.create({
    data: {
      number: opts.number ?? `T${Math.floor(Math.random() * 1e6)}`,
      customerName: "Test Customer",
      orderDate: new Date(),
      status: opts.status ?? "CONFIRMED",
      paymentStatus: opts.paymentStatus ?? "PAID",
      total: new Prisma.Decimal(total),
      subtotal: new Prisma.Decimal(total),
      items: { create: opts.lines.map((l) => ({ productId: l.productId, name: "Line", quantity: l.quantity, unitPrice: new Prisma.Decimal(l.price ?? 1000), total: new Prisma.Decimal((l.price ?? 1000) * l.quantity) })) },
    },
    include: { items: true },
  });
  await prisma.$transaction((tx) => syncOrderReservations(tx, order.id));
  return order;
}

export const item = (id: string) => prisma.inventoryItem.findUniqueOrThrow({ where: { id } });
