import { describe, expect, it } from "vitest";
import { normalizeSiteUrl, WordPressClient, WordPressError } from "@/server/integrations/wordpress/client";
import { WooCommerceAdapter } from "@/server/integrations/wordpress/woocommerce";
import { createFakeWoo, noSleep } from "./fake-woo";

const adapter = (fetchImpl: typeof fetch, key = "ck_test", secret = "cs_test") => new WooCommerceAdapter({ siteUrl: "https://shop.test", consumerKey: key, consumerSecret: secret, fetchImpl, sleep: noSleep });

describe("WordPress connection failures", () => {
  it("rejects invalid and insecure URLs", () => {
    expect(() => normalizeSiteUrl("not a url")).toThrow(WordPressError);
    expect(() => normalizeSiteUrl("http://shop.test")).toThrow(/https/);
    expect(normalizeSiteUrl("https://shop.test/")).toBe("https://shop.test");
  });

  it("reports unreachable sites (network error) after retrying", async () => {
    let calls = 0;
    const fetchImpl = (async () => { calls++; throw new TypeError("getaddrinfo ENOTFOUND shop.test"); }) as typeof fetch;
    const r = await adapter(fetchImpl).test();
    expect(r.ok).toBe(false);
    expect(r.steps[0]).toMatchObject({ name: "Reach website", ok: false });
    expect(r.steps[0].message).toMatch(/Could not reach/);
    expect(calls).toBeGreaterThan(1);
  });

  it("reports timeouts", async () => {
    const fetchImpl = ((_u: unknown, init?: RequestInit) => new Promise((_, rej) => init?.signal?.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "AbortError" }))))) as typeof fetch;
    const client = new WordPressClient({ baseUrl: "https://shop.test", fetchImpl, sleep: noSleep, timeoutMs: 20, maxRetries: 0 });
    await expect(client.request("")).rejects.toMatchObject({ kind: "TIMEOUT" });
  });

  it("detects a non-WordPress / blocked REST API (HTML response)", async () => {
    const fetchImpl = (async () => new Response("<html>Access denied by firewall</html>", { status: 200, headers: { "content-type": "text/html" } })) as typeof fetch;
    const r = await adapter(fetchImpl).test();
    expect(r.ok).toBe(false);
    expect(r.steps.some((s) => /REST API/.test(s.name) && !s.ok)).toBe(true);
  });

  it("does not assume WooCommerce: reports when wc/v3 is missing", async () => {
    const { fetchImpl } = createFakeWoo({ noWoo: true });
    const r = await adapter(fetchImpl).test();
    expect(r.ok).toBe(false);
    expect(r.wooCommerceDetected).toBe(false);
    expect(r.steps.find((s) => s.name === "WooCommerce")).toMatchObject({ ok: false });
  });

  it("reports invalid credentials (401)", async () => {
    const { fetchImpl } = createFakeWoo();
    const r = await adapter(fetchImpl, "ck_wrong", "cs_wrong").test();
    expect(r.ok).toBe(false);
    expect(r.steps.find((s) => s.name === "Read products")?.message).toMatch(/Authentication failed/);
  });

  it("falls back to query-string auth when the host strips the Authorization header", async () => {
    const { fetchImpl } = createFakeWoo({ stripAuthHeader: true });
    const r = await adapter(fetchImpl).test();
    expect(r.ok).toBe(true);
    expect(r.discovered?.authMethod).toBe("query");
  });

  it("retries rate-limited (429) and 5xx responses, then succeeds", async () => {
    const { fetchImpl, state } = createFakeWoo({ products: [{ id: 1, name: "P", date_modified_gmt: "2026-10-01T00:00:00" }], failTimes: { status: 429, times: 2, path: "wc/v3/products" } });
    const page = await adapter(fetchImpl).listProducts(1, 50);
    expect(page.items).toHaveLength(1);
    expect(state.calls.filter((c) => c.includes("wc/v3/products")).length).toBe(3);
  });

  it("gives up after max retries on persistent server errors", async () => {
    const { fetchImpl } = createFakeWoo({ failTimes: { status: 503, times: 99, path: "wc/v3/orders" } });
    await expect(adapter(fetchImpl).listOrders(1, 50)).rejects.toMatchObject({ kind: "SERVER", retryable: true });
  });

  it("succeeds end-to-end against a healthy WooCommerce site", async () => {
    const { fetchImpl } = createFakeWoo({ products: [{ id: 1 }], orders: [{ id: 1 }] });
    const r = await adapter(fetchImpl).test();
    expect(r.ok).toBe(true);
    expect(r.wooCommerceDetected).toBe(true);
    expect(r.versionInfo).toContain("WooCommerce 9.3.0");
    expect(r.counts).toEqual({ products: 1, orders: 1 });
  });
});
