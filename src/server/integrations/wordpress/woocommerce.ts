import { WordPressClient, WordPressError, pageInfo, type ClientAuth } from "./client";
import { mapWcOrder, mapWcProduct, mapWcVariation } from "./mappers";
import type { NormalizedOrder, NormalizedProduct, NormalizedVariant, Page, SourceAdapter, TestResult, TestStep } from "./types";

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface WooOptions {
  siteUrl: string;
  consumerKey: string;
  consumerSecret: string;
  authMethod?: "basic" | "query";
  restRouteMode?: boolean;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  pageDelayMs?: number;
}

export class WooCommerceAdapter implements SourceAdapter {
  readonly kind = "WOOCOMMERCE" as const;
  readonly supportsOrders = true;
  readonly supportsWebhooks = true;
  private client: WordPressClient;

  constructor(private o: WooOptions) {
    this.client = new WordPressClient({
      baseUrl: o.siteUrl,
      auth: this.auth(o.authMethod ?? "basic"),
      restRouteMode: o.restRouteMode,
      fetchImpl: o.fetchImpl,
      sleep: o.sleep,
    });
  }

  private auth(method: "basic" | "query"): ClientAuth {
    return { type: method, username: this.o.consumerKey, password: this.o.consumerSecret };
  }

  async test(): Promise<TestResult> {
    const steps: TestStep[] = [];
    const result: TestResult = { ok: false, wooCommerceDetected: false, siteName: null, namespaces: [], versionInfo: null, steps, discovered: {} };

    // 1. Reachability + REST discovery (unauthenticated)
    let index: any = null;
    let restRouteMode = false;
    try {
      index = (await this.client.withOptions({ maxRetries: 1 }).request<any>("", { authenticated: false })).data;
    } catch (e) {
      if (e instanceof WordPressError && (e.kind === "NOT_FOUND" || e.kind === "INVALID_RESPONSE")) {
        try {
          index = (await this.client.withOptions({ restRouteMode: true, maxRetries: 1 }).request<any>("", { authenticated: false })).data;
          restRouteMode = true;
        } catch (e2) {
          steps.push({ name: "WordPress REST API", ok: false, message: (e2 as Error).message });
          return result;
        }
      } else {
        steps.push({ name: "Reach website", ok: false, message: (e as Error).message });
        return result;
      }
    }
    if (!index || !Array.isArray(index.namespaces)) {
      steps.push({ name: "WordPress REST API", ok: false, message: "The site did not return a WordPress REST API index. Is this a WordPress site?" });
      return result;
    }
    result.siteName = index.name ? String(index.name) : null;
    result.namespaces = index.namespaces.map(String);
    steps.push({ name: "WordPress REST API", ok: true, message: `Found "${result.siteName ?? "WordPress site"}"${restRouteMode ? " (using ?rest_route= mode)" : ""}` });
    result.discovered!.restRouteMode = restRouteMode;

    // 2. WooCommerce detection
    result.wooCommerceDetected = result.namespaces.includes("wc/v3");
    if (!result.wooCommerceDetected) {
      steps.push({
        name: "WooCommerce",
        ok: false,
        message: "WooCommerce REST API (wc/v3) was not found. Install/activate WooCommerce, or switch to the generic WordPress adapter.",
      });
      return result;
    }
    steps.push({ name: "WooCommerce", ok: true, message: "WooCommerce REST API v3 detected" });

    // 3. Authenticated access — try Basic auth first, then query-string auth (some hosts strip the header)
    let authMethod: "basic" | "query" | null = null;
    let productsTotal: number | null = null;
    for (const method of ["basic", "query"] as const) {
      const c = this.client.withOptions({ auth: this.auth(method), restRouteMode, maxRetries: 1 });
      try {
        const res = await c.request<any[]>("wc/v3/products", { query: { per_page: 1, status: "any" } });
        productsTotal = pageInfo(res.headers).total;
        authMethod = method;
        break;
      } catch (e) {
        if (method === "query" || !(e instanceof WordPressError) || (e.kind !== "AUTH" && e.kind !== "FORBIDDEN")) {
          steps.push({ name: "Read products", ok: false, message: (e as Error).message });
          if (!(e instanceof WordPressError && (e.kind === "AUTH" || e.kind === "FORBIDDEN"))) return result;
        }
      }
    }
    if (!authMethod) return result;
    this.client = this.client.withOptions({ auth: this.auth(authMethod), restRouteMode });
    result.discovered!.authMethod = authMethod;
    steps.push({ name: "Read products", ok: true, message: `Authenticated (${authMethod === "basic" ? "HTTP Basic" : "query-string"} auth) — ${productsTotal ?? "?"} products` });

    // 4. Orders permission
    let ordersTotal: number | null = null;
    try {
      const res = await this.client.request<any[]>("wc/v3/orders", { query: { per_page: 1 } });
      ordersTotal = pageInfo(res.headers).total;
      steps.push({ name: "Read orders", ok: true, message: `${ordersTotal ?? "?"} orders accessible` });
    } catch (e) {
      steps.push({ name: "Read orders", ok: false, message: (e as Error).message });
      result.counts = { products: productsTotal, orders: null };
      return result;
    }

    // 5. Version info (optional; needs manage_woocommerce)
    try {
      const res = await this.client.withOptions({ maxRetries: 0 }).request<any>("wc/v3/system_status");
      const wp = res.data?.environment?.wp_version;
      const wc = res.data?.environment?.version ?? res.data?.active_plugins?.find((p: any) => p.plugin?.startsWith("woocommerce/"))?.version;
      result.versionInfo = [wp ? `WordPress ${wp}` : null, wc ? `WooCommerce ${wc}` : null].filter(Boolean).join(" · ") || null;
    } catch {
      /* optional */
    }

    result.counts = { products: productsTotal, orders: ordersTotal };
    result.ok = true;
    return result;
  }

