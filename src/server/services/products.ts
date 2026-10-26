import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { AppError, notFound } from "@/lib/errors";
import { audit } from "@/server/audit";

export type StockFilter = "all" | "in" | "low" | "out" | "untracked" | "active" | "draft" | "recent" | "removed";

export interface ProductListParams {
  q?: string;
  filter?: StockFilter;
  category?: string;
  sort?: "name" | "sku" | "price" | "onhand" | "available" | "updated" | "created";
  dir?: "asc" | "desc";
  page?: number;
  pageSize?: number;
}

/**
 * Stock state:
 *  - Tracked products (linked to a PRODUCT inventory item) use PHYSICAL ledger stock.
 *  - Untracked products fall back to the WEBSITE stock reported by WooCommerce (flagged as such).
 */
const BASE_CTE = Prisma.sql`
  WITH agg AS (
    SELECT "productId" AS pid,
           SUM("qtyOnHand")::int AS onhand, SUM("qtyReserved")::int AS reserved,
           SUM("qtyDispatched")::int AS dispatched, SUM("qtyReturned")::int AS returned,
           SUM("qtyDamaged")::int AS damaged, SUM("reorderLevel")::int AS reorder, COUNT(*)::int AS n
    FROM "InventoryItem" WHERE category = 'PRODUCT' AND active AND "productId" IS NOT NULL
    GROUP BY "productId"
  ),
  base AS (
    SELECT p.id, p.name, p.sku, p.price, p."wpStatus", p."createdAt", p."updatedAt", p."externalCreatedAt",
           p.categories, p."deletedAtSource", p."isDemo",
           COALESCE(agg.n, 0) AS tracked, agg.onhand, agg.reserved,
           CASE WHEN COALESCE(agg.n, 0) > 0 THEN
             CASE WHEN agg.onhand <= 0 THEN 'out'
                  WHEN agg.onhand - agg.reserved <= agg.reorder THEN 'low'
                  ELSE 'in' END
           ELSE
             CASE WHEN p."wpStockStatus" = 'outofstock' OR (p."wpManageStock" AND COALESCE(p."wpStockQuantity", 0) <= 0) THEN 'out'
                  WHEN p."wpManageStock" AND p."wpStockQuantity" <= p."lowStockThreshold" THEN 'low'
                  WHEN p."wpStockStatus" IS NULL AND NOT p."wpManageStock" THEN 'unknown'
                  ELSE 'in' END
           END AS stock_state
    FROM "Product" p LEFT JOIN agg ON agg.pid = p.id
  )`;

const SORTS: Record<NonNullable<ProductListParams["sort"]>, Prisma.Sql> = {
  name: Prisma.sql`name`,
  sku: Prisma.sql`sku`,
  price: Prisma.sql`price`,
  onhand: Prisma.sql`onhand`,
  available: Prisma.sql`(COALESCE(onhand,0) - COALESCE(reserved,0))`,
  updated: Prisma.sql`"updatedAt"`,
  created: Prisma.sql`COALESCE("externalCreatedAt", "createdAt")`,
};

function whereSql(p: ProductListParams) {
  const conds: Prisma.Sql[] = [];
  if (p.q) {
    const like = `%${p.q}%`;
    conds.push(Prisma.sql`(name ILIKE ${like} OR sku ILIKE ${like})`);
  }
  if (p.category) conds.push(Prisma.sql`${p.category} = ANY(categories)`);
  switch (p.filter) {
    case "in":
    case "low":
    case "out":
      conds.push(Prisma.sql`stock_state = ${p.filter}`, Prisma.sql`"deletedAtSource" IS NULL`);
      break;
    case "untracked":
      conds.push(Prisma.sql`tracked = 0`);
      break;
    case "active":
      conds.push(Prisma.sql`"wpStatus" = 'publish'`, Prisma.sql`"deletedAtSource" IS NULL`);
      break;
    case "draft":
      conds.push(Prisma.sql`"wpStatus" IN ('draft', 'pending', 'private')`);
      break;
    case "recent":
      conds.push(Prisma.sql`COALESCE("externalCreatedAt", "createdAt") > now() - interval '30 days'`);
      break;
    case "removed":
      conds.push(Prisma.sql`"deletedAtSource" IS NOT NULL`);
      break;
  }
  return conds.length ? Prisma.sql`WHERE ${Prisma.join(conds, " AND ")}` : Prisma.empty;
}

