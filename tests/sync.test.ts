import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { encryptSecret } from "@/lib/crypto";
import { buildAdapter, saveConnection, setConnectionEnabled, testConnection } from "@/server/integrations/wordpress/connection-service";
import { claimNextJob, enqueueSync, runJob } from "@/server/integrations/wordpress/job-runner";
import { syncOrders, syncProducts, upsertOrder } from "@/server/integrations/wordpress/sync-service";
import { mapWcOrder } from "@/server/integrations/wordpress/mappers";
import { computeSignature, handleWooWebhook } from "@/server/integrations/wordpress/webhooks";
import { dispatchShipment, packOrder } from "@/server/services/dispatch";
import { loadDemoData } from "@/server/services/demo";
import { createFakeWoo, noSleep, wcOrder, wcProduct } from "./fake-woo";
import { makeItem, makeUser, resetDb } from "./helpers";

async function connected(fetchImpl: typeof fetch) {
  const u = await makeUser();
  await saveConnection({ siteUrl: "https://shop.test", adapter: "WOOCOMMERCE", consumerKey: "ck_test", consumerSecret: "cs_test", perPage: 10 }, { userId: u.id });
  const c0 = await prisma.wordPressConnection.findFirstOrThrow();
  const result = await testConnection(c0.id, { userId: u.id }, { fetchImpl, sleep: noSleep });
  expect(result.ok).toBe(true);
  await setConnectionEnabled(c0.id, true, { userId: u.id });
  const connection = await prisma.wordPressConnection.findFirstOrThrow();
  const adapter = buildAdapter(connection, { fetchImpl, sleep: noSleep });
  const log = async () => {};
  return { u, connection, ctx: { connection, adapter, log, pageDelayMs: 0, sleep: noSleep } };
}

describe("credentials & connection settings", () => {
  beforeEach(resetDb);

  it("stores credentials encrypted, never in plain text", async () => {
    const u = await makeUser();
    await saveConnection({ siteUrl: "https://shop.test", adapter: "WOOCOMMERCE", consumerKey: "ck_supersecret123", consumerSecret: "cs_supersecret456" }, { userId: u.id });
    const c = await prisma.wordPressConnection.findFirstOrThrow();
    expect(c.consumerKeyEnc).not.toContain("supersecret");
    expect(c.consumerSecretEnc).toMatch(/^v1:/);
    expect(c.status).toBe("UNTESTED");
  });

  it("refuses to enable sync before a successful test, or while demo data exists", async () => {
    const u = await makeUser();
    await saveConnection({ siteUrl: "https://shop.test", adapter: "WOOCOMMERCE", consumerKey: "ck_test", consumerSecret: "cs_test" }, { userId: u.id });
    const c = await prisma.wordPressConnection.findFirstOrThrow();
    await expect(setConnectionEnabled(c.id, true, { userId: u.id })).rejects.toMatchObject({ code: "NOT_TESTED" });
    const { fetchImpl } = createFakeWoo();
    await testConnection(c.id, null, { fetchImpl, sleep: noSleep });
    await prisma.product.create({ data: { name: "Demo", isDemo: true, source: "DEMO" } });
    await expect(setConnectionEnabled(c.id, true, { userId: u.id })).rejects.toMatchObject({ code: "DEMO_DATA_PRESENT" });
  });

  it("a failed test marks the connection as errored", async () => {
    const u = await makeUser();
    await saveConnection({ siteUrl: "https://shop.test", adapter: "WOOCOMMERCE", consumerKey: "ck_wrong", consumerSecret: "cs_wrong" }, { userId: u.id });
    const c = await prisma.wordPressConnection.findFirstOrThrow();
    const r = await testConnection(c.id, null, { fetchImpl: createFakeWoo().fetchImpl, sleep: noSleep });
    expect(r.ok).toBe(false);
    const after = await prisma.wordPressConnection.findFirstOrThrow();
    expect(after.status).toBe("ERROR");
    expect(after.lastTestMessage).toMatch(/Authentication failed/);
  });
});

