/**
 * Synchronisation of products and orders from a connected WordPress / WooCommerce site.
 *
 * Data-ownership rules
 *  - Fields that originate on the website (names, prices, website stock, customer details, totals,
 *    WooCommerce status) are overwritten from the source.
 *  - CRM-owned data is NEVER touched by a sync: physical inventory & ledger, low-stock thresholds,
 *    internal notes, fulfilment progress (packing/dispatch), expected dispatch dates.
 *  - Order workflow status is only changed when the WooCommerce status itself changes
 *    (see decideStatusFromWc), so local progress is not overwritten by unchanged re-reads.
 *
 * Duplicate prevention
 *  - Unique (connectionId, externalId) on products and orders, plus upserts.
 *  - A Postgres advisory lock per external record serialises concurrent writers
 *    (scheduled sync + webhook arriving for the same order at the same time).
 */
import { Prisma, type WordPressConnection } from "@prisma/client";
import { prisma, type Tx } from "@/lib/db";
import { addDays } from "@/lib/utils";
import { addOrderEvent, flagAttention, syncOrderReservations } from "@/server/services/orders";
import { notify } from "@/server/services/notifications";
import { getSettings } from "@/server/services/settings";
import { onOrderFulfilmentChanged } from "@/server/services/mlm-hooks";
import { decideStatusFromWc, IGNORED_WC_STATUSES } from "./mappers";
import type { NormalizedOrder, NormalizedProduct, NormalizedVariant, SourceAdapter } from "./types";

export type UpsertOutcome = "created" | "updated" | "unchanged" | "ignored";
export type Actor = "SYNC" | "WEBHOOK";

export interface SyncStats {
  pages: number;
  fetched: number;
  created: number;
  updated: number;
  unchanged: number;
  ignored: number;
  failed: number;
  errors: { externalId: string; message: string }[];
}

export const emptyStats = (): SyncStats => ({ pages: 0, fetched: 0, created: 0, updated: 0, unchanged: 0, ignored: 0, failed: 0, errors: [] });

/** Options for one sync phase. `deadline` time-boxes the run; the phase then throws SyncPaused. */
export interface PhaseOptions {
  full: boolean;
  startPage?: number;
  stats?: SyncStats;
  /** When this job first started (resumed runs keep the original time). */
  runStartedAt?: Date;
  deadline?: number;
}

/** Thrown when a phase stops at a page boundary because its time budget ran out. */
export class SyncPaused extends Error {
  constructor(
    public phase: "products" | "orders",
    public nextPage: number,
    public stats: SyncStats,
  ) {
    super(`Paused before ${phase} page ${nextPage}`);
    this.name = "SyncPaused";
  }
}

export interface SyncContext {
  connection: WordPressConnection;
  adapter: SourceAdapter;
  log: (level: "info" | "warn" | "error", message: string, context?: Prisma.InputJsonValue) => Promise<void>;
  /** Delay between page requests to stay friendly with the site's rate limits. */
  pageDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
  trigger?: string;
}

const dec = (n: number | null | undefined) => (n === null || n === undefined ? null : new Prisma.Decimal(n));
const sameTime = (a: Date | null | undefined, b: Date | null | undefined) => (a?.getTime() ?? null) === (b?.getTime() ?? null);

async function advisoryLock(tx: Tx, key: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
}

// ───────────────────────────── Products ─────────────────────────────

