/** A small in-memory fake of the WordPress + WooCommerce REST API for tests. */
/* eslint-disable @typescript-eslint/no-explicit-any */
export interface FakeWooOptions {
  products?: any[];
  orders?: any[];
  variations?: Record<string, any[]>;
  key?: string;
  secret?: string;
  noWoo?: boolean;
  failTimes?: { status: number; times: number; path?: string };
  stripAuthHeader?: boolean;
}

export function wcProduct(id: number, over: Partial<any> = {}) {
  return {
    id, name: `Perfume ${id}`, slug: `perfume-${id}`, sku: `SKU-${id}`, type: "simple", status: "publish", price: "1500.00", regular_price: "1500.00", sale_price: "",
    manage_stock: true, stock_quantity: 25, stock_status: "instock", low_stock_amount: null, categories: [{ id: 1, name: "Perfume" }], images: [{ src: `https://shop.test/p${id}.jpg` }],
    permalink: `https://shop.test/p/${id}`, date_created_gmt: "2026-09-01T10:00:00", date_modified_gmt: "2026-10-01T10:00:00", variations: [], ...over,
  };
}

export function wcOrder(id: number, over: Partial<any> = {}) {
  return {
    id, number: String(id), status: "processing", currency: "INR", date_created_gmt: new Date(Date.now() - 3600_000).toISOString().slice(0, 19), date_modified_gmt: "2026-10-20T10:00:00",
    date_paid_gmt: "2026-10-20T10:00:00", discount_total: "0.00", shipping_total: "0.00", total_tax: "0.00", total: "3000.00", customer_note: "",
    billing: { first_name: "Asha", last_name: "Rao", email: "asha@example.com", phone: "999", city: "Pune", country: "IN" }, shipping: { first_name: "Asha", last_name: "Rao", city: "Pune", country: "IN" },
    payment_method_title: "UPI", shipping_lines: [{ method_title: "Express" }], refunds: [],
    line_items: [{ id: id * 10, name: "Perfume 1", product_id: 1, variation_id: 0, quantity: 2, price: 1500, total: "3000.00", sku: "SKU-1" }], ...over,
  };
}

export function createFakeWoo(opts: FakeWooOptions = {}) {
  const state = { products: opts.products ?? [], orders: opts.orders ?? [], calls: [] as string[], failuresLeft: opts.failTimes?.times ?? 0 };
  const key = opts.key ?? "ck_test";
  const secret = opts.secret ?? "cs_test";
  const json = (body: unknown, init: { status?: number; headers?: Record<string, string> } = {}) =>
    new Response(JSON.stringify(body), { status: init.status ?? 200, headers: { "content-type": "application/json", ...(init.headers ?? {}) } });
  const page = (list: any[], url: URL) => {
    const per = Number(url.searchParams.get("per_page") ?? 10);
    const p = Number(url.searchParams.get("page") ?? 1);
    const after = url.searchParams.get("modified_after");
    const filtered = after ? list.filter((x) => new Date(x.date_modified_gmt + "Z") > new Date(after)) : list;
    return json(filtered.slice((p - 1) * per, p * per), { headers: { "x-wp-total": String(filtered.length), "x-wp-totalpages": String(Math.max(1, Math.ceil(filtered.length / per))) } });
  };
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const path = url.pathname.replace(/^\/wp-json\/?/, "");
    state.calls.push(`${init?.method ?? "GET"} ${path}`);
    if (opts.failTimes && state.failuresLeft > 0 && (!opts.failTimes.path || path.startsWith(opts.failTimes.path))) {
      state.failuresLeft--;
      return json({ code: "fail", message: "temporary" }, { status: opts.failTimes.status, headers: { "retry-after": "0" } });
    }
    if (path === "" || path === "/") return json({ name: "Fake Luxury Shop", namespaces: opts.noWoo ? ["wp/v2"] : ["wp/v2", "wc/v3"] });
    if (path.startsWith("wc/v3")) {
      if (opts.noWoo) return json({ code: "rest_no_route", message: "No route" }, { status: 404 });
      const headers = new Headers(init?.headers as HeadersInit);
      const basic = headers.get("authorization");
      const ok =
        (!opts.stripAuthHeader && basic === "Basic " + Buffer.from(`${key}:${secret}`).toString("base64")) ||
        (url.searchParams.get("consumer_key") === key && url.searchParams.get("consumer_secret") === secret);
      if (!ok) return json({ code: "woocommerce_rest_cannot_view", message: "Sorry, you cannot list resources." }, { status: 401 });
      const rest = path.slice("wc/v3/".length);
      if (rest === "products") return page(state.products, url);
      const v = rest.match(/^products\/(\d+)\/variations$/);
      if (v) return page(opts.variations?.[v[1]] ?? [], url);
      if (rest === "orders") return page(state.orders, url);
      const o = rest.match(/^orders\/(\d+)$/);
      if (o) {
        const found = state.orders.find((x) => String(x.id) === o[1]);
        return found ? json(found) : json({ code: "not_found" }, { status: 404 });
      }
      if (rest === "system_status") return json({ environment: { wp_version: "6.6", version: "9.3.0" } });
      if (rest === "webhooks") return json([]);
    }
    return json({ code: "rest_no_route" }, { status: 404 });
  }) as typeof fetch;
  return { fetchImpl, state };
}

export const noSleep = async () => {};