describe("product synchronisation", () => {
  beforeEach(resetDb);

  it("imports all pages, variations, and is idempotent on re-sync", async () => {
    const products = Array.from({ length: 23 }, (_, i) => wcProduct(i + 1));
    products[4] = wcProduct(5, { type: "variable", variations: [501, 502] });
    const { fetchImpl } = createFakeWoo({ products, variations: { "5": [{ id: 501, sku: "V-S", price: "100", attributes: [{ name: "Size", option: "50ml" }], manage_stock: true, stock_quantity: 3 }, { id: 502, sku: "V-L", price: "180", attributes: [{ name: "Size", option: "100ml" }] }] } });
    const { ctx } = await connected(fetchImpl);
    const s1 = await syncProducts(ctx, { full: true });
    expect(s1.pages).toBe(3);
    expect(s1.created).toBe(23);
    expect(await prisma.product.count()).toBe(23);
    expect(await prisma.productVariant.count()).toBe(2);
    const p1 = await prisma.product.findFirstOrThrow({ where: { externalId: "1" } });
    expect(p1).toMatchObject({ name: "Perfume 1", sku: "SKU-1", wpStockQuantity: 25, source: "WORDPRESS", categories: ["Perfume"] });

    const s2 = await syncProducts(ctx, { full: true });
    expect(s2.created).toBe(0);
    expect(await prisma.product.count()).toBe(23);
  });

  it("never overwrites CRM-owned data (thresholds, physical stock) on re-sync", async () => {
    const products = [wcProduct(1)];
    const { fetchImpl, state } = createFakeWoo({ products });
    const { ctx, u } = await connected(fetchImpl);
    await syncProducts(ctx, { full: true });
    const p = await prisma.product.findFirstOrThrow();
    await prisma.product.update({ where: { id: p.id }, data: { lowStockThreshold: 42 } });
    const stock = await makeItem({ sku: "PHYS-1", category: "PRODUCT", productId: p.id, opening: 7, userId: u.id });
    state.products[0] = wcProduct(1, { name: "Perfume 1 (renamed)", stock_quantity: 999, date_modified_gmt: "2026-10-25T10:00:00" });
    await syncProducts(ctx, { full: true });
    const after = await prisma.product.findFirstOrThrow();
    expect(after.name).toBe("Perfume 1 (renamed)");
    expect(after.wpStockQuantity).toBe(999);
    expect(after.lowStockThreshold).toBe(42);
    expect((await prisma.inventoryItem.findUniqueOrThrow({ where: { id: stock.id } })).qtyOnHand).toBe(7);
  });

  it("flags (does not delete) products removed from the website after a full import", async () => {
    const { fetchImpl, state } = createFakeWoo({ products: [wcProduct(1), wcProduct(2)] });
    const { ctx } = await connected(fetchImpl);
    await syncProducts(ctx, { full: true });
    state.products.pop();
    await syncProducts(ctx, { full: true });
    const gone = await prisma.product.findFirstOrThrow({ where: { externalId: "2" } });
    expect(gone.deletedAtSource).not.toBeNull();
  });
});

