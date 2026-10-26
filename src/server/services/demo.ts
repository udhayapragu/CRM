/**
 * Demo environment. Lets the CRM be explored before WordPress credentials are configured.
 * Every record created here has isDemo = true and is visibly labelled in the UI.
 * Demo data must be cleared before a real WordPress connection can be enabled.
 */
import { Prisma, type InventoryCategory, type OrderStatus, type Product } from "@prisma/client";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { addDays } from "@/lib/utils";
import { audit } from "@/server/audit";
import { getDefaultLocationId, postLedgerEntry, withLedgerTx } from "./inventory-ledger";
import { syncOrderReservations, addOrderEvent } from "./orders";
import { confirmDelivery, dispatchShipment, packOrder, recordReturn } from "./dispatch";
import { ensureDefaultStages } from "./onboarding";
import { hasDemoData } from "./settings";

// Deterministic pseudo-random generator so demo data is stable between loads.
function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

const PRODUCTS = [
  { name: "Noir Velvet Eau de Parfum 100ml", sku: "LX-NV-100", price: 4890, cat: "Perfume" },
  { name: "Amethyst Oud Eau de Parfum 50ml", sku: "LX-AO-50", price: 3650, cat: "Perfume" },
  { name: "Golden Saffron Attar 12ml", sku: "LX-GS-12", price: 1990, cat: "Attar" },
  { name: "Royal Musk Body Mist 200ml", sku: "LX-RM-200", price: 1450, cat: "Body Mist" },
  { name: "Midnight Rose Eau de Parfum 100ml", sku: "LX-MR-100", price: 4590, cat: "Perfume" },
  { name: "Imperial Amber Gift Set", sku: "LX-IA-SET", price: 6990, cat: "Gift Sets" },
  { name: "Silk Jasmine Hair Perfume 50ml", sku: "LX-SJ-50", price: 1290, cat: "Hair Care" },
  { name: "Obsidian Leather Cologne 100ml", sku: "LX-OL-100", price: 3990, cat: "Perfume" },
  { name: "Pearl Vanilla Body Lotion 250ml", sku: "LX-PV-250", price: 990, cat: "Body Care" },
  { name: "Celestial Iris Discovery Kit", sku: "LX-CI-KIT", price: 2490, cat: "Gift Sets" },
];

const MATERIALS: { name: string; sku: string; category: InventoryCategory; unit: string; opening: number; reorder: number }[] = [
  { name: "Glass bottle 100ml (black frosted)", sku: "PK-BTL-100", category: "BOTTLE", unit: "pcs", opening: 1000, reorder: 150 },
  { name: "Glass bottle 50ml (amethyst)", sku: "PK-BTL-50", category: "BOTTLE", unit: "pcs", opening: 600, reorder: 120 },
  { name: "Gold foil front label", sku: "PK-LBL-GOLD", category: "LABEL", unit: "pcs", opening: 2000, reorder: 300 },
  { name: "Batch & barcode sticker", sku: "PK-LBL-BATCH", category: "LABEL", unit: "pcs", opening: 2500, reorder: 400 },
  { name: "Zamac magnetic cap (gold)", sku: "PK-CAP-GOLD", category: "CAP", unit: "pcs", opening: 900, reorder: 150 },
  { name: "Rigid gift box (purple velvet)", sku: "PK-BOX-RIGID", category: "BOX", unit: "pcs", opening: 400, reorder: 80 },
  { name: "Shipping carton 3-ply", sku: "PK-CTN-3PLY", category: "BOX", unit: "pcs", opening: 700, reorder: 100 },
  { name: "Tissue paper (black)", sku: "PK-TISSUE", category: "PACKAGING", unit: "sheets", opening: 1500, reorder: 200 },
  { name: "Fragrance oil — Oud base", sku: "RM-OIL-OUD", category: "RAW_MATERIAL", unit: "ml", opening: 20000, reorder: 3000 },
  { name: "Perfumer's alcohol", sku: "RM-ALC", category: "RAW_MATERIAL", unit: "ml", opening: 50000, reorder: 8000 },
];