export async function upsertProduct(
  connection: Pick<WordPressConnection, "id">,
  p: NormalizedProduct,
  variants: NormalizedVariant[] | null,
): Promise<UpsertOutcome> {
  const settings = await getSettings();
  return prisma.$transaction(async (tx) => {
    await advisoryLock(tx, `product:${connection.id}:${p.externalId}`);
    const existing = await tx.product.findUnique({ where: { connectionId_externalId: { connectionId: connection.id, externalId: p.externalId } } });
    const sourceData = {
      name: p.name,
      sku: p.sku,
      slug: p.slug,
      type: p.type,
      imageUrl: p.imageUrl,
      permalink: p.permalink,
      categories: p.categories,
      price: dec(p.price),
      regularPrice: dec(p.regularPrice),
      salePrice: dec(p.salePrice),
      wpStatus: p.status,
      wpManageStock: p.manageStock,
      wpStockQuantity: p.stockQuantity,
      wpStockStatus: p.stockStatus,
      externalCreatedAt: p.createdAt,
      externalUpdatedAt: p.updatedAt,
      syncedAt: new Date(),
      deletedAtSource: null,
    };
    let outcome: UpsertOutcome;
    let productId: string;
    if (!existing) {
      const created = await tx.product.create({
        data: {
          ...sourceData,
          connectionId: connection.id,
          externalId: p.externalId,
          source: "WORDPRESS",
          lowStockThreshold: p.lowStockAmount ?? settings.defaultLowStockThreshold,
        },
      });
      productId = created.id;
      outcome = "created";
    } else {
      productId = existing.id;
      const unchanged = sameTime(existing.externalUpdatedAt, p.updatedAt) && !existing.deletedAtSource && variants === null;
      // lowStockThreshold is CRM-owned and intentionally not overwritten.
      await tx.product.update({ where: { id: existing.id }, data: unchanged ? { syncedAt: new Date() } : sourceData });
      outcome = unchanged ? "unchanged" : "updated";
    }

    if (variants) {
      for (const v of variants) {
        await tx.productVariant.upsert({
          where: { productId_externalId: { productId, externalId: v.externalId } },
          create: {
            productId,
            externalId: v.externalId,
            sku: v.sku,
            name: v.name,
            attributes: v.attributes,
            price: dec(v.price),
            wpStockQuantity: v.stockQuantity,
            wpStockStatus: v.stockStatus,
            syncedAt: new Date(),
          },
          update: {
            sku: v.sku,
            name: v.name,
            attributes: v.attributes,
            price: dec(v.price),
            wpStockQuantity: v.stockQuantity,
            wpStockStatus: v.stockStatus,
            syncedAt: new Date(),
          },
        });
      }
    }

    // Link previously imported order lines that referenced this product before it was synced.
    await tx.orderItem.updateMany({
      where: { productId: null, externalProductId: p.externalId, order: { connectionId: connection.id } },
      data: { productId },
    });
    return outcome;
  });
}

export async function markProductDeletedAtSource(connectionId: string, externalId: string) {
  const res = await prisma.product.updateMany({ where: { connectionId, externalId, deletedAtSource: null }, data: { deletedAtSource: new Date() } });
  return res.count;
}

export async function syncProducts(ctx: SyncContext, opts: PhaseOptions): Promise<SyncStats> {
  const stats = opts.stats ?? emptyStats();
  const since = opts.full ? null : ctx.connection.productsCursor;
  const perPage = Math.min(100, Math.max(10, ctx.connection.perPage));
  const runStartedAt = opts.runStartedAt ?? new Date();
  const sleep = ctx.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let page = opts.startPage ?? 1;
  let totalPages = 1;
  await ctx.log("info", page > 1 ? `Product sync resumed at page ${page}` : `Product sync started (${since ? `changes since ${since.toISOString()}` : "full import"})`);
  do {
    const res = await ctx.adapter.listProducts(page, perPage, since);
    totalPages = res.totalPages;
    stats.pages++;
    stats.fetched += res.items.length;
    for (const p of res.items) {
      try {
        const variants = p.hasVariations ? await ctx.adapter.listVariations(p.externalId, p.name) : null;
        const outcome = await upsertProduct(ctx.connection, p, variants);
        stats[outcome]++;
      } catch (e) {
        stats.failed++;
        const message = e instanceof Error ? e.message : String(e);
        if (stats.errors.length < 50) stats.errors.push({ externalId: p.externalId, message });
        await ctx.log("error", `Product ${p.externalId} failed: ${message}`);
      }
    }
    if (page % 5 === 0) await ctx.log("info", `Products: page ${page}/${totalPages} processed`);
    page++;
    if (page <= totalPages && opts.deadline && Date.now() > opts.deadline) throw new SyncPaused("products", page, stats);
    if (page <= totalPages && ctx.pageDelayMs) await sleep(ctx.pageDelayMs);
  } while (page <= totalPages);

  // Full import that completed: flag catalogue items that no longer exist on the website (never deleted).
  // Every product seen during this run had its syncedAt refreshed, so anything older was not returned.
  if (opts.full && stats.failed === 0) {
    const missing = await prisma.product.updateMany({
      where: { connectionId: ctx.connection.id, deletedAtSource: null, OR: [{ syncedAt: null }, { syncedAt: { lt: runStartedAt } }] },
      data: { deletedAtSource: new Date() },
    });
    if (missing.count) await ctx.log("warn", `${missing.count} product(s) no longer exist on the website and were flagged (not deleted)`);
  }
  await ctx.log("info", `Product sync finished: ${stats.created} created, ${stats.updated} updated, ${stats.unchanged} unchanged, ${stats.failed} failed`);
  return stats;
}

