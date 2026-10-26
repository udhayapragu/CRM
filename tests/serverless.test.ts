import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { saveConnection, setConnectionEnabled, testConnection } from "@/server/integrations/wordpress/connection-service";
import { claimNextJob, enqueueSync, runJob } from "@/server/integrations/wordpress/job-runner";
import { clearDemoData, DEMO_ORDER_COUNT, finishDemo, loadDemoBase, loadDemoOrders } from "@/server/services/demo";
import { hasDemoData } from "@/server/services/settings";
import { systemReadiness } from "@/lib/system-check";
import { verifyItem } from "@/server/services/inventory-ledger";
import { createFakeWoo, noSleep, wcOrder, wcProduct } from "./fake-woo";
import { makeUser, resetDb } from "./helpers";

async function connect(fetchImpl: typeof fetch) {
  const u = await makeUser();
  await saveConnection({ siteUrl: "https://shop.test", adapter: "WOOCOMMERCE", consumerKey: "ck_test", consumerSecret: "cs_test", perPage: 10 }, { userId: u.id });
  const c = await prisma.wordPressConnection.findFirstOrThrow();
  expect((await testConnection(c.id, null, { fetchImpl, sleep: noSleep })).ok).toBe(true);
  await setConnectionEnabled(c.id, true, { userId: u.id });
  return c;
}

describe("time-boxed (serverless) synchronisation", () => {
  beforeEach(resetDb);

  it("pauses at page boundaries when the time budget runs out and resumes without duplicates", async () => {
    const { fetchImpl } = createFakeWoo({ products: Array.from({ length: 35 }, (_, i) => wcProduct(i + 1)), orders: Array.from({ length: 25 }, (_, i) => wcOrder(100 + i)) });
    const c = await connect(fetchImpl);
    const { job } = await enqueueSync(c.id, "FULL", "INITIAL", { fullResync: true });

    let runs = 0;
    for (;;) {
      const claimed = await claimNextJob();
      if (!claimed) break;
      runs++;
      // deadline already passed → each run processes exactly one page then pauses
      await runJob(claimed, { fetchImpl, sleep: noSleep, pageDelayMs: 0, deadline: Date.now() - 1 });
      expect(runs).toBeLessThan(20);
    }
    const done = await prisma.syncJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(done.status).toBe("SUCCEEDED");
    expect(done.progress).toBeNull();
    expect(done.attempts).toBe(1); // pauses are not counted as failed attempts
    // 4 product pages + 3 order pages; the run finishing products continues straight into order page 1
    expect(runs).toBe(6);
    expect(await prisma.product.count()).toBe(35);
    expect(await prisma.order.count()).toBe(25);
    expect(done.stats).toMatchObject({ products: { created: 35, pages: 4 }, orders: { created: 25, pages: 3 } });
    // a resumed full import must not flag products seen in earlier slices as removed
    expect(await prisma.product.count({ where: { deletedAtSource: { not: null } } })).toBe(0);
  });
});

describe("phased demo loading", () => {
  beforeEach(resetDb);

  it("loads in idempotent batches, tolerates retried batches, and stays consistent", async () => {
    const u = await makeUser();
    await expect(loadDemoOrders(u.id, 0)).rejects.toMatchObject({ code: "DEMO_NOT_STARTED" });
    const base = await loadDemoBase(u.id);
    expect(base.total).toBe(DEMO_ORDER_COUNT);
    let next = 0;
    while (next < DEMO_ORDER_COUNT) {
      const r = await loadDemoOrders(u.id, next);
      if (next === 8) await loadDemoOrders(u.id, next); // simulate a retried (timed-out) batch
      next = r.next;
    }
    await finishDemo(u.id);
    expect(await prisma.order.count({ where: { isDemo: true } })).toBe(DEMO_ORDER_COUNT);
    for (const it of await prisma.inventoryItem.findMany({ where: { isDemo: true } })) expect((await verifyItem(it.id)).ok).toBe(true);
    expect(await prisma.appSetting.findUnique({ where: { key: "demoLoadedAt" } })).not.toBeNull();
    await clearDemoData(u.id);
    expect(await hasDemoData()).toBe(false);
  });
});

describe("system readiness", () => {
  it("reports a healthy, migrated database", async () => {
    const r = await systemReadiness({ force: true });
    expect(r.ok).toBe(true);
    expect(r.problems.filter((p) => p.blocking)).toHaveLength(0);
  });
});

describe("database URL normalisation", () => {
  it("adds pgbouncer=true for pooled hosts only", async () => {
    const { normalizeDatabaseUrl } = await import("@/lib/db");
    expect(normalizeDatabaseUrl("postgresql://u:p@ep-cool-123-pooler.ap-southeast-1.aws.neon.tech/db?sslmode=require")).toContain("pgbouncer=true");
    expect(normalizeDatabaseUrl("postgresql://u:p@aws-0-ap-south-1.pooler.supabase.com:6543/postgres")).toContain("pgbouncer=true");
    expect(normalizeDatabaseUrl("postgresql://u:p@ep-cool-123.ap-southeast-1.aws.neon.tech/db?sslmode=require")).not.toContain("pgbouncer");
    expect(normalizeDatabaseUrl("postgresql://u:p@db/x?pgbouncer=false")).toContain("pgbouncer=false");
  });
});
