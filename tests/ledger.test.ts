import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { getDefaultLocationId, postLedgerEntry, transferStock, verifyItem, withLedgerTx } from "@/server/services/inventory-ledger";
import { recordMovement } from "@/server/services/inventory-ops";
import { item, makeItem, makeUser, resetDb } from "./helpers";

describe("inventory ledger — stock calculations", () => {
  beforeEach(resetDb);

  it("reproduces the specification example: 1000 + 200 − 150 − 10 = 1040", async () => {
    const u = await makeUser("INVENTORY_MANAGER");
    const bottle = await makeItem({ sku: "BTL-100", opening: 1000, userId: u.id });
    await recordMovement({ itemId: bottle.id, kind: "STOCK_IN", quantity: 200, reason: "Supplier delivery" }, { userId: u.id });
    await recordMovement({ itemId: bottle.id, kind: "STOCK_OUT", quantity: 150, reason: "Production batch" }, { userId: u.id });
    await recordMovement({ itemId: bottle.id, kind: "DAMAGE", quantity: 10, reason: "Broken" }, { userId: u.id });
    const b = await item(bottle.id);
    expect(b.qtyOpening).toBe(1000);
    expect(b.qtyReceived).toBe(200);
    expect(b.qtyConsumed).toBe(150);
    expect(b.qtyDamaged).toBe(10);
    expect(b.qtyOnHand).toBe(1040);
    expect((await verifyItem(bottle.id)).ok).toBe(true);
    const entries = await prisma.inventoryLedgerEntry.findMany({ where: { itemId: bottle.id }, orderBy: { createdAt: "asc" } });
    expect(entries.map((e) => e.quantity)).toEqual([1000, 200, -150, -10]);
    expect(entries.at(-1)!.balanceAfter).toBe(1040);
    expect(entries.every((e) => e.reason.length > 0)).toBe(true);
    expect(entries.slice(1).every((e) => e.userId === u.id)).toBe(true);
  });

  it("available stock accounts for reservations", async () => {
    const it1 = await makeItem({ sku: "R-1", opening: 50 });
    await prisma.inventoryItem.update({ where: { id: it1.id }, data: { qtyReserved: 20 } });
    const x = await item(it1.id);
    expect(x.qtyOnHand - x.qtyReserved).toBe(30);
  });

  it("rejects movements that would make physical stock negative", async () => {
    const u = await makeUser();
    const cap = await makeItem({ sku: "CAP-1", opening: 5 });
    await expect(recordMovement({ itemId: cap.id, kind: "STOCK_OUT", quantity: 6, reason: "Too many" }, { userId: u.id })).rejects.toMatchObject({ code: "INSUFFICIENT_STOCK" });
    expect((await item(cap.id)).qtyOnHand).toBe(5);
    expect(await prisma.inventoryLedgerEntry.count({ where: { itemId: cap.id } })).toBe(1);
  });

  it("requires a reason for every movement and supports signed adjustments", async () => {
    const u = await makeUser();
    const lbl = await makeItem({ sku: "LBL-1", opening: 100 });
    await expect(recordMovement({ itemId: lbl.id, kind: "ADJUSTMENT", quantity: -3, reason: "   " }, { userId: u.id })).rejects.toMatchObject({ code: "REASON_REQUIRED" });
    await recordMovement({ itemId: lbl.id, kind: "ADJUSTMENT", quantity: -3, reason: "Cycle count" }, { userId: u.id });
    await recordMovement({ itemId: lbl.id, kind: "ADJUSTMENT", quantity: 1, reason: "Found one" }, { userId: u.id });
    const l = await item(lbl.id);
    expect(l.qtyAdjusted).toBe(-2);
    expect(l.qtyOnHand).toBe(98);
    const audits = await prisma.auditLog.count({ where: { entityId: lbl.id, action: "inventory.adjustment" } });
    expect(audits).toBe(2);
  });

  it("idempotency keys make repeated business events a no-op", async () => {
    const x = await makeItem({ sku: "IDEM", opening: 10 });
    const post = () => withLedgerTx((tx) => postLedgerEntry(tx, { itemId: x.id, type: "CONSUMPTION", quantity: 4, reason: "test", idempotencyKey: "evt-1" }));
    const a = await post();
    const b = await post();
    expect(a.duplicate).toBe(false);
    expect(b.duplicate).toBe(true);
    expect(b.entryId).toBe(a.entryId);
    expect((await item(x.id)).qtyOnHand).toBe(6);
  });

  it("the ledger is append-only at the database level", async () => {
    const x = await makeItem({ sku: "IMM", opening: 10 });
    const e = await prisma.inventoryLedgerEntry.findFirstOrThrow({ where: { itemId: x.id } });
    await expect(prisma.inventoryLedgerEntry.update({ where: { id: e.id }, data: { quantity: 999 } })).rejects.toThrow(/append-only/);
    await expect(prisma.inventoryLedgerEntry.delete({ where: { id: e.id } })).rejects.toThrow(/append-only/);
  });

  it("transfers move stock between locations without changing the total", async () => {
    const x = await makeItem({ sku: "TRF", opening: 40 });
    const main = await getDefaultLocationId();
    const wh2 = await prisma.inventoryLocation.create({ data: { code: "WH2", name: "Second" } });
    await withLedgerTx((tx) => transferStock(tx, { itemId: x.id, fromLocationId: main, toLocationId: wh2.id, quantity: 15, reason: "Rebalance", transferId: "t1" }));
    const levels = await prisma.stockLevel.findMany({ where: { itemId: x.id } });
    expect(levels.find((l) => l.locationId === main)!.qtyOnHand).toBe(25);
    expect(levels.find((l) => l.locationId === wh2.id)!.qtyOnHand).toBe(15);
    expect((await item(x.id)).qtyOnHand).toBe(40);
    await expect(withLedgerTx((tx) => transferStock(tx, { itemId: x.id, fromLocationId: wh2.id, toLocationId: main, quantity: 16, reason: "Too much", transferId: "t2" }))).rejects.toMatchObject({ code: "INSUFFICIENT_STOCK" });
  });
});