export async function listProducts(params: ProductListParams) {
  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(100, Math.max(5, params.pageSize ?? 25));
  const where = whereSql(params);
  const sort = SORTS[params.sort ?? "updated"] ?? SORTS.updated;
  const dir = params.dir === "asc" ? Prisma.sql`ASC` : Prisma.sql`DESC`;
  const [idRows, countRows] = await Promise.all([
    prisma.$queryRaw<{ id: string; stock_state: string }[]>`${BASE_CTE} SELECT id, stock_state FROM base ${where} ORDER BY ${sort} ${dir} NULLS LAST, id LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`,
    prisma.$queryRaw<{ c: number }[]>`${BASE_CTE} SELECT COUNT(*)::int AS c FROM base ${where}`,
  ]);
  const ids = idRows.map((r) => r.id);
  const products = await prisma.product.findMany({
    where: { id: { in: ids } },
    include: {
      inventoryItems: { where: { category: "PRODUCT", active: true } },
      _count: { select: { variants: true } },
    },
  });
  const byId = new Map(products.map((p) => [p.id, p]));
  const rows = idRows
    .map((r) => {
      const p = byId.get(r.id);
      if (!p) return null;
      return { ...summarizeProduct(p, p.inventoryItems), stockState: r.stock_state as "in" | "low" | "out" | "unknown" };
    })
    .filter((x): x is NonNullable<typeof x> => !!x);
  return { rows, total: countRows[0]?.c ?? 0, page, pageSize };
}

type ItemLike = { qtyOnHand: number; qtyReserved: number; qtyDispatched: number; qtyReturned: number; qtyDamaged: number; qtyReceived: number; qtyOpening: number; reorderLevel: number };

export function summarizeProduct<P extends { id: string; lowStockThreshold: number; wpStockQuantity: number | null }>(p: P, items: ItemLike[]) {
  const tracked = items.length > 0;
  const sum = (k: keyof ItemLike) => items.reduce((s, i) => s + (i[k] as number), 0);
  return {
    ...p,
    tracked,
    stock: tracked
      ? {
          source: "PHYSICAL" as const,
          totalStock: sum("qtyOnHand"),
          available: sum("qtyOnHand") - sum("qtyReserved"),
          reserved: sum("qtyReserved"),
          dispatched: sum("qtyDispatched"),
          returned: sum("qtyReturned"),
          damaged: sum("qtyDamaged"),
          threshold: sum("reorderLevel"),
        }
      : {
          source: "WEBSITE" as const,
          totalStock: p.wpStockQuantity,
          available: p.wpStockQuantity,
          reserved: null,
          dispatched: null,
          returned: null,
          damaged: null,
          threshold: p.lowStockThreshold,
        },
  };
}

export async function getProductDetail(id: string) {
  const product = await prisma.product.findUnique({
    where: { id },
    include: {
      variants: { orderBy: { name: "asc" }, include: { inventoryItems: { where: { active: true } } } },
      inventoryItems: { where: { active: true }, include: { stockLevels: { include: { location: true } } } },
      consumptionRules: { include: { material: true } },
      connection: { select: { siteUrl: true, lastSuccessfulSyncAt: true } },
    },
  });
  if (!product) throw notFound("Product");
  const itemIds = product.inventoryItems.map((i) => i.id);
  const [ledger, orderItems] = await Promise.all([
    prisma.inventoryLedgerEntry.findMany({
      where: { itemId: { in: itemIds } },
      orderBy: { createdAt: "desc" },
      take: 100,
      include: { user: { select: { name: true } }, location: { select: { code: true } } },
    }),
    prisma.orderItem.findMany({
      where: { productId: id },
      orderBy: { order: { orderDate: "desc" } },
      take: 50,
      include: { order: { select: { id: true, number: true, orderDate: true, status: true, customerName: true, total: true, currency: true } } },
    }),
  ]);
  return { product: summarizeProduct(product, product.inventoryItems), ledger, orderItems };
}

export async function productCategories() {
  const rows = await prisma.$queryRaw<{ c: string }[]>`SELECT DISTINCT unnest(categories) AS c FROM "Product" ORDER BY 1 LIMIT 200`;
  return rows.map((r) => r.c);
}

export async function updateProductSettings(id: string, patch: { lowStockThreshold?: number }, actor: { userId: string; ip?: string | null }) {
  if (patch.lowStockThreshold !== undefined && (patch.lowStockThreshold < 0 || !Number.isInteger(patch.lowStockThreshold))) {
    throw new AppError("Threshold must be a non-negative whole number", 400, "INVALID");
  }
  return prisma.$transaction(async (tx) => {
    const p = await tx.product.update({ where: { id }, data: patch });
    if (patch.lowStockThreshold !== undefined) {
      // Keep the linked (non-variant) physical item's reorder level aligned with the product threshold.
      await tx.inventoryItem.updateMany({ where: { productId: id, variantId: null, category: "PRODUCT" }, data: { reorderLevel: patch.lowStockThreshold } });
    }
    await audit({ userId: actor.userId, action: "product.update", entityType: "Product", entityId: id, summary: `Product ${p.name}: low-stock threshold ${patch.lowStockThreshold}`, ip: actor.ip }, tx);
    return p;
  });
}
