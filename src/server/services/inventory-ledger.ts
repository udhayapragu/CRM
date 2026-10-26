/**
 * Inventory ledger service — the ONLY place physical stock changes.
 *
 * Guarantees
 *  - Every change is an immutable ledger row with reason, timestamp and responsible user.
 *  - Item rows are locked (SELECT … FOR UPDATE) for the duration of the transaction, so
 *    concurrent movements are serialised per item and cannot race.
 *  - Optional idempotency keys make retried business events (e.g. dispatching the same shipment
 *    twice) a no-op instead of a double deduction.
 *  - Physical stock can never go negative at any location.
 *
 *  onHand = opening + received − consumed − dispatched + returned − damaged ± adjustments (± transfers)
 *  available = onHand − active reservations
 */
import type { InventoryItem, LedgerType, Prisma } from "@prisma/client";
import { prisma, type Tx } from "@/lib/db";
import { AppError, notFound } from "@/lib/errors";
import { notify } from "./notifications";

export const INBOUND_TYPES: LedgerType[] = ["OPENING", "RECEIPT", "RETURN", "TRANSFER_IN"];
export const OUTBOUND_TYPES: LedgerType[] = ["CONSUMPTION", "DISPATCH", "DAMAGE", "TRANSFER_OUT"];

export interface PostEntryInput {
  itemId: string;
  locationId?: string;
  type: LedgerType;
  /** Magnitude for directional types; signed delta for ADJUSTMENT. */
  quantity: number;
  reason: string;
  referenceType?: string;
  referenceId?: string;
  idempotencyKey?: string;
  userId?: string | null;
  isDemo?: boolean;
  /** Back-dating is only permitted for demo data (used to build realistic demo history). */
  demoOccurredAt?: Date;
}

export function signedDelta(type: LedgerType, quantity: number): number {
  if (!Number.isInteger(quantity)) throw new AppError("Quantity must be a whole number", 400, "INVALID_QTY");
  if (type === "ADJUSTMENT") {
    if (quantity === 0) throw new AppError("Adjustment quantity cannot be zero", 400, "INVALID_QTY");
    return quantity;
  }
  if (quantity <= 0) throw new AppError("Quantity must be greater than zero", 400, "INVALID_QTY");
  if (INBOUND_TYPES.includes(type)) return quantity;
  if (OUTBOUND_TYPES.includes(type)) return -quantity;
  throw new AppError(`Unknown ledger type ${type}`, 400, "INVALID_TYPE");
}

const COUNTER: Partial<Record<LedgerType, keyof InventoryItem>> = {
  OPENING: "qtyOpening",
  RECEIPT: "qtyReceived",
  CONSUMPTION: "qtyConsumed",
  DISPATCH: "qtyDispatched",
  RETURN: "qtyReturned",
  DAMAGE: "qtyDamaged",
  ADJUSTMENT: "qtyAdjusted",
};

export async function getDefaultLocationId(tx: Tx = prisma): Promise<string> {
  const loc = await tx.inventoryLocation.findFirst({ where: { isDefault: true } });
  if (loc) return loc.id;
  const created = await tx.inventoryLocation.upsert({
    where: { code: "MAIN" },
    create: { code: "MAIN", name: "Main Warehouse", isDefault: true },
    update: { isDefault: true },
  });
  return created.id;
}