describe("inventory ledger — concurrency", () => {
  beforeEach(resetDb);

  it("serialises concurrent stock-outs: never oversells, totals stay consistent", async () => {
    const u = await makeUser();
    const x = await makeItem({ sku: "CONC", opening: 100 });
    const attempts = Array.from({ length: 12 }, (_, i) => recordMovement({ itemId: x.id, kind: "STOCK_OUT", quantity: 15, reason: `Concurrent ${i}` }, { userId: u.id }).then(() => "ok", (e) => e.code));
    const results = await Promise.all(attempts);
    expect(results.filter((r) => r === "ok")).toHaveLength(6); // 6 × 15 = 90 ≤ 100
    expect(results.filter((r) => r === "INSUFFICIENT_STOCK")).toHaveLength(6);
    const final = await item(x.id);
    expect(final.qtyOnHand).toBe(10);
    expect((await verifyItem(x.id)).ok).toBe(true);
    const balances = (await prisma.inventoryLedgerEntry.findMany({ where: { itemId: x.id }, orderBy: { balanceAfter: "desc" } })).map((e) => e.balanceAfter);
    expect(new Set(balances).size).toBe(balances.length); // no two writers saw the same balance
  });

  it("concurrent identical idempotent events produce exactly one entry", async () => {
    const x = await makeItem({ sku: "CONC2", opening: 50 });
    const run = () => withLedgerTx((tx) => postLedgerEntry(tx, { itemId: x.id, type: "DISPATCH", quantity: 5, reason: "dispatch", idempotencyKey: "ship-1" }));
    await Promise.all(Array.from({ length: 8 }, run));
    expect(await prisma.inventoryLedgerEntry.count({ where: { idempotencyKey: "ship-1" } })).toBe(1);
    expect((await item(x.id)).qtyOnHand).toBe(45);
  });
});
