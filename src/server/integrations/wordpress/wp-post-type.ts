/**
 * Fallback adapter for WordPress sites WITHOUT WooCommerce.
 * Reads products from a (custom) post type through the core WP REST API (`wp/v2/<postType>`),
 * mapping SKU / price / stock from post meta keys that are exposed to REST (see the optional
 * companion plugin in /wordpress-plugin). Orders are not available without an e-commerce plugin.
 *
 * Authentication: WordPress Application Passwords (Users → Profile → Application Passwords).
 */
import { WordPressClient, WordPressError, pageInfo } from "./client";
import { gmtDate, num, stripHtml } from "./mappers";
import type { NormalizedOrder, NormalizedProduct, Page, SourceAdapter, TestResult, TestStep } from "./types";

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface PostTypeOptions {
  siteUrl: string;
  username?: string;
  appPassword?: string;
  postType: string;
  skuMetaKey?: string;
  priceMetaKey?: string;
  stockMetaKey?: string;
  restRouteMode?: boolean;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

export class WordPressPostTypeAdapter implements SourceAdapter {
  readonly kind = "WP_POST_TYPE" as const;
  readonly supportsOrders = false;
  readonly supportsWebhooks = false;
  private client: WordPressClient;

  constructor(private o: PostTypeOptions) {
    if (!/^[a-z0-9_-]{1,40}$/i.test(o.postType)) throw new WordPressError("INVALID_URL", "Invalid post type name");
    this.client = new WordPressClient({
      baseUrl: o.siteUrl,
      auth: o.username && o.appPassword ? { type: "basic", username: o.username, password: o.appPassword.replace(/\s+/g, "") } : { type: "none" },
      restRouteMode: o.restRouteMode,
      fetchImpl: o.fetchImpl,
      sleep: o.sleep,
    });
  }

  async test(): Promise<TestResult> {
    const steps: TestStep[] = [];
    const result: TestResult = { ok: false, wooCommerceDetected: false, siteName: null, namespaces: [], versionInfo: null, steps, discovered: {} };
    try {
      const idx = (await this.client.withOptions({ maxRetries: 1 }).request<any>("", { authenticated: false })).data;
      result.siteName = idx?.name ?? null;
      result.namespaces = Array.isArray(idx?.namespaces) ? idx.namespaces.map(String) : [];
      result.wooCommerceDetected = result.namespaces.includes("wc/v3");
      steps.push({ name: "WordPress REST API", ok: true, message: `Found "${result.siteName ?? "WordPress site"}"` });
      if (result.wooCommerceDetected) {
        steps.push({ name: "WooCommerce", ok: true, message: "WooCommerce is installed — the WooCommerce adapter is recommended for orders." });
      }
    } catch (e) {
      steps.push({ name: "WordPress REST API", ok: false, message: (e as Error).message });
      return result;
    }
    try {
      const res = await this.client.request<any[]>(`wp/v2/${this.o.postType}`, { query: { per_page: 1, context: this.o.username ? "edit" : undefined } });
      steps.push({ name: `Read "${this.o.postType}" posts`, ok: true, message: `${pageInfo(res.headers).total ?? "?"} records accessible` });
      result.counts = { products: pageInfo(res.headers).total, orders: null };
      result.ok = true;
    } catch (e) {
      steps.push({ name: `Read "${this.o.postType}" posts`, ok: false, message: (e as Error).message });
    }
    if (result.ok) steps.push({ name: "Orders", ok: true, message: "Order sync is not available without WooCommerce (products only)." });
    return result;
  }

  private meta(p: any, key?: string) {
    if (!key) return undefined;
    return p?.meta?.[key] ?? p?.acf?.[key] ?? undefined;
  }

  async listProducts(page: number, perPage: number, modifiedAfter?: Date | null): Promise<Page<NormalizedProduct>> {
    const res = await this.client.request<any[]>(`wp/v2/${this.o.postType}`, {
      query: {
        page,
        per_page: perPage,
        orderby: "id",
        order: "asc",
        _embed: "wp:featuredmedia,wp:term",
        status: this.o.username ? "any" : undefined,
        context: this.o.username ? "edit" : undefined,
        modified_after: modifiedAfter ? modifiedAfter.toISOString() : undefined,
      },
    });
    if (!Array.isArray(res.data)) throw new WordPressError("INVALID_RESPONSE", "Post type endpoint did not return a list");
    const info = pageInfo(res.headers);
    const items: NormalizedProduct[] = res.data.map((p) => {
      const stock = num(this.meta(p, this.o.stockMetaKey));
      const terms: any[] = (p?._embedded?.["wp:term"] ?? []).flat();
      return {
        externalId: String(p.id),
        name: stripHtml(p.title?.rendered ?? p.title?.raw ?? "") || `Post ${p.id}`,
        sku: (this.meta(p, this.o.skuMetaKey) as string) || null,
        slug: p.slug ?? null,
        type: "simple",
        status: p.status ?? "publish",
        imageUrl: p?._embedded?.["wp:featuredmedia"]?.[0]?.source_url ?? null,
        permalink: p.link ?? null,
        categories: terms.filter((t) => t?.taxonomy !== "post_tag").map((t) => stripHtml(t?.name)).filter(Boolean),
        price: num(this.meta(p, this.o.priceMetaKey)),
        regularPrice: num(this.meta(p, this.o.priceMetaKey)),
        salePrice: null,
        manageStock: stock !== null,
        stockQuantity: stock,
        stockStatus: stock === null ? null : stock > 0 ? "instock" : "outofstock",
        lowStockAmount: null,
        createdAt: gmtDate(p.date_gmt),
        updatedAt: gmtDate(p.modified_gmt),
        hasVariations: false,
      };
    });
    return { items, page, totalPages: info.totalPages, total: info.total };
  }

  async listVariations() {
    return [];
  }

  async listOrders(page: number): Promise<Page<NormalizedOrder>> {
    return { items: [], page, totalPages: 1, total: 0 };
  }
}