describe("order synchronisation & duplicate prevention", () => {
  beforeEach(resetDb);

  it("re-syncing the same orders never creates duplicates", async () => {
    const { fetchImpl } = createFakeWoo({ products: [wcProduct(1)], orders: Array.from({ length: 15 }, (_, i) => wcOrder(100 + i)) });
    const { ctx } = await connected(fetchImpl);
    await syncProducts(ctx, { full: true });
    const a = await syncOrders(ctx, { full: true });
    const b = await syncOrders(ctx, { full: true });
    expect(a.created).toBe(15);
    expect(b.created).toBe(0);
    expect(b.unchanged).toBe(15);
    expect(await prisma.order.count()).toBe(15);
    expect(await prisma.orderItem.count()).toBe(15);
    const o = await prisma.order.findFirstOrThrow({ where: { externalId: "100" }, include: { items: true } });
    expect(o).toMatchObject({ status: "NEW", paymentStatus: "PAID", customerName: "Asha Rao", wcStatus: "processing" });
    expect(o.items[0].productId).not.toBeNull();
  });

  it("concurrent upserts of the same order (webhook + sync race) create exactly one record", async () => {
    const { fetchImpl } = createFakeWoo();
    const { connection } = await connected(fetchImpl);
    const n = mapWcOrder(wcOrder(777));
    await Promise.all(Array.from({ length: 6 }, () => upsertOrder(connection, n, "SYNC")));
    expect(await prisma.order.count({ where: { externalId: "777" } })).toBe(1);
    expect(await prisma.orderItem.count()).toBe(1);
  });

  it("skips checkout drafts and maps WooCommerce statuses", async () => {
    const { fetchImpl } = createFakeWoo({ orders: [wcOrder(1, { status: "checkout-draft" }), wcOrder(2, { status: "pending" }), wcOrder(3, { status: "on-hold" }), wcOrder(4, { status: "cancelled" })] });
    const { ctx } = await connected(fetchImpl);
    const s = await syncOrders(ctx, { full: true });
    expect(s.ignored).toBe(1);
    const by = async (id: string) => prisma.order.findFirstOrThrow({ where: { externalId: id } });
    expect(await by("2")).toMatchObject({ status: "PENDING_PAYMENT", paymentStatus: "PENDING" });
    expect(await by("3")).toMatchObject({ status: "ON_HOLD" });
    expect(await by("4")).toMatchObject({ status: "CANCELLED" });
  });

  it("preserves local fulfilment progress when the website status is unchanged", async () => {
    const { fetchImpl, state } = createFakeWoo({ orders: [wcOrder(5)] });
    const { ctx } = await connected(fetchImpl);
    await syncOrders(ctx, { full: true });
    await prisma.order.updateMany({ data: { status: "READY_TO_PACK" } });
    state.orders[0] = wcOrder(5, { customer_note: "Please gift wrap", date_modified_gmt: "2026-10-26T09:00:00" });
    await syncOrders(ctx, { full: true });
    const o = await prisma.order.findFirstOrThrow();
    expect(o.status).toBe("READY_TO_PACK");
    expect(o.customerNote).toBe("Please gift wrap");
  });

  it("website 'completed' without a CRM dispatch is flagged, never auto-deducted or marked delivered", async () => {
    const { fetchImpl, state } = createFakeWoo({ products: [wcProduct(1)], orders: [wcOrder(6)] });
    const { ctx, u } = await connected(fetchImpl);
    await syncProducts(ctx, { full: true });
    const p = await prisma.product.findFirstOrThrow();
    const stock = await makeItem({ sku: "PH", category: "PRODUCT", productId: p.id, opening: 10, userId: u.id });
    await syncOrders(ctx, { full: true });
    state.orders[0] = wcOrder(6, { status: "completed", date_modified_gmt: "2026-10-26T11:00:00" });
    await syncOrders(ctx, { full: true });
    const o = await prisma.order.findFirstOrThrow();
    expect(o.status).toBe("DISPATCHED");
    expect(o.needsAttention).toBe(true);
    expect(o.attentionReason).toMatch(/no dispatch was recorded/);
    expect((await prisma.inventoryItem.findUniqueOrThrow({ where: { id: stock.id } })).qtyOnHand).toBe(10);
  });

  it("cancellation at the website after a CRM dispatch is flagged rather than cancelling", async () => {
    const { fetchImpl, state } = createFakeWoo({ products: [wcProduct(1)], orders: [wcOrder(7)] });
    const { ctx, u } = await connected(fetchImpl);
    await syncProducts(ctx, { full: true });
    await syncOrders(ctx, { full: true });
    const o = await prisma.order.update({ where: { connectionId_externalId: { connectionId: ctx.connection.id, externalId: "7" } }, data: { status: "CONFIRMED" }, include: { items: true } });
    const s = await packOrder(o.id, { lines: [{ orderItemId: o.items[0].id, quantity: 2 }] }, { userId: u.id });
    await dispatchShipment(s.id, { courier: "DTDC" }, { userId: u.id });
    state.orders[0] = wcOrder(7, { status: "cancelled", date_modified_gmt: "2026-10-26T12:00:00" });
    await syncOrders(ctx, { full: true });
    const after = await prisma.order.findUniqueOrThrow({ where: { id: o.id } });
    expect(after.status).toBe("DISPATCHED");
    expect(after.needsAttention).toBe(true);
  });
});

