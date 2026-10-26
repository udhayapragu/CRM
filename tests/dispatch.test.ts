import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { verifyItem } from "@/server/services/inventory-ledger";
import { cancelPackedShipment, confirmDelivery, dispatchShipment, packOrder, recordReturn } from "@/server/services/dispatch";
import { changeOrderStatus } from "@/server/services/orders";
import { item, makeItem, makeOrder, makeProduct, makeUser, resetDb } from "./helpers";

async function setup() {
  const u = await makeUser("DISPATCH_MANAGER");
  const product = await makeProduct();
  const stock = await makeItem({ sku: "TP-1", category: "PRODUCT", productId: product.id, opening: 20 });
  const bottle = await makeItem({ sku: "BTL", opening: 100 });
  const sticker = await makeItem({ sku: "STK", opening: 100 });
  await prisma.consumptionRule.createMany({ data: [{ productId: product.id, materialId: bottle.id, quantityPerUnit: 1 }, { productId: product.id, materialId: sticker.id, quantityPerUnit: 2 }] });
  return { u, product, stock, bottle, sticker, actor: { userId: u.id } };
}

describe("order dispatch & fulfilment", () => {
  beforeEach(resetDb);

  it("reserves stock for confirmed orders", async () => {
    const { product, stock } = await setup();
    await makeOrder({ lines: [{ productId: product.id, quantity: 3 }] });
    const s = await item(stock.id);
    expect(s.qtyReserved).toBe(3);
    expect(s.qtyOnHand).toBe(20);
  });

  it("packing does not move stock; dispatch deducts product and packaging exactly once", async () => {
    const { product, stock, bottle, sticker, actor } = await setup();
    const order = await makeOrder({ lines: [{ productId: product.id, quantity: 3 }] });
    const shipment = await packOrder(order.id, { lines: [{ orderItemId: order.items[0].id, quantity: 3 }] }, actor);
    expect((await item(stock.id)).qtyOnHand).toBe(20);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("READY_TO_DISPATCH");

    await dispatchShipment(shipment.id, { courier: "Blue Dart", trackingNumber: "BD1" }, actor);
    const s = await item(stock.id);
    expect(s.qtyOnHand).toBe(17);
    expect(s.qtyDispatched).toBe(3);
    expect(s.qtyReserved).toBe(0);
    expect((await item(bottle.id)).qtyOnHand).toBe(97);
    expect((await item(sticker.id)).qtyOnHand).toBe(94);
    const o = await prisma.order.findUniqueOrThrow({ where: { id: order.id }, include: { items: true } });
    expect(o.status).toBe("DISPATCHED");
    expect(o.shippingStatus).toBe("IN_TRANSIT");
    expect(o.items[0].dispatchedQty).toBe(3);

    // Second dispatch of the same shipment is rejected and changes nothing.
    await expect(dispatchShipment(shipment.id, { courier: "Blue Dart" }, actor)).rejects.toMatchObject({ code: "ALREADY_DISPATCHED" });
    expect((await item(stock.id)).qtyOnHand).toBe(17);
    expect((await item(bottle.id)).qtyOnHand).toBe(97);
    for (const id of [stock.id, bottle.id, sticker.id]) expect((await verifyItem(id)).ok).toBe(true);
  });

  it("concurrent dispatch requests for one shipment deduct stock only once", async () => {
    const { product, stock, actor } = await setup();
    const order = await makeOrder({ lines: [{ productId: product.id, quantity: 2 }] });
    const shipment = await packOrder(order.id, { lines: [{ orderItemId: order.items[0].id, quantity: 2 }] }, actor);
    const results = await Promise.all(Array.from({ length: 5 }, () => dispatchShipment(shipment.id, { courier: "DTDC" }, actor).then(() => "ok", (e) => e.code)));
    expect(results.filter((r) => r === "ok")).toHaveLength(1);
    expect((await item(stock.id)).qtyOnHand).toBe(18);
    expect(await prisma.inventoryLedgerEntry.count({ where: { itemId: stock.id, type: "DISPATCH" } })).toBe(1);
  });

  it("cannot pack more than ordered", async () => {
    const { product, actor } = await setup();
    const order = await makeOrder({ lines: [{ productId: product.id, quantity: 2 }] });
    await expect(packOrder(order.id, { lines: [{ orderItemId: order.items[0].id, quantity: 3 }] }, actor)).rejects.toMatchObject({ code: "OVER_PACK" });
  });

  it("dispatch fails atomically when packaging stock is insufficient", async () => {
    const { product, stock, sticker, actor } = await setup();
    await prisma.$transaction(async (tx) => {
      const { postLedgerEntry } = await import("@/server/services/inventory-ledger");
      await postLedgerEntry(tx, { itemId: sticker.id, type: "CONSUMPTION", quantity: 99, reason: "drain" });
    });
    const order = await makeOrder({ lines: [{ productId: product.id, quantity: 1 }] });
    const shipment = await packOrder(order.id, { lines: [{ orderItemId: order.items[0].id, quantity: 1 }] }, actor);
    await expect(dispatchShipment(shipment.id, { courier: "DTDC" }, actor)).rejects.toMatchObject({ code: "INSUFFICIENT_STOCK" });
    expect((await item(stock.id)).qtyOnHand).toBe(20); // product deduction rolled back too
    expect((await prisma.shipment.findUniqueOrThrow({ where: { id: shipment.id } })).dispatchedAt).toBeNull();
  });

  it("delivery requires a dispatched shipment and marks the order delivered", async () => {
    const { product, actor } = await setup();
    const order = await makeOrder({ lines: [{ productId: product.id, quantity: 1 }] });
    const shipment = await packOrder(order.id, { lines: [{ orderItemId: order.items[0].id, quantity: 1 }] }, actor);
    await expect(confirmDelivery(shipment.id, {}, actor)).rejects.toMatchObject({ code: "INVALID_STATE" });
    await dispatchShipment(shipment.id, { courier: "DTDC" }, actor);
    await confirmDelivery(shipment.id, { note: "POD 123" }, actor);
    const o = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(o.status).toBe("DELIVERED");
    expect(o.shippingStatus).toBe("DELIVERED");
  });

  it("orders cannot be manually marked dispatched or delivered", async () => {
    const { product, actor } = await setup();
    const order = await makeOrder({ lines: [{ productId: product.id, quantity: 1 }] });
    await expect(changeOrderStatus(order.id, "DISPATCHED", actor)).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
    await expect(changeOrderStatus(order.id, "DELIVERED", actor)).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
  });
});