const NAMES = ["Aarav Mehta", "Diya Kapoor", "Kabir Singh", "Ananya Iyer", "Vihaan Rao", "Saanvi Nair", "Arjun Malhotra", "Ishita Verma", "Reyansh Gupta", "Meera Pillai", "Rohan Desai", "Tara Joshi", "Neel Banerjee", "Kiara Sethi", "Dev Choudhary"];
const CITIES = ["Mumbai", "Bengaluru", "New Delhi", "Chennai", "Hyderabad", "Pune", "Kolkata", "Jaipur"];
const COURIERS = ["Blue Dart", "Delhivery", "DTDC", "Ecom Express"];

export async function loadDemoData(userId: string) {
  if (await prisma.wordPressConnection.count({ where: { enabled: true } })) {
    throw new AppError("A live WordPress connection is enabled. Demo data cannot be loaded alongside real data.", 409, "LIVE_CONNECTION");
  }
  if (await prisma.order.count({ where: { isDemo: false } })) {
    throw new AppError("Real orders already exist. Demo data can only be loaded into an empty system.", 409, "REAL_DATA_PRESENT");
  }
  if (await hasDemoData()) throw new AppError("Demo data is already loaded", 409, "ALREADY_LOADED");
  await ensureDefaultStages();
  const rand = rng(42);
  const pick = <T,>(arr: readonly T[]) => arr[Math.floor(rand() * arr.length)];
  const now = new Date();
  const actor = { userId };

  // Suppliers
  const suppliers = await Promise.all(
    [
      { name: "Crystalline Glassworks Pvt Ltd", contactName: "R. Shah", email: "sales@example.com", phone: "+91 22 0000 0001" },
      { name: "Aurum Print & Labels", contactName: "P. Menon", email: "orders@example.com", phone: "+91 80 0000 0002" },
      { name: "Grasse Essence Imports", contactName: "L. Fernandes", email: "supply@example.com", phone: "+91 11 0000 0003" },
    ].map((s) => prisma.supplier.create({ data: { ...s, isDemo: true, notes: "Demo supplier" } })),
  );

  // Products + physical stock items
  const products: Product[] = [];
  for (const [i, p] of PRODUCTS.entries()) {
    const product = await prisma.product.create({
      data: {
        name: p.name,
        sku: p.sku,
        source: "DEMO",
        isDemo: true,
        categories: [p.cat],
        price: new Prisma.Decimal(p.price),
        regularPrice: new Prisma.Decimal(p.price),
        wpStatus: i === 9 ? "draft" : "publish",
        wpManageStock: true,
        wpStockQuantity: Math.round(20 + rand() * 120),
        wpStockStatus: "instock",
        lowStockThreshold: 15,
        currency: "INR",
        externalCreatedAt: addDays(now, -Math.round(rand() * 200)),
      },
    });
    products.push(product);
  }

  const location = await getDefaultLocationId();
  const items: Record<string, string> = {};
  await withLedgerTx(async (tx) => {
    for (const [i, p] of products.entries()) {
      if (i === 9) continue; // one untracked product to demonstrate website-only stock
      const opening = [180, 140, 260, 320, 22, 60, 0, 95, 400, 0][i];
      const it = await tx.inventoryItem.create({
        data: { name: p.name, sku: p.sku!, category: "PRODUCT", productId: p.id, reorderLevel: 15, isDemo: true },
      });
      items[p.sku!] = it.id;
      if (opening > 0) {
        await postLedgerEntry(tx, { itemId: it.id, locationId: location, type: "OPENING", quantity: opening, reason: "Opening stock (demo)", idempotencyKey: `opening:${it.id}:${location}`, userId, isDemo: true, demoOccurredAt: addDays(now, -45) });
      }
    }
    for (const m of MATERIALS) {
      const it = await tx.inventoryItem.create({
        data: { name: m.name, sku: m.sku, category: m.category, unit: m.unit, reorderLevel: m.reorder, isDemo: true, supplierId: m.category === "LABEL" ? suppliers[1].id : m.category === "RAW_MATERIAL" ? suppliers[2].id : suppliers[0].id },
      });
      items[m.sku] = it.id;
      await postLedgerEntry(tx, { itemId: it.id, locationId: location, type: "OPENING", quantity: m.opening, reason: "Opening stock (demo)", idempotencyKey: `opening:${it.id}:${location}`, userId, isDemo: true, demoOccurredAt: addDays(now, -45) });
    }
    // A goods receipt and some wastage for history
    const grn = await tx.purchaseReceipt.create({
      data: { number: "GRN-DEMO-0001", supplierId: suppliers[0].id, invoiceRef: "INV-7781", receivedAt: addDays(now, -20), isDemo: true, createdById: userId, totalCost: new Prisma.Decimal(200 * 38), lines: { create: [{ itemId: items["PK-BTL-100"], quantity: 200, unitCost: new Prisma.Decimal(38) }] } },
      include: { lines: true },
    });
    await postLedgerEntry(tx, { itemId: items["PK-BTL-100"], locationId: location, type: "RECEIPT", quantity: 200, reason: "Goods received GRN-DEMO-0001 (demo)", referenceType: "PURCHASE_RECEIPT", referenceId: grn.id, idempotencyKey: `grn:${grn.id}:${grn.lines[0].id}`, userId, isDemo: true, demoOccurredAt: addDays(now, -20) });
    await postLedgerEntry(tx, { itemId: items["PK-BTL-100"], locationId: location, type: "DAMAGE", quantity: 10, reason: "Broken in transit from supplier (demo)", userId, isDemo: true, demoOccurredAt: addDays(now, -19) });
    await postLedgerEntry(tx, { itemId: items["PK-BTL-100"], locationId: location, type: "CONSUMPTION", quantity: 150, reason: "Used in production batch B-114 (demo)", userId, isDemo: true, demoOccurredAt: addDays(now, -10) });

    // Consumption rules: each perfume consumes a bottle, front label, batch sticker, cap and carton.
    for (const [i, p] of products.entries()) {
      if (!["Perfume"].includes(PRODUCTS[i].cat)) continue;
      const bottle = p.sku!.endsWith("-50") ? "PK-BTL-50" : "PK-BTL-100";
      for (const [mat, qty] of [[bottle, 1], ["PK-LBL-GOLD", 1], ["PK-LBL-BATCH", 1], ["PK-CAP-GOLD", 1], ["PK-CTN-3PLY", 1]] as const) {
        await tx.consumptionRule.create({ data: { productId: p.id, materialId: items[mat], quantityPerUnit: qty, notes: "Demo rule" } });
      }
    }
  });

  // Orders across the last 30 days
  const plan: OrderStatus[] = [];
  for (let i = 0; i < 64; i++) {
    const r = rand();
    plan.push(r < 0.34 ? "DELIVERED" : r < 0.5 ? "DISPATCHED" : r < 0.6 ? "READY_TO_DISPATCH" : r < 0.7 ? "PROCESSING" : r < 0.8 ? "CONFIRMED" : r < 0.87 ? "NEW" : r < 0.91 ? "PENDING_PAYMENT" : r < 0.95 ? "CANCELLED" : r < 0.97 ? "ON_HOLD" : "RETURNED");
  }
  let n = 1001;
  for (const target of plan) {
    const daysAgo = Math.floor(rand() * 30);
    const orderDate = addDays(now, -daysAgo);
    orderDate.setHours(9 + Math.floor(rand() * 11), Math.floor(rand() * 60));
    const lineCount = 1 + Math.floor(rand() * 2);
    const chosen = new Set<number>();
    while (chosen.size < lineCount) chosen.add(Math.floor(rand() * 8)); // tracked products only (idx 0–7 except 6 which has 0 stock)
    chosen.delete(6);
    if (!chosen.size) chosen.add(0);
    const lines = [...chosen].map((idx) => ({ p: products[idx], qty: 1 + Math.floor(rand() * 2) }));
    const subtotal = lines.reduce((s, l) => s + Number(l.p.price) * l.qty, 0);
    const name = pick(NAMES);
    const city = pick(CITIES);
    const paid = !["PENDING_PAYMENT", "NEW"].includes(target) || rand() > 0.5;
    const order = await prisma.order.create({
      data: {
        number: `D${n++}`,
        source: "DEMO",
        isDemo: true,
        customerName: name,
        customerEmail: `${name.split(" ")[0].toLowerCase()}@example.com`,
        customerPhone: "+91 90000 0" + String(1000 + Math.floor(rand() * 8999)),
        shippingAddress: { first_name: name.split(" ")[0], last_name: name.split(" ")[1], address_1: `${Math.floor(rand() * 200) + 1} Demo Residency`, city, country: "IN", postcode: String(400000 + Math.floor(rand() * 99999)) },
        shippingMethod: "Express shipping",
        paymentMethod: rand() > 0.3 ? "Razorpay (UPI/Card)" : "Cash on delivery",
        currency: "INR",
        subtotal: new Prisma.Decimal(subtotal),
        shippingTotal: new Prisma.Decimal(subtotal > 3000 ? 0 : 99),
        total: new Prisma.Decimal(subtotal + (subtotal > 3000 ? 0 : 99)),
        status: target === "PENDING_PAYMENT" ? "PENDING_PAYMENT" : target === "NEW" ? "NEW" : target === "ON_HOLD" ? "ON_HOLD" : "CONFIRMED",
        paymentStatus: target === "PENDING_PAYMENT" ? "PENDING" : paid ? "PAID" : "UNPAID",
        paidAt: paid ? orderDate : null,
        orderDate,
        expectedDispatchDate: addDays(orderDate, 2),
        items: { create: lines.map((l) => ({ productId: l.p.id, name: l.p.name, sku: l.p.sku, quantity: l.qty, unitPrice: l.p.price ?? 0, total: new Prisma.Decimal(Number(l.p.price) * l.qty) })) },
      },
      include: { items: true },
    });
    await prisma.$transaction(async (tx) => {
      await addOrderEvent(tx, { orderId: order.id, type: "SYNC", actor: "SYSTEM", toValue: order.status, message: "Demo order created" });
      await syncOrderReservations(tx, order.id);
    });

    const advance = async () => {
      if (target === "PROCESSING") {
        await prisma.order.update({ where: { id: order.id }, data: { status: "PROCESSING" } });
        return;
      }
      if (target === "CANCELLED") {
        await prisma.$transaction(async (tx) => {
          await tx.order.update({ where: { id: order.id }, data: { status: "CANCELLED" } });
          await syncOrderReservations(tx, order.id);
          await addOrderEvent(tx, { orderId: order.id, type: "STATUS", actor: "SYSTEM", toValue: "CANCELLED", message: "Cancelled by customer (demo)" });
        });
        return;
      }
      if (!["READY_TO_DISPATCH", "DISPATCHED", "DELIVERED", "RETURNED"].includes(target)) return;
      const shipment = await packOrder(order.id, { lines: order.items.map((i) => ({ orderItemId: i.id, quantity: i.quantity })) }, actor);
      if (target === "READY_TO_DISPATCH") return;
      const dispatchedAt = addDays(orderDate, rand() > 0.7 ? 2 : 1);
      if (dispatchedAt > now) dispatchedAt.setTime(now.getTime() - 3600_000);
      await dispatchShipment(shipment.id, { courier: pick(COURIERS), trackingNumber: `DEMO${Math.floor(rand() * 1e9)}`, dispatchedAt, expectedDeliveryAt: addDays(dispatchedAt, 4), awaitingPickup: target === "DISPATCHED" && rand() > 0.75 }, actor);
      await prisma.shipment.update({ where: { id: shipment.id }, data: { packedAt: new Date(dispatchedAt.getTime() - 3 * 3600_000) } });
      if (target === "DISPATCHED") return;
      await confirmDelivery(shipment.id, { deliveredAt: addDays(dispatchedAt, 3) > now ? now : addDays(dispatchedAt, 3), note: "Demo delivery" }, actor);
      if (target === "RETURNED") {
        await recordReturn(order.id, { reason: "Customer changed mind (demo)", lines: order.items.map((i, k) => ({ orderItemId: i.id, quantity: i.quantity, condition: k === 0 ? "RESTOCK" : "DAMAGED" })) }, actor);
      }
    };
    await advance();
  }
  // One order flagged for attention
  const flagged = await prisma.order.findFirst({ where: { isDemo: true, status: "CONFIRMED" } });
  if (flagged) await prisma.order.update({ where: { id: flagged.id }, data: { needsAttention: true, attentionReason: "Customer requested gift wrapping and a handwritten note (demo)" } });

  // Onboarding pipeline
  const stages = await prisma.onboardingStage.findMany({ orderBy: { position: "asc" } });
  const ideas = ["Velvet Fig Eau de Parfum", "Saffron Rose Candle", "Oud Wood Travel Spray", "Lotus Bloom Body Oil", "Black Orchid Gift Box", "Citrus Noir Cologne", "Sandalwood Beard Oil", "Moonlit Musk Roll-on", "Cashmere Amber Diffuser", "Ivory Neroli Hand Cream", "Ruby Peony Mist", "Platinum Vetiver EDP"];
  for (const [i, title] of ideas.entries()) {
    const stage = stages[i % (stages.length - 1)];
    const item = await prisma.onboardingItem.create({
      data: { title, sku: `NEW-${100 + i}`, category: pick(["Perfume", "Body Care", "Home Fragrance", "Gift Sets"]), stageId: stage.id, priority: pick(["LOW", "MEDIUM", "HIGH", "URGENT"]), ownerId: userId, dueDate: addDays(now, Math.round(rand() * 40) - 5), isDemo: true, description: "Demo onboarding item", stageEnteredAt: addDays(now, -Math.round(rand() * 12)) },
    });
    await prisma.onboardingTask.createMany({
      data: [
        { itemId: item.id, title: "Finalise product description & notes", done: rand() > 0.4, assigneeId: userId },
        { itemId: item.id, title: "Upload compliance documents (MSDS, label approval)", done: rand() > 0.6 },
        { itemId: item.id, title: "Approve packaging artwork", done: rand() > 0.7 },
      ],
    });
  }
  const rejected = stages.find((s) => s.key === "REJECTED_ON_HOLD");
  if (rejected) await prisma.onboardingItem.create({ data: { title: "Neon Citrus Splash", stageId: rejected.id, holdReason: "Supplier could not meet IFRA compliance (demo)", isDemo: true, priority: "LOW" } });

  // MLM sample members (no commissions are generated unless the module is enabled with reviewed rules)
  const root = await prisma.member.create({ data: { referralCode: "DEMOROOT1", name: "Asha Rao (demo)", status: "ACTIVE", activatedAt: addDays(now, -90), isDemo: true } });
  const m2 = await prisma.member.create({ data: { referralCode: "DEMOVIK22", name: "Vikram Shah (demo)", status: "ACTIVE", sponsorId: root.id, activatedAt: addDays(now, -60), isDemo: true } });
  await prisma.member.create({ data: { referralCode: "DEMONEH33", name: "Neha Kulkarni (demo)", status: "PENDING", sponsorId: m2.id, isDemo: true } });

  await prisma.appSetting.upsert({ where: { key: "demoLoadedAt" }, create: { key: "demoLoadedAt", value: now.toISOString() }, update: { value: now.toISOString() } });
  await audit({ userId, action: "demo.load", entityType: "System", summary: "Demo environment loaded" });
}