  async listProducts(page: number, perPage: number, modifiedAfter?: Date | null): Promise<Page<NormalizedProduct>> {
    const res = await this.client.request<any[]>("wc/v3/products", {
      query: {
        page,
        per_page: perPage,
        status: "any",
        orderby: "id",
        order: "asc",
        modified_after: modifiedAfter ? modifiedAfter.toISOString() : undefined,
        dates_are_gmt: modifiedAfter ? "true" : undefined,
      },
    });
    if (!Array.isArray(res.data)) throw new WordPressError("INVALID_RESPONSE", "Products endpoint did not return a list");
    const info = pageInfo(res.headers);
    return { items: res.data.map(mapWcProduct), page, totalPages: info.totalPages, total: info.total };
  }

  async listVariations(productExternalId: string, parentName = ""): Promise<NormalizedVariant[]> {
    const out: NormalizedVariant[] = [];
    let page = 1;
    for (;;) {
      const res = await this.client.request<any[]>(`wc/v3/products/${encodeURIComponent(productExternalId)}/variations`, { query: { page, per_page: 100 } });
      if (!Array.isArray(res.data)) break;
      out.push(...res.data.map((v) => mapWcVariation(v, parentName)));
      const { totalPages } = pageInfo(res.headers);
      if (page >= totalPages) break;
      page++;
    }
    return out;
  }

  async listOrders(page: number, perPage: number, modifiedAfter?: Date | null): Promise<Page<NormalizedOrder>> {
    const res = await this.client.request<any[]>("wc/v3/orders", {
      query: {
        page,
        per_page: perPage,
        orderby: "id",
        order: "asc",
        modified_after: modifiedAfter ? modifiedAfter.toISOString() : undefined,
        dates_are_gmt: modifiedAfter ? "true" : undefined,
      },
    });
    if (!Array.isArray(res.data)) throw new WordPressError("INVALID_RESPONSE", "Orders endpoint did not return a list");
    const info = pageInfo(res.headers);
    return { items: res.data.map(mapWcOrder), page, totalPages: info.totalPages, total: info.total };
  }

  async getOrder(externalId: string): Promise<NormalizedOrder | null> {
    try {
      const res = await this.client.request<any>(`wc/v3/orders/${encodeURIComponent(externalId)}`);
      return mapWcOrder(res.data);
    } catch (e) {
      if (e instanceof WordPressError && e.kind === "NOT_FOUND") return null;
      throw e;
    }
  }

  /** Create WooCommerce webhooks pointing at this CRM (requires a Read/Write API key). */
  async registerWebhooks(deliveryUrl: string, secret: string) {
    const topics = ["order.created", "order.updated", "order.deleted", "product.created", "product.updated", "product.deleted"];
    const existing = await this.client.request<any[]>("wc/v3/webhooks", { query: { per_page: 100 } }).then((r) => r.data).catch(() => [] as any[]);
    const results: { topic: string; ok: boolean; message: string }[] = [];
    for (const topic of topics) {
      const dup = existing.find((w: any) => w.topic === topic && w.delivery_url === deliveryUrl);
      try {
        if (dup) {
          await this.client.request(`wc/v3/webhooks/${dup.id}`, { method: "PUT", body: { secret, status: "active" } });
          results.push({ topic, ok: true, message: "Updated existing webhook" });
        } else {
          await this.client.request("wc/v3/webhooks", {
            method: "POST",
            body: { name: `Luxe CRM — ${topic}`, topic, delivery_url: deliveryUrl, secret, status: "active" },
          });
          results.push({ topic, ok: true, message: "Created" });
        }
      } catch (e) {
        results.push({ topic, ok: false, message: (e as Error).message });
      }
    }
    return results;
  }
}