// ───────────────────────────── Orders ─────────────────────────────

async function resolveLineRefs(tx: Tx, connectionId: string, productExternalId: string | null, variationExternalId: string | null) {
  if (!productExternalId) return { productId: null, variantId: null };
  const product = await tx.product.findUnique({ where: { connectionId_externalId: { connectionId, externalId: productExternalId } }, select: { id: true } });
  if (!product) return { productId: null, variantId: null };
  if (!variationExternalId) return { productId: product.id, variantId: null };
  const variant = await tx.productVariant.findUnique({ where: { productId_externalId: { productId: product.id, externalId: variationExternalId } }, select: { id: true } });
  return { productId: product.id, variantId: variant?.id ?? null };
}

export async function upsertOrder(
  connection: Pick<WordPressConnection, "id">,
  o: NormalizedOrder,
  actor: Actor,
  opts: { notifyNew?: boolean } = {},
): Promise<UpsertOutcome> {
  const settings = await getSettings();
  return prisma.$transaction(
    async (tx) => {
      await advisoryLock(tx, `order:${connection.id}:${o.externalId}`);
      const existing = await tx.order.findUnique({
        where: { connectionId_externalId: { connectionId: connection.id, externalId: o.externalId } },
        include: { items: true, shipments: { select: { dispatchedAt: true } } },
      });
      if (!existing && IGNORED_WC_STATUSES.has(o.wcStatus)) return "ignored";

      const sourceFields = {
        number: o.number,
        customerName: o.customerName,
        customerEmail: o.customerEmail,
        customerPhone: o.customerPhone,
        billingAddress: o.billingAddress ?? Prisma.DbNull,
        shippingAddress: o.shippingAddress ?? Prisma.DbNull,
        shippingMethod: o.shippingMethod,
        paymentMethod: o.paymentMethod,
        currency: o.currency,
        subtotal: new Prisma.Decimal(o.subtotal),
        shippingTotal: new Prisma.Decimal(o.shippingTotal),
        taxTotal: new Prisma.Decimal(o.taxTotal),
        discountTotal: new Prisma.Decimal(o.discountTotal),
        total: new Prisma.Decimal(o.total),
        refundedTotal: new Prisma.Decimal(o.refundedTotal),
        customerNote: o.customerNote,
        orderDate: o.orderDate,
        paidAt: o.paidAt,
        externalUpdatedAt: o.updatedAt,
        syncedAt: new Date(),
      };

      if (!existing) {
        const decision = decideStatusFromWc(o.wcStatus, null, o.refundedTotal, o.total);
        const order = await tx.order.create({
          data: {
            ...sourceFields,
            connectionId: connection.id,
            externalId: o.externalId,
            source: "WORDPRESS",
            wcStatus: o.wcStatus,
            status: decision.status,
            paymentStatus: decision.paymentStatus,
            expectedDispatchDate: addDays(o.orderDate, settings.dispatchSlaDays),
          },
        });
        for (const l of o.lines) {
          const refs = await resolveLineRefs(tx, connection.id, l.productExternalId, l.variationExternalId);
          await tx.orderItem.create({
            data: {
              orderId: order.id,
              externalId: l.externalId,
              externalProductId: l.productExternalId,
              externalVariationId: l.variationExternalId,
              ...refs,
              name: l.name,
              sku: l.sku,
              quantity: l.quantity,
              unitPrice: new Prisma.Decimal(l.unitPrice),
              total: new Prisma.Decimal(l.total),
            },
          });
        }
        await addOrderEvent(tx, {
          orderId: order.id,
          type: "SYNC",
          actor,
          toValue: decision.status,
          message: `Imported from website (WooCommerce status "${o.wcStatus}") — ${decision.note}`,
        });
        if (decision.attention) await flagAttention(tx, order, decision.attention);
        await syncOrderReservations(tx, order.id);
        if (opts.notifyNew && Date.now() - o.orderDate.getTime() < 48 * 3600_000) {
          await notify(
            {
              type: "NEW_ORDER",
              title: `New order #${order.number}`,
              message: `${order.customerName} · ${o.lines.length} item(s) · ${o.currency} ${o.total.toFixed(2)}`,
              link: `/orders/${order.id}`,
              dedupeKey: `neworder:${order.id}`,
            },
            tx,
          );
        }
        return "created";
      }

      // Existing order
      const statusChanged = existing.wcStatus !== o.wcStatus;
      const unchanged = !statusChanged && sameTime(existing.externalUpdatedAt, o.updatedAt);
      if (unchanged) {
        await tx.order.update({ where: { id: existing.id }, data: { syncedAt: new Date() } });
        return "unchanged";
      }

      const data: Prisma.OrderUpdateInput = { ...sourceFields, wcStatus: o.wcStatus };
      let attention: string | undefined;
      if (statusChanged) {
        const decision = decideStatusFromWc(
          o.wcStatus,
          { status: existing.status, paymentStatus: existing.paymentStatus, hasDispatchedShipment: existing.shipments.some((s) => !!s.dispatchedAt) },
          o.refundedTotal,
          o.total,
        );
        data.status = decision.status;
        data.paymentStatus = decision.paymentStatus;
        attention = decision.attention;
        await addOrderEvent(tx, {
          orderId: existing.id,
          type: "SYNC",
          actor,
          fromValue: existing.status,
          toValue: decision.status,
          message: `Website status changed "${existing.wcStatus ?? "—"}" → "${o.wcStatus}" — ${decision.note}`,
        });
      } else if (o.refundedTotal > 0 && existing.paymentStatus === "PAID" && o.refundedTotal < o.total) {
        data.paymentStatus = "PARTIALLY_REFUNDED";
        await addOrderEvent(tx, { orderId: existing.id, type: "PAYMENT", actor, fromValue: "PAID", toValue: "PARTIALLY_REFUNDED", message: `Partial refund of ${o.refundedTotal.toFixed(2)} recorded on website` });
      }
      await tx.order.update({ where: { id: existing.id }, data });

      // Line items: update quantities only where it does not conflict with fulfilment already done.
      const seenLines = new Set<string>();
      for (const l of o.lines) {
        seenLines.add(l.externalId);
        const cur = existing.items.find((i) => i.externalId === l.externalId);
        const refs = await resolveLineRefs(tx, existing.connectionId!, l.productExternalId, l.variationExternalId);
        if (!cur) {
          await tx.orderItem.create({
            data: {
              orderId: existing.id,
              externalId: l.externalId,
              externalProductId: l.productExternalId,
              externalVariationId: l.variationExternalId,
              ...refs,
              name: l.name,
              sku: l.sku,
              quantity: l.quantity,
              unitPrice: new Prisma.Decimal(l.unitPrice),
              total: new Prisma.Decimal(l.total),
            },
          });
          continue;
        }
        if (l.quantity < cur.packedQty) {
          attention = `Quantity of "${l.name}" was reduced on the website to ${l.quantity}, but ${cur.packedQty} are already packed.`;
          continue;
        }
        await tx.orderItem.update({
          where: { id: cur.id },
          data: {
            name: l.name,
            sku: l.sku,
            quantity: l.quantity,
            unitPrice: new Prisma.Decimal(l.unitPrice),
            total: new Prisma.Decimal(l.total),
            externalProductId: l.productExternalId,
            externalVariationId: l.variationExternalId,
            ...(cur.productId ? {} : refs),
          },
        });
      }
      for (const cur of existing.items) {
        if (cur.externalId && !seenLines.has(cur.externalId)) {
          if (cur.packedQty > 0) {
            attention = `"${cur.name}" was removed from the order on the website after it was packed.`;
          } else {
            await tx.orderItem.delete({ where: { id: cur.id } });
          }
        }
      }
      if (attention) await flagAttention(tx, existing, attention);
      await syncOrderReservations(tx, existing.id);
      await onOrderFulfilmentChanged(tx, existing.id);
      return "updated";
    },
    { timeout: 30_000, maxWait: 15_000 },
  );
}

