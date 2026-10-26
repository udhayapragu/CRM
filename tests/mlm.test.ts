import { beforeEach, describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { createPayout, recalculateOrderCommissions, setCommissionStatus } from "@/server/services/mlm";
import { updateSettings } from "@/server/services/settings";
import { confirmDelivery, dispatchShipment, packOrder, recordReturn } from "@/server/services/dispatch";
import { makeItem, makeOrder, makeProduct, makeUser, resetDb } from "./helpers";

async function setup(opts: { reviewed?: boolean } = {}) {
  const u = await makeUser();
  await updateSettings({ mlmEnabled: true, mlmCommissionTrigger: "DELIVERED" });
  const sponsor = await prisma.member.create({ data: { name: "Sponsor", referralCode: "SPON1", status: "ACTIVE" } });
  const seller = await prisma.member.create({ data: { name: "Seller", referralCode: "SELL1", status: "ACTIVE", sponsorId: sponsor.id } });
  await prisma.commissionRule.create({ data: { name: "Retail", level: 1, ratePercent: new Prisma.Decimal(10), active: opts.reviewed !== false, legallyReviewed: opts.reviewed !== false } });
  await prisma.commissionRule.create({ data: { name: "Sponsor override", level: 2, ratePercent: new Prisma.Decimal(2), active: opts.reviewed !== false, legallyReviewed: opts.reviewed !== false } });
  const product = await makeProduct();
  await makeItem({ sku: "TP-1", category: "PRODUCT", productId: product.id, opening: 50 });
  const order = await makeOrder({ lines: [{ productId: product.id, quantity: 2, price: 1000 }] });
  await prisma.memberSale.create({ data: { memberId: seller.id, orderId: order.id } });
  const deliver = async () => {
    const s = await packOrder(order.id, { lines: [{ orderItemId: order.items[0].id, quantity: 2 }] }, { userId: u.id });
    await dispatchShipment(s.id, { courier: "DTDC" }, { userId: u.id });
    await confirmDelivery(s.id, {}, { userId: u.id });
  };
  return { u, sponsor, seller, order, deliver };
}

describe("MLM commissions (compliance rules)", () => {
  beforeEach(resetDb);

  it("registering members never creates commissions", async () => {
    const { sponsor } = await setup();
    for (let i = 0; i < 5; i++) await prisma.member.create({ data: { name: `Recruit ${i}`, referralCode: `REC${i}`, status: "ACTIVE", sponsorId: sponsor.id } });
    expect(await prisma.commission.count()).toBe(0);
  });

  it("no commission before the sale is verified (paid + delivered)", async () => {
    const { order } = await setup();
    await prisma.$transaction((tx) => recalculateOrderCommissions(tx, order.id));
    expect(await prisma.commission.count()).toBe(0);
  });

  it("creates level commissions on delivered sales only under reviewed rules", async () => {
    const { order, deliver, seller, sponsor } = await setup();
    await deliver();
    const cs = await prisma.commission.findMany({ where: { orderId: order.id }, orderBy: { level: "asc" } });
    expect(cs).toHaveLength(2);
    expect(cs[0]).toMatchObject({ memberId: seller.id, level: 1, status: "PENDING" });
    expect(Number(cs[0].amount)).toBe(200);
    expect(cs[1]).toMatchObject({ memberId: sponsor.id, level: 2 });
    expect(Number(cs[1].amount)).toBe(40);
    // Idempotent
    await prisma.$transaction((tx) => recalculateOrderCommissions(tx, order.id));
    expect(await prisma.commission.count()).toBe(2);
  });

  it("unreviewed rules generate nothing", async () => {
    const { deliver } = await setup({ reviewed: false });
    await deliver();
    expect(await prisma.commission.count()).toBe(0);
  });

  it("returns resize pending commissions and claw back paid ones", async () => {
    const { order, deliver, seller, u } = await setup();
    await deliver();
    // Return half before payout → pending commissions resized
    await recordReturn(order.id, { reason: "partial", lines: [{ orderItemId: order.items[0].id, quantity: 1, condition: "RESTOCK" }] }, { userId: u.id });
    const l1 = await prisma.commission.findFirstOrThrow({ where: { memberId: seller.id } });
    expect(Number(l1.amount)).toBe(100);
    // Approve & pay, then return the rest → negative adjustment for next payout
    const all = await prisma.commission.findMany();
    await setCommissionStatus(all.map((c) => c.id), "APPROVED", u.id);
    await createPayout(seller.id, "UTR1", u.id);
    await recordReturn(order.id, { reason: "rest", lines: [{ orderItemId: order.items[0].id, quantity: 1, condition: "RESTOCK" }] }, { userId: u.id });
    const adj = await prisma.commission.findFirstOrThrow({ where: { memberId: seller.id, adjustsId: l1.id } });
    expect(Number(adj.amount)).toBe(-100);
    expect(adj.status).toBe("PENDING");
  });

  it("does nothing when the module is disabled", async () => {
    const { order, deliver } = await setup();
    await updateSettings({ mlmEnabled: false });
    await deliver();
    await prisma.$transaction((tx) => recalculateOrderCommissions(tx, order.id));
    expect(await prisma.commission.count()).toBe(0);
  });
});