export async function clearDemoData(userId: string) {
  const counts = await prisma.$transaction(
    async (tx) => {
      const c: Record<string, number> = {};
      c.commissions = (await tx.commission.deleteMany({ where: { isDemo: true } })).count;
      c.payouts = (await tx.payout.deleteMany({ where: { isDemo: true } })).count;
      await tx.memberSale.deleteMany({ where: { order: { isDemo: true } } });
      await tx.member.updateMany({ where: { isDemo: true }, data: { sponsorId: null } });
      c.members = (await tx.member.deleteMany({ where: { isDemo: true } })).count;
      c.orders = (await tx.order.deleteMany({ where: { isDemo: true } })).count;
      c.ledgerEntries = (await tx.inventoryLedgerEntry.deleteMany({ where: { isDemo: true } })).count;
      c.receipts = (await tx.purchaseReceipt.deleteMany({ where: { isDemo: true } })).count;
      // Any non-demo ledger rows on demo items would block deletion — keep those items (archived).
      const blocked = await tx.inventoryLedgerEntry.findMany({ where: { isDemo: false, item: { isDemo: true } }, select: { itemId: true }, distinct: ["itemId"] });
      if (blocked.length) await tx.inventoryItem.updateMany({ where: { id: { in: blocked.map((b) => b.itemId) } }, data: { isDemo: false, active: false } });
      c.inventoryItems = (await tx.inventoryItem.deleteMany({ where: { isDemo: true } })).count;
      c.products = (await tx.product.deleteMany({ where: { isDemo: true } })).count;
      c.suppliers = (await tx.supplier.deleteMany({ where: { isDemo: true } })).count;
      c.onboarding = (await tx.onboardingItem.deleteMany({ where: { isDemo: true } })).count;
      c.notifications = (await tx.notification.deleteMany({ where: { OR: [{ isDemo: true }, { dedupeKey: { startsWith: "pending:" } }] } })).count;
      await tx.appSetting.deleteMany({ where: { key: "demoLoadedAt" } });
      return c;
    },
    { timeout: 60_000 },
  );
  await audit({ userId, action: "demo.clear", entityType: "System", summary: "Demo data cleared", metadata: counts });
  return counts;
}