export async function flagOrderDeletedAtSource(connectionId: string, externalId: string) {
  const order = await prisma.order.findUnique({ where: { connectionId_externalId: { connectionId, externalId } } });
  if (!order) return false;
  await prisma.$transaction(async (tx) => {
    await addOrderEvent(tx, { orderId: order.id, type: "SYNC", actor: "WEBHOOK", message: "Order was deleted/trashed on the website. The CRM record is kept for audit." });
    await flagAttention(tx, order, "Order was deleted on the website. Review and cancel in the CRM if appropriate.");
  });
  return true;
}

export async function syncOrders(ctx: SyncContext, opts: PhaseOptions): Promise<SyncStats> {
  const stats = opts.stats ?? emptyStats();
  if (!ctx.adapter.supportsOrders) {
    await ctx.log("info", "Order sync skipped: this connection type has no orders (WooCommerce not in use)");
    return stats;
  }
  const since = opts.full ? null : ctx.connection.ordersCursor;
  const perPage = Math.min(100, Math.max(10, ctx.connection.perPage));
  const sleep = ctx.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const notifyNew = !!since; // do not flood notifications during the initial import
  let page = opts.startPage ?? 1;
  let totalPages = 1;
  await ctx.log("info", page > 1 ? `Order sync resumed at page ${page}` : `Order sync started (${since ? `changes since ${since.toISOString()}` : "full import"})`);
  do {
    const res = await ctx.adapter.listOrders(page, perPage, since);
    totalPages = res.totalPages;
    stats.pages++;
    stats.fetched += res.items.length;
    for (const o of res.items) {
      try {
        const outcome = await upsertOrder(ctx.connection, o, "SYNC", { notifyNew });
        stats[outcome]++;
      } catch (e) {
        stats.failed++;
        const message = e instanceof Error ? e.message : String(e);
        if (stats.errors.length < 50) stats.errors.push({ externalId: o.externalId, message });
        await ctx.log("error", `Order ${o.number} (${o.externalId}) failed: ${message}`);
      }
    }
    if (page % 5 === 0) await ctx.log("info", `Orders: page ${page}/${totalPages} processed`);
    page++;
    if (page <= totalPages && opts.deadline && Date.now() > opts.deadline) throw new SyncPaused("orders", page, stats);
    if (page <= totalPages && ctx.pageDelayMs) await sleep(ctx.pageDelayMs);
  } while (page <= totalPages);
  await ctx.log("info", `Order sync finished: ${stats.created} created, ${stats.updated} updated, ${stats.unchanged} unchanged, ${stats.ignored} ignored, ${stats.failed} failed`);
  return stats;
}