describe("webhooks", () => {
  beforeEach(resetDb);

  it("verifies signatures, processes orders, and ignores replayed deliveries", async () => {
    const { fetchImpl } = createFakeWoo();
    const { connection } = await connected(fetchImpl);
    const secret = "whsec_test";
    await prisma.wordPressConnection.update({ where: { id: connection.id }, data: { webhookSecretEnc: encryptSecret(secret) } });
    const body = JSON.stringify(wcOrder(900));
    const headers = { signature: computeSignature(body, secret), topic: "order.created", deliveryId: "d-1", resource: "order", event: "created" };

    const bad = await handleWooWebhook(connection.id, body, { ...headers, signature: computeSignature(body, "wrong") });
    expect(bad.status).toBe(401);
    expect(await prisma.order.count()).toBe(0);

    const ok = await handleWooWebhook(connection.id, body, headers);
    expect(ok.status).toBe(200);
    expect(await prisma.order.count()).toBe(1);

    const replay = await handleWooWebhook(connection.id, body, headers);
    expect(replay.body).toMatchObject({ duplicate: true });
    expect(await prisma.order.count()).toBe(1);

    const ping = await handleWooWebhook(connection.id, "webhook_id=12", { signature: null, topic: null, deliveryId: null, resource: null, event: null });
    expect(ping.body).toMatchObject({ ping: true });
  });
});

describe("sync jobs", () => {
  beforeEach(resetDb);

  it("de-duplicates queued jobs and retries retryable failures with backoff", async () => {
    const { fetchImpl, state } = createFakeWoo({ failTimes: { status: 503, times: 0, path: "wc/v3/products" } });
    const { connection } = await connected(fetchImpl);
    state.failuresLeft = 50; // the site starts failing after the connection was verified
    const a = await enqueueSync(connection.id, "PRODUCTS", "MANUAL");
    const b = await enqueueSync(connection.id, "PRODUCTS", "MANUAL");
    expect(b.deduplicated).toBe(true);
    expect(b.job.id).toBe(a.job.id);

    const job = await claimNextJob();
    expect(job?.id).toBe(a.job.id);
    expect(await claimNextJob()).toBeNull(); // one running job per connection
    await runJob(job!, { fetchImpl, sleep: noSleep, pageDelayMs: 0 });
    const after = await prisma.syncJob.findUniqueOrThrow({ where: { id: a.job.id } });
    expect(after.status).toBe("QUEUED");
    expect(after.runAfter.getTime()).toBeGreaterThan(Date.now());
    expect(after.error).toMatch(/server error/);
  });

  it("marks auth failures as FAILED (not retried) and raises a notification", async () => {
    const good = createFakeWoo();
    const { connection } = await connected(good.fetchImpl);
    const bad = createFakeWoo({ key: "ck_other" });
    const { job } = await enqueueSync(connection.id, "PRODUCTS", "MANUAL");
    const claimed = await claimNextJob();
    await runJob(claimed!, { fetchImpl: bad.fetchImpl, sleep: noSleep, pageDelayMs: 0 });
    expect((await prisma.syncJob.findUniqueOrThrow({ where: { id: job.id } })).status).toBe("FAILED");
    expect((await prisma.wordPressConnection.findUniqueOrThrow({ where: { id: connection.id } })).status).toBe("ERROR");
    expect(await prisma.notification.count({ where: { type: "SYNC_FAILED" } })).toBe(1);
  });

  it("a successful job advances cursors and records stats", async () => {
    const { fetchImpl } = createFakeWoo({ products: [wcProduct(1)], orders: [wcOrder(1)] });
    const { connection } = await connected(fetchImpl);
    await enqueueSync(connection.id, "FULL", "INITIAL", { fullResync: true });
    await runJob((await claimNextJob())!, { fetchImpl, sleep: noSleep, pageDelayMs: 0 });
    const c = await prisma.wordPressConnection.findUniqueOrThrow({ where: { id: connection.id } });
    expect(c.lastSuccessfulSyncAt).not.toBeNull();
    expect(c.productsCursor).not.toBeNull();
    expect(c.ordersCursor).not.toBeNull();
    const j = await prisma.syncJob.findFirstOrThrow();
    expect(j.status).toBe("SUCCEEDED");
    expect(j.stats).toMatchObject({ products: { created: 1 }, orders: { created: 1 } });
  });
});

describe("demo environment", () => {
  beforeEach(resetDb);

  it("cannot be loaded alongside real orders", async () => {
    const u = await makeUser();
    await prisma.order.create({ data: { number: "R1", customerName: "Real", orderDate: new Date() } });
    await expect(loadDemoData(u.id)).rejects.toMatchObject({ code: "REAL_DATA_PRESENT" });
  });
});
