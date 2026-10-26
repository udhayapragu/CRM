import { Prisma, type InventoryCategory, type LedgerType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { AppError, notFound } from "@/lib/errors";
import { randomToken } from "@/lib/crypto";
import { audit } from "@/server/audit";
import { getDefaultLocationId, postLedgerEntry, transferStock, withLedgerTx } from "./inventory-ledger";
import { notify } from "./notifications";

interface Actor {
  userId: string;
  ip?: string | null;
}

export const CATEGORY_LABELS: Record<InventoryCategory, string> = {
  PRODUCT: "Finished products",
  BOTTLE: "Bottles",
  LABEL: "Stickers & labels",
  CAP: "Caps & lids",
  BOX: "Boxes & cartons",
  PACKAGING: "Packaging materials",
  RAW_MATERIAL: "Raw materials",
  OTHER: "Other",
};

/** Movement kinds exposed in the UI, mapped to ledger types. */
export const MOVEMENT_KINDS = {
  STOCK_IN: "RECEIPT",
  STOCK_OUT: "CONSUMPTION",
  ADJUSTMENT: "ADJUSTMENT",
  DAMAGE: "DAMAGE",
  RETURN: "RETURN",
} as const satisfies Record<string, LedgerType>;
export type MovementKind = keyof typeof MOVEMENT_KINDS;

export interface CreateItemInput {
  name: string;
  sku: string;
  category: InventoryCategory;
  customCategory?: string | null;
  unit?: string;
  reorderLevel?: number;
  supplierId?: string | null;
  productId?: string | null;
  variantId?: string | null;
  notes?: string | null;
  openingStock?: number;
}

export async function createInventoryItem(input: CreateItemInput, actor: Actor) {
  return withLedgerTx(async (tx) => {
    if (input.productId && input.category !== "PRODUCT") {
      throw new AppError("Only items in the Finished products category can be linked to a website product", 400, "BAD_LINK");
    }
    if (input.productId) {
      const dup = await tx.inventoryItem.findFirst({ where: { productId: input.productId, variantId: input.variantId ?? null, active: true } });
      if (dup) throw new AppError(`This product is already tracked as ${dup.sku}`, 409, "ALREADY_TRACKED");
    }
    const item = await tx.inventoryItem.create({
      data: {
        name: input.name.trim(),
        sku: input.sku.trim().toUpperCase(),
        category: input.category,
        customCategory: input.customCategory || null,
        unit: input.unit?.trim() || "pcs",
        reorderLevel: input.reorderLevel ?? 0,
        supplierId: input.supplierId || null,
        productId: input.productId || null,
        variantId: input.variantId || null,
        notes: input.notes || null,
      },
    });
    if (input.openingStock && input.openingStock > 0) {
      const locationId = await getDefaultLocationId(tx);
      await postLedgerEntry(tx, {
        itemId: item.id,
        locationId,
        type: "OPENING",
        quantity: input.openingStock,
        reason: "Opening stock",
        idempotencyKey: `opening:${item.id}:${locationId}`,
        userId: actor.userId,
      });
    }
    await audit({ userId: actor.userId, action: "inventory.item_create", entityType: "InventoryItem", entityId: item.id, summary: `Created inventory item ${item.sku} (${item.name})${input.openingStock ? ` with opening stock ${input.openingStock}` : ""}`, ip: actor.ip }, tx);
    return tx.inventoryItem.findUniqueOrThrow({ where: { id: item.id } });
  });
}

export async function updateInventoryItem(
  id: string,
  patch: { name?: string; reorderLevel?: number; supplierId?: string | null; unit?: string; notes?: string | null; customCategory?: string | null; active?: boolean },
  actor: Actor,
) {
  return prisma.$transaction(async (tx) => {
    const before = await tx.inventoryItem.findUnique({ where: { id } });
    if (!before) throw notFound("Inventory item");
    const item = await tx.inventoryItem.update({ where: { id }, data: patch });
    await audit({ userId: actor.userId, action: "inventory.item_update", entityType: "InventoryItem", entityId: id, summary: `Updated ${item.sku}: ${Object.keys(patch).join(", ")}`, metadata: { before: { reorderLevel: before.reorderLevel, active: before.active }, patch }, ip: actor.ip }, tx);
    return item;
  });
}

export async function recordMovement(
  input: { itemId: string; kind: MovementKind; quantity: number; reason: string; locationId?: string; reference?: string },
  actor: Actor,
) {
  const type = MOVEMENT_KINDS[input.kind];
  if (!type) throw new AppError("Unknown movement type", 400, "BAD_KIND");
  return withLedgerTx(async (tx) => {
    const item = await tx.inventoryItem.findUnique({ where: { id: input.itemId } });
    if (!item) throw notFound("Inventory item");
    const res = await postLedgerEntry(tx, {
      itemId: input.itemId,
      locationId: input.locationId,
      type,
      quantity: input.quantity,
      reason: input.reason,
      referenceType: input.reference ? "MANUAL_REF" : "MANUAL",
      referenceId: input.reference || undefined,
      userId: actor.userId,
    });
    const signed = type === "ADJUSTMENT" ? input.quantity : ["RECEIPT", "RETURN"].includes(type) ? input.quantity : -input.quantity;
    await audit({ userId: actor.userId, action: `inventory.${input.kind.toLowerCase()}`, entityType: "InventoryItem", entityId: item.id, summary: `${input.kind.replace("_", " ")} ${signed > 0 ? "+" : ""}${signed} ${item.unit} ${item.sku} — ${input.reason}`, metadata: { entryId: res.entryId, balanceAfter: res.balanceAfter }, ip: actor.ip }, tx);
    if (type === "ADJUSTMENT" || type === "DAMAGE") {
      const large = Math.abs(signed) >= Math.max(10, Math.ceil(item.qtyOnHand * 0.1));
      await notify(
        {
          type: large ? "STOCK_DISCREPANCY" : "INVENTORY_ADJUSTMENT",
          severity: large ? "warning" : "info",
          title: `${type === "DAMAGE" ? "Damage recorded" : "Stock adjusted"}: ${item.name}`,
          message: `${signed > 0 ? "+" : ""}${signed} ${item.unit} — ${input.reason}`,
          link: `/inventory/${item.id}`,
          isDemo: item.isDemo,
        },
        tx,
      );
    }
    return res;
  });
}

export async function recordTransfer(
  input: { itemId: string; fromLocationId: string; toLocationId: string; quantity: number; reason: string },
  actor: Actor,
) {
  return withLedgerTx(async (tx) => {
    const transferId = randomToken(9);
    const res = await transferStock(tx, { ...input, userId: actor.userId, transferId });
    const [item, from, to] = await Promise.all([
      tx.inventoryItem.findUniqueOrThrow({ where: { id: input.itemId } }),
      tx.inventoryLocation.findUniqueOrThrow({ where: { id: input.fromLocationId } }),
      tx.inventoryLocation.findUniqueOrThrow({ where: { id: input.toLocationId } }),
    ]);
    await audit({ userId: actor.userId, action: "inventory.transfer", entityType: "InventoryItem", entityId: input.itemId, summary: `Transferred ${input.quantity} ${item.unit} ${item.sku} ${from.code} → ${to.code}`, ip: actor.ip }, tx);
    return res;
  });
}

export async function createPurchaseReceipt(
  input: { supplierId?: string | null; invoiceRef?: string; receivedAt?: Date; notes?: string; locationId?: string; lines: { itemId: string; quantity: number; unitCost?: number | null }[] },
  actor: Actor,
) {
  if (!input.lines.length) throw new AppError("Add at least one received item", 400, "NO_LINES");
  return withLedgerTx(async (tx) => {
    const count = await tx.purchaseReceipt.count();
    const number = `GRN-${String(count + 1).padStart(5, "0")}-${randomToken(3).toUpperCase().replace(/[^A-Z0-9]/g, "X")}`;
    const totalCost = input.lines.reduce((s, l) => s + (l.unitCost ?? 0) * l.quantity, 0);
    const receipt = await tx.purchaseReceipt.create({
      data: {
        number,
        supplierId: input.supplierId || null,
        invoiceRef: input.invoiceRef || null,
        receivedAt: input.receivedAt ?? new Date(),
        notes: input.notes || null,
        totalCost: new Prisma.Decimal(totalCost),
        createdById: actor.userId,
        lines: { create: input.lines.map((l) => ({ itemId: l.itemId, quantity: l.quantity, unitCost: l.unitCost != null ? new Prisma.Decimal(l.unitCost) : null })) },
      },
      include: { lines: true, supplier: true },
    });
    for (const line of receipt.lines) {
      await postLedgerEntry(tx, {
        itemId: line.itemId,
        locationId: input.locationId,
        type: "RECEIPT",
        quantity: line.quantity,
        reason: `Goods received ${number}${receipt.supplier ? ` from ${receipt.supplier.name}` : ""}${input.invoiceRef ? ` (invoice ${input.invoiceRef})` : ""}`,
        referenceType: "PURCHASE_RECEIPT",
        referenceId: receipt.id,
        idempotencyKey: `grn:${receipt.id}:${line.id}`,
        userId: actor.userId,
      });
    }
    await audit({ userId: actor.userId, action: "inventory.goods_received", entityType: "PurchaseReceipt", entityId: receipt.id, summary: `Goods received ${number}: ${receipt.lines.length} line(s)`, ip: actor.ip }, tx);
    return receipt;
  });
}

/** Start tracking physical stock for a website product (or variant). */
export async function trackProduct(input: { productId: string; variantId?: string | null; openingStock?: number; sku?: string; reorderLevel?: number }, actor: Actor) {
  const product = await prisma.product.findUnique({ where: { id: input.productId }, include: { variants: true } });
  if (!product) throw notFound("Product");
  const variant = input.variantId ? product.variants.find((v) => v.id === input.variantId) : null;
  if (input.variantId && !variant) throw notFound("Variant");
  let sku = (input.sku || variant?.sku || product.sku || `WP-${product.externalId ?? product.id.slice(-6)}${variant ? `-${variant.externalId}` : ""}`).toUpperCase();
  if (await prisma.inventoryItem.findUnique({ where: { sku } })) sku = `${sku}-P`;
  return createInventoryItem(
    {
      name: variant?.name ?? product.name,
      sku,
      category: "PRODUCT",
      productId: product.id,
      variantId: variant?.id ?? null,
      reorderLevel: input.reorderLevel ?? product.lowStockThreshold,
      openingStock: input.openingStock,
    },
    actor,
  );
}

// ── Suppliers ──
export interface SupplierInput {
  name: string;
  contactName?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  gstOrTaxId?: string | null;
  notes?: string | null;
  active?: boolean;
}

export async function upsertSupplier(id: string | null, input: SupplierInput, actor: Actor) {
  return prisma.$transaction(async (tx) => {
    const s = id ? await tx.supplier.update({ where: { id }, data: input }) : await tx.supplier.create({ data: input });
    await audit({ userId: actor.userId, action: id ? "supplier.update" : "supplier.create", entityType: "Supplier", entityId: s.id, summary: `${id ? "Updated" : "Created"} supplier ${s.name}`, ip: actor.ip }, tx);
    return s;
  });
}

// ── Consumption rules ──
export async function upsertConsumptionRule(input: { productId: string; materialId: string; quantityPerUnit: number; active?: boolean; notes?: string | null }, actor: Actor) {
  return prisma.$transaction(async (tx) => {
    const material = await tx.inventoryItem.findUnique({ where: { id: input.materialId } });
    if (!material) throw notFound("Material");
    if (material.category === "PRODUCT") throw new AppError("Consumption rules link a product to packaging/raw materials, not to another finished product", 400, "BAD_MATERIAL");
    if (!Number.isInteger(input.quantityPerUnit) || input.quantityPerUnit <= 0) throw new AppError("Quantity per unit must be a positive whole number", 400, "INVALID_QTY");
    const rule = await tx.consumptionRule.upsert({
      where: { productId_materialId: { productId: input.productId, materialId: input.materialId } },
      create: { productId: input.productId, materialId: input.materialId, quantityPerUnit: input.quantityPerUnit, active: input.active ?? true, notes: input.notes ?? null },
      update: { quantityPerUnit: input.quantityPerUnit, active: input.active ?? true, notes: input.notes ?? null },
      include: { product: true },
    });
    await audit({ userId: actor.userId, action: "inventory.rule_upsert", entityType: "ConsumptionRule", entityId: rule.id, summary: `Rule: 1 × ${rule.product.name} consumes ${input.quantityPerUnit} × ${material.name}`, ip: actor.ip }, tx);
    return rule;
  });
}

export async function deleteConsumptionRule(id: string, actor: Actor) {
  return prisma.$transaction(async (tx) => {
    const rule = await tx.consumptionRule.delete({ where: { id }, include: { product: true, material: true } });
    await audit({ userId: actor.userId, action: "inventory.rule_delete", entityType: "ConsumptionRule", entityId: id, summary: `Removed rule ${rule.product.name} → ${rule.material.name}`, ip: actor.ip }, tx);
  });
}

export async function createLocation(input: { code: string; name: string }, actor: Actor) {
  const loc = await prisma.inventoryLocation.create({ data: { code: input.code.trim().toUpperCase(), name: input.name.trim() } });
  await audit({ userId: actor.userId, action: "inventory.location_create", entityType: "InventoryLocation", entityId: loc.id, summary: `Created location ${loc.code}`, ip: actor.ip });
  return loc;
}