/** Lock an inventory item row for the remainder of the transaction. */
export async function lockItem(tx: Tx, itemId: string) {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "InventoryItem" WHERE id = ${itemId} FOR UPDATE`;
  if (!rows.length) throw notFound("Inventory item");
}

export interface PostResult {
  entryId: string;
  duplicate: boolean;
  balanceAfter: number;
}

/** Post one ledger movement. Must be called inside a transaction (use `withLedgerTx`). */
export async function postLedgerEntry(tx: Tx, input: PostEntryInput): Promise<PostResult> {
  const reason = input.reason?.trim();
  if (!reason) throw new AppError("A reason is required for every stock movement", 400, "REASON_REQUIRED");
  const delta = signedDelta(input.type, input.quantity);

  await lockItem(tx, input.itemId);

  if (input.idempotencyKey) {
    const existing = await tx.inventoryLedgerEntry.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
    if (existing) return { entryId: existing.id, duplicate: true, balanceAfter: existing.balanceAfter };
  }

  const item = await tx.inventoryItem.findUniqueOrThrow({ where: { id: input.itemId } });
  if (!item.active && INBOUND_TYPES.includes(input.type) && input.type !== "RETURN") {
    throw new AppError("This inventory item is archived", 400, "ITEM_INACTIVE");
  }
  const locationId = input.locationId ?? (await getDefaultLocationId(tx));
  const level = await tx.stockLevel.findUnique({ where: { itemId_locationId: { itemId: item.id, locationId } } });
  const locQty = level?.qtyOnHand ?? 0;

  if (locQty + delta < 0) {
    throw new AppError(
      `Insufficient stock for ${item.name} (${item.sku}): ${locQty} ${item.unit} on hand at this location, ${-delta} requested`,
      409,
      "INSUFFICIENT_STOCK",
      { itemId: item.id, onHand: locQty, requested: -delta },
    );
  }

  const newOnHand = item.qtyOnHand + delta;
  const now = item.isDemo && input.demoOccurredAt ? input.demoOccurredAt : new Date();
  const entry = await tx.inventoryLedgerEntry.create({
    data: {
      itemId: item.id,
      locationId,
      type: input.type,
      quantity: delta,
      balanceAfter: newOnHand,
      reason: reason.slice(0, 500),
      referenceType: input.referenceType ?? null,
      referenceId: input.referenceId ?? null,
      idempotencyKey: input.idempotencyKey ?? null,
      userId: input.userId ?? null,
      isDemo: input.isDemo ?? item.isDemo,
      createdAt: now,
    },
  });

  const counter = COUNTER[input.type];
  const counterValue = counter ? (input.type === "ADJUSTMENT" ? delta : Math.abs(delta)) : 0;
  await tx.inventoryItem.update({
    where: { id: item.id },
    data: {
      qtyOnHand: newOnHand,
      lastMovementAt: now,
      ...(counter ? { [counter]: { increment: counterValue } } : {}),
    } as Prisma.InventoryItemUpdateInput,
  });
  // Explicit update-or-create (the item row lock serialises this). A native upsert would be compiled to
  // INSERT … ON CONFLICT, whose proposed insert row is CHECK-validated before conflict resolution.
  if (level) {
    await tx.stockLevel.update({ where: { itemId_locationId: { itemId: item.id, locationId } }, data: { qtyOnHand: { increment: delta } } });
  } else {
    await tx.stockLevel.create({ data: { itemId: item.id, locationId, qtyOnHand: delta } });
  }

  if (delta < 0) await checkStockAlerts(tx, item.id);
  return { entryId: entry.id, duplicate: false, balanceAfter: newOnHand };
}

/** Run ledger work in a serialisable-enough transaction (row locks + read committed). */
export function withLedgerTx<T>(fn: (tx: Tx) => Promise<T>) {
  return prisma.$transaction((tx) => fn(tx), { timeout: 20_000, maxWait: 10_000 });
}

export async function checkStockAlerts(tx: Tx, itemId: string) {
  const item = await tx.inventoryItem.findUnique({ where: { id: itemId } });
  if (!item || !item.active) return;
  const available = item.qtyOnHand - item.qtyReserved;
  const day = new Date().toISOString().slice(0, 10);
  if (item.qtyOnHand <= 0) {
    await notify(
      {
        type: "OUT_OF_STOCK",
        severity: "critical",
        title: `Out of stock: ${item.name}`,
        message: `${item.sku} has no physical stock left.`,
        link: `/inventory/${item.id}`,
        dedupeKey: `oos:${item.id}:${day}`,
        isDemo: item.isDemo,
      },
      tx,
    );
  } else if (available <= item.reorderLevel) {
    await notify(
      {
        type: "LOW_STOCK",
        severity: "warning",
        title: `Low stock: ${item.name}`,
        message: `${item.sku}: ${available} ${item.unit} available (reorder level ${item.reorderLevel}).`,
        link: `/inventory/${item.id}`,
        dedupeKey: `low:${item.id}:${day}`,
        isDemo: item.isDemo,
      },
      tx,
    );
  }
  if (available < 0) {
    await notify(
      {
        type: "STOCK_DISCREPANCY",
        severity: "warning",
        title: `Reservations exceed stock: ${item.name}`,
        message: `${item.sku} has ${item.qtyReserved} reserved but only ${item.qtyOnHand} on hand.`,
        link: `/inventory/${item.id}`,
        dedupeKey: `short:${item.id}:${day}`,
        isDemo: item.isDemo,
      },
      tx,
    );
  }
}

/** Move stock between locations as a pair of TRANSFER_OUT / TRANSFER_IN entries. */
export async function transferStock(
  tx: Tx,
  input: { itemId: string; fromLocationId: string; toLocationId: string; quantity: number; reason: string; userId?: string | null; transferId: string },
) {
  if (input.fromLocationId === input.toLocationId) {
    throw new AppError("Source and destination locations must differ", 400, "SAME_LOCATION");
  }
  const out = await postLedgerEntry(tx, {
    itemId: input.itemId,
    locationId: input.fromLocationId,
    type: "TRANSFER_OUT",
    quantity: input.quantity,
    reason: input.reason,
    referenceType: "TRANSFER",
    referenceId: input.transferId,
    idempotencyKey: `transfer:${input.transferId}:out`,
    userId: input.userId,
  });
  const inn = await postLedgerEntry(tx, {
    itemId: input.itemId,
    locationId: input.toLocationId,
    type: "TRANSFER_IN",
    quantity: input.quantity,
    reason: input.reason,
    referenceType: "TRANSFER",
    referenceId: input.transferId,
    idempotencyKey: `transfer:${input.transferId}:in`,
    userId: input.userId,
  });
  return { out, in: inn };
}

// ───────────────────────────── Reservations ─────────────────────────────

/** Create or resize the reservation for an order line. Returns the reserved quantity delta. */
export async function reserveStock(
  tx: Tx,
  input: { itemId: string; orderId: string; orderItemId: string; quantity: number },
): Promise<number> {
  await lockItem(tx, input.itemId);
  const existing = await tx.stockReservation.findUnique({
    where: { orderItemId_itemId: { orderItemId: input.orderItemId, itemId: input.itemId } },
  });
  if (input.quantity <= 0) {
    if (existing?.status === "ACTIVE") return releaseReservation(tx, existing.id);
    return 0;
  }
  let delta: number;
  if (!existing) {
    await tx.stockReservation.create({ data: { ...input } });
    delta = input.quantity;
  } else if (existing.status === "ACTIVE") {
    delta = input.quantity - existing.quantity;
    if (delta !== 0) await tx.stockReservation.update({ where: { id: existing.id }, data: { quantity: input.quantity } });
  } else {
    // Previously released/consumed: reactivate with the new quantity.
    await tx.stockReservation.update({ where: { id: existing.id }, data: { quantity: input.quantity, status: "ACTIVE" } });
    delta = input.quantity;
  }
  if (delta !== 0) {
    await tx.inventoryItem.update({ where: { id: input.itemId }, data: { qtyReserved: { increment: delta } } });
    await checkStockAlerts(tx, input.itemId);
  }
  return delta;
}

export async function releaseReservation(tx: Tx, reservationId: string): Promise<number> {
  const r = await tx.stockReservation.findUnique({ where: { id: reservationId } });
  if (!r || r.status !== "ACTIVE") return 0;
  await lockItem(tx, r.itemId);
  await tx.stockReservation.update({ where: { id: r.id }, data: { status: "RELEASED" } });
  await tx.inventoryItem.update({ where: { id: r.itemId }, data: { qtyReserved: { decrement: r.quantity } } });
  return -r.quantity;
}

export async function releaseOrderReservations(tx: Tx, orderId: string) {
  const active = await tx.stockReservation.findMany({ where: { orderId, status: "ACTIVE" } });
  for (const r of active) await releaseReservation(tx, r.id);
  return active.length;
}

/** On dispatch: reduce the active reservation for the line by `quantity`. */
export async function consumeReservation(tx: Tx, input: { itemId: string; orderItemId: string; quantity: number }) {
  const r = await tx.stockReservation.findUnique({
    where: { orderItemId_itemId: { orderItemId: input.orderItemId, itemId: input.itemId } },
  });
  if (!r || r.status !== "ACTIVE") return 0;
  await lockItem(tx, r.itemId);
  const take = Math.min(r.quantity, input.quantity);
  if (take >= r.quantity) {
    await tx.stockReservation.update({ where: { id: r.id }, data: { status: "CONSUMED" } });
  } else {
    await tx.stockReservation.update({ where: { id: r.id }, data: { quantity: r.quantity - take } });
  }
  await tx.inventoryItem.update({ where: { id: r.itemId }, data: { qtyReserved: { decrement: take } } });
  return take;
}

// ───────────────────────────── Verification ─────────────────────────────

export interface VerifyResult {
  itemId: string;
  ok: boolean;
  cached: Record<string, number>;
  computed: Record<string, number>;
}

/** Recompute an item's totals from the ledger and reservations and compare with the cached values. */
export async function verifyItem(itemId: string, tx: Tx = prisma): Promise<VerifyResult> {
  const item = await tx.inventoryItem.findUniqueOrThrow({ where: { id: itemId } });
  const sums = await tx.inventoryLedgerEntry.groupBy({ by: ["type"], where: { itemId }, _sum: { quantity: true } });
  const by = Object.fromEntries(sums.map((s) => [s.type, s._sum.quantity ?? 0])) as Partial<Record<LedgerType, number>>;
  const reserved = await tx.stockReservation.aggregate({ where: { itemId, status: "ACTIVE" }, _sum: { quantity: true } });
  const computed = {
    qtyOpening: by.OPENING ?? 0,
    qtyReceived: by.RECEIPT ?? 0,
    qtyConsumed: -(by.CONSUMPTION ?? 0),
    qtyDispatched: -(by.DISPATCH ?? 0),
    qtyReturned: by.RETURN ?? 0,
    qtyDamaged: -(by.DAMAGE ?? 0),
    qtyAdjusted: by.ADJUSTMENT ?? 0,
    qtyOnHand: Object.values(by).reduce((a, b) => a + (b ?? 0), 0),
    qtyReserved: reserved._sum.quantity ?? 0,
  };
  const cached = Object.fromEntries(Object.keys(computed).map((k) => [k, item[k as keyof typeof item] as number]));
  const ok = Object.entries(computed).every(([k, v]) => cached[k] === v);
  return { itemId, ok, cached, computed };
}

/** Rewrite cached totals from the ledger (the ledger itself is never changed). */
export async function rebuildItemCache(itemId: string) {
  return withLedgerTx(async (tx) => {
    await lockItem(tx, itemId);
    const v = await verifyItem(itemId, tx);
    if (!v.ok) await tx.inventoryItem.update({ where: { id: itemId }, data: v.computed });
    const perLoc = await tx.inventoryLedgerEntry.groupBy({ by: ["locationId"], where: { itemId }, _sum: { quantity: true } });
    for (const l of perLoc) {
      await tx.stockLevel.upsert({
        where: { itemId_locationId: { itemId, locationId: l.locationId } },
        create: { itemId, locationId: l.locationId, qtyOnHand: l._sum.quantity ?? 0 },
        update: { qtyOnHand: l._sum.quantity ?? 0 },
      });
    }
    return v;
  });
}

/** Find the inventory item that physically represents a catalogue product/variant. */
export async function resolveProductItem(tx: Tx, productId: string | null, variantId: string | null) {
  if (!productId) return null;
  if (variantId) {
    const v = await tx.inventoryItem.findFirst({ where: { variantId, category: "PRODUCT", active: true } });
    if (v) return v;
  }
  return tx.inventoryItem.findFirst({ where: { productId, variantId: null, category: "PRODUCT", active: true } });
}