describe("returns & cancellations", () => {
  beforeEach(resetDb);

  it("cancelling releases reservations and unpacks undispatched shipments", async () => {
    const { product, stock, actor } = await setup();
    const order = await makeOrder({ lines: [{ productId: product.id, quantity: 4 }] });
    await packOrder(order.id, { lines: [{ orderItemId: order.items[0].id, quantity: 2 }] }, actor);
    expect((await item(stock.id)).qtyReserved).toBe(4);
    await changeOrderStatus(order.id, "CANCELLED", actor);
    expect((await item(stock.id)).qtyReserved).toBe(0);
    expect((await item(stock.id)).qtyOnHand).toBe(20);
    const o = await prisma.order.findUniqueOrThrow({ where: { id: order.id }, include: { items: true, shipments: true } });
    expect(o.items[0].packedQty).toBe(0);
    expect(o.shipments[0].status).toBe("CANCELLED");
  });

  it("cannot cancel after dispatch — a return must be recorded", async () => {
    const { product, actor } = await setup();
    const order = await makeOrder({ lines: [{ productId: product.id, quantity: 1 }] });
    const s = await packOrder(order.id, { lines: [{ orderItemId: order.items[0].id, quantity: 1 }] }, actor);
    await dispatchShipment(s.id, { courier: "DTDC" }, actor);
    await expect(changeOrderStatus(order.id, "CANCELLED", actor)).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
  });

  it("restocked returns go back to stock; damaged returns are written off", async () => {
    const { product, stock, actor } = await setup();
    const order = await makeOrder({ lines: [{ productId: product.id, quantity: 3 }] });
    const s = await packOrder(order.id, { lines: [{ orderItemId: order.items[0].id, quantity: 3 }] }, actor);
    await dispatchShipment(s.id, { courier: "DTDC" }, actor);
    expect((await item(stock.id)).qtyOnHand).toBe(17);
    await recordReturn(order.id, { reason: "Changed mind", lines: [{ orderItemId: order.items[0].id, quantity: 2, condition: "RESTOCK" }] }, actor);
    expect((await item(stock.id)).qtyOnHand).toBe(19);
    await recordReturn(order.id, { reason: "Arrived broken", lines: [{ orderItemId: order.items[0].id, quantity: 1, condition: "DAMAGED" }] }, actor);
    const st = await item(stock.id);
    expect(st.qtyOnHand).toBe(19);
    expect(st.qtyReturned).toBe(3);
    expect(st.qtyDamaged).toBe(1);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("RETURNED");
    await expect(recordReturn(order.id, { reason: "again", lines: [{ orderItemId: order.items[0].id, quantity: 1, condition: "RESTOCK" }] }, actor)).rejects.toMatchObject({ code: "OVER_RETURN" });
    expect((await verifyItem(stock.id)).ok).toBe(true);
  });

  it("unpacking a packed shipment releases packed quantities", async () => {
    const { product, actor } = await setup();
    const order = await makeOrder({ lines: [{ productId: product.id, quantity: 2 }] });
    const s = await packOrder(order.id, { lines: [{ orderItemId: order.items[0].id, quantity: 2 }] }, actor);
    await cancelPackedShipment(s.id, actor);
    const o = await prisma.order.findUniqueOrThrow({ where: { id: order.id }, include: { items: true } });
    expect(o.items[0].packedQty).toBe(0);
    expect(o.status).toBe("READY_TO_PACK");
  });
});
