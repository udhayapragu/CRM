/** Pure mapping functions: WooCommerce JSON → normalised records, and WC status → CRM statuses. */
import type { OrderStatus, PaymentStatus } from "@prisma/client";
import type { NormalizedOrder, NormalizedProduct, NormalizedVariant } from "./types";

/* eslint-disable @typescript-eslint/no-explicit-any */

export function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function gmtDate(v: unknown): Date | null {
  if (!v || typeof v !== "string") return null;
  const s = /[zZ]|[+-]\d\d:?\d\d$/.test(v) ? v : `${v}Z`;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function stripHtml(s: unknown): string {
  return String(s ?? "")
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&#0?39;|&#8217;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#8211;/g, "–")
    .trim();
}

export function mapWcProduct(p: any): NormalizedProduct {
  if (!p || p.id === undefined || p.id === null) throw new Error("Product payload missing id");
  return {
    externalId: String(p.id),
    name: stripHtml(p.name) || `Product ${p.id}`,
    sku: p.sku ? String(p.sku) : null,
    slug: p.slug ?? null,
    type: p.type ?? "simple",
    status: p.status ?? "publish",
    imageUrl: Array.isArray(p.images) && p.images[0]?.src ? String(p.images[0].src) : null,
    permalink: p.permalink ?? null,
    categories: Array.isArray(p.categories) ? p.categories.map((c: any) => stripHtml(c.name)).filter(Boolean) : [],
    price: num(p.price),
    regularPrice: num(p.regular_price),
    salePrice: num(p.sale_price),
    manageStock: p.manage_stock === true,
    stockQuantity: p.manage_stock === true ? num(p.stock_quantity) : null,
    stockStatus: p.stock_status ?? null,
    lowStockAmount: num(p.low_stock_amount),
    createdAt: gmtDate(p.date_created_gmt),
    updatedAt: gmtDate(p.date_modified_gmt),
    hasVariations: p.type === "variable" || (Array.isArray(p.variations) && p.variations.length > 0),
  };
}

export function mapWcVariation(v: any, parentName: string): NormalizedVariant {
  const attributes: Record<string, string> = {};
  for (const a of Array.isArray(v.attributes) ? v.attributes : []) {
    if (a?.name) attributes[String(a.name)] = String(a.option ?? "");
  }
  const label = Object.values(attributes).filter(Boolean).join(" / ");
  return {
    externalId: String(v.id),
    sku: v.sku ? String(v.sku) : null,
    name: label ? `${parentName} — ${label}` : `${parentName} #${v.id}`,
    attributes,
    price: num(v.price),
    stockQuantity: v.manage_stock === true || v.manage_stock === "parent" ? num(v.stock_quantity) : null,
    stockStatus: v.stock_status ?? null,
  };
}

function address(a: any): Record<string, string> | null {
  if (!a || typeof a !== "object") return null;
  const out: Record<string, string> = {};
  for (const k of ["first_name", "last_name", "company", "address_1", "address_2", "city", "state", "postcode", "country", "phone", "email"]) {
    if (a[k]) out[k] = String(a[k]);
  }
  return Object.keys(out).length ? out : null;
}

export function mapWcOrder(o: any): NormalizedOrder {
  if (!o || o.id === undefined || o.id === null) throw new Error("Order payload missing id");
  const billing = o.billing ?? {};
  const shipping = o.shipping ?? {};
  const nameFrom = (x: any) => [x?.first_name, x?.last_name].filter(Boolean).join(" ").trim();
  const lines = (Array.isArray(o.line_items) ? o.line_items : []).map((li: any) => {
    const quantity = Math.max(0, Math.round(Number(li.quantity) || 0));
    const total = num(li.total) ?? 0;
    return {
      externalId: String(li.id),
      productExternalId: li.product_id ? String(li.product_id) : null,
      variationExternalId: li.variation_id ? String(li.variation_id) : null,
      name: stripHtml(li.name) || "Item",
      sku: li.sku ? String(li.sku) : null,
      quantity,
      unitPrice: num(li.price) ?? (quantity ? total / quantity : 0),
      total,
    };
  });
  const refunded = (Array.isArray(o.refunds) ? o.refunds : []).reduce((s: number, r: any) => s + Math.abs(num(r.total) ?? 0), 0);
  const subtotal = lines.reduce((s: number, l: { total: number }) => s + l.total, 0);
  return {
    externalId: String(o.id),
    number: String(o.number ?? o.id),
    wcStatus: String(o.status ?? "pending"),
    currency: o.currency ?? "INR",
    customerName: nameFrom(billing) || nameFrom(shipping) || billing.company || billing.email || "Guest customer",
    customerEmail: billing.email || null,
    customerPhone: billing.phone || shipping.phone || null,
    billingAddress: address(billing),
    shippingAddress: address(shipping),
    shippingMethod: Array.isArray(o.shipping_lines) && o.shipping_lines[0] ? stripHtml(o.shipping_lines[0].method_title) : null,
    paymentMethod: o.payment_method_title || o.payment_method || null,
    subtotal,
    shippingTotal: num(o.shipping_total) ?? 0,
    taxTotal: num(o.total_tax) ?? 0,
    discountTotal: num(o.discount_total) ?? 0,
    total: num(o.total) ?? 0,
    refundedTotal: Math.round(refunded * 100) / 100,
    customerNote: o.customer_note ? stripHtml(o.customer_note) : null,
    orderDate: gmtDate(o.date_created_gmt) ?? gmtDate(o.date_created) ?? new Date(),
    paidAt: gmtDate(o.date_paid_gmt),
    completedAt: gmtDate(o.date_completed_gmt),
    updatedAt: gmtDate(o.date_modified_gmt),
    lines,
  };
}

// ───────────────────────────── Status mapping ─────────────────────────────

export interface LocalOrderState {
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  hasDispatchedShipment: boolean;
}

export interface StatusDecision {
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  /** Set when the change from the website conflicts with local fulfilment and needs a human. */
  attention?: string;
  note: string;
}

const POST_DISPATCH: OrderStatus[] = ["DISPATCHED", "DELIVERED", "RETURNED"];
const EARLY: OrderStatus[] = ["NEW", "PENDING_PAYMENT"];

/**
 * Decide CRM statuses from a WooCommerce status. Applied only when an order is first imported or when
 * its WooCommerce status actually changes — local workflow progress (e.g. Ready to Pack) is never
 * overwritten by a sync that merely re-reads an unchanged order.
 *
 * WooCommerce "completed" is treated as the source confirming fulfilment (→ Dispatched). It is never
 * mapped to Delivered, because WooCommerce does not track delivery.
 */
export function decideStatusFromWc(wcStatus: string, local: LocalOrderState | null, refundedTotal = 0, total = 0): StatusDecision {
  const cur = local ?? { status: "NEW" as OrderStatus, paymentStatus: "UNPAID" as PaymentStatus, hasDispatchedShipment: false };
  const dispatched = cur.hasDispatchedShipment || POST_DISPATCH.includes(cur.status);
  const partialRefund = refundedTotal > 0 && refundedTotal < total;
  switch (wcStatus) {
    case "pending":
      return {
        status: EARLY.includes(cur.status) ? "PENDING_PAYMENT" : cur.status,
        paymentStatus: "PENDING",
        note: "Awaiting payment on website",
      };
    case "failed":
      return {
        status: EARLY.includes(cur.status) ? "PENDING_PAYMENT" : cur.status,
        paymentStatus: "FAILED",
        note: "Payment failed on website",
      };
    case "processing":
      return {
        // A paid order enters the CRM workflow as NEW (awaiting confirmation); later stages are preserved.
        status: EARLY.includes(cur.status) || cur.status === "ON_HOLD" ? "NEW" : cur.status,
        paymentStatus: partialRefund ? "PARTIALLY_REFUNDED" : "PAID",
        note: "Paid — processing on website",
      };
    case "on-hold":
      if (dispatched) {
        return { status: cur.status, paymentStatus: cur.paymentStatus, attention: "Website put the order on hold after it was dispatched.", note: "On hold at source" };
      }
      return { status: "ON_HOLD", paymentStatus: cur.paymentStatus === "PAID" ? "PAID" : "PENDING", note: "On hold on website" };
    case "completed":
      return {
        status: POST_DISPATCH.includes(cur.status) ? cur.status : "DISPATCHED",
        paymentStatus: partialRefund ? "PARTIALLY_REFUNDED" : cur.paymentStatus === "REFUNDED" ? "REFUNDED" : "PAID",
        attention: cur.hasDispatchedShipment ? undefined : "Marked completed on the website, but no dispatch was recorded in the CRM. Record the shipment so physical stock is deducted.",
        note: "Completed (fulfilled) on website",
      };
    case "cancelled":
      if (dispatched) {
        return { status: cur.status, paymentStatus: cur.paymentStatus, attention: "Cancelled on the website after dispatch — record a return if goods come back.", note: "Cancelled at source" };
      }
      return { status: "CANCELLED", paymentStatus: cur.paymentStatus === "PAID" ? "PAID" : cur.paymentStatus, note: "Cancelled on website" };
    case "refunded":
      if (dispatched) {
        return { status: cur.status, paymentStatus: "REFUNDED", attention: "Refunded on the website after dispatch — record a return if goods come back.", note: "Refunded at source" };
      }
      return { status: "CANCELLED", paymentStatus: "REFUNDED", note: "Refunded on website" };
    default:
      return { status: cur.status, paymentStatus: cur.paymentStatus, note: `Website status "${wcStatus}"` };
  }
}

/** WooCommerce statuses that should not be imported at all. */
export const IGNORED_WC_STATUSES = new Set(["checkout-draft", "draft", "trash", "auto-draft"]);
