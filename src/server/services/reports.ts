/** Reporting service: report definitions + CSV / Excel generation. */
import ExcelJS from "exceljs";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { can, type Permission } from "@/lib/auth/permissions";
import type { SessionUser } from "@/lib/auth/session";
import { AppError, forbidden } from "@/lib/errors";
import { addDays, dayKey, startOfDay, toNumber } from "@/lib/utils";
import { BUSINESS_TZ } from "./dashboard";
import { CATEGORY_LABELS } from "./inventory-ops";
import { ORDER_STATUS_LABELS } from "./orders";
import { getSettings } from "./settings";

export interface ReportParams {
  from?: Date;
  to?: Date; // inclusive day
  q?: string;
}

export interface Column {
  key: string;
  header: string;
  width?: number;
  type?: "text" | "number" | "money" | "date";
}

export interface ReportResult {
  title: string;
  columns: Column[];
  rows: Record<string, string | number | null>[];
}

interface ReportDef {
  key: string;
  title: string;
  description: string;
  permission: Permission;
  dateRange: boolean;
  defaultDays?: number;
  run: (p: Required<Pick<ReportParams, "from" | "to">> & ReportParams, user: SessionUser) => Promise<ReportResult>;
}

const iso = (d: Date | null | undefined) => (d ? d.toISOString().replace("T", " ").slice(0, 16) : null);
const like = (q?: string) => (q ? { contains: q, mode: "insensitive" as const } : undefined);

const DEFS: ReportDef[] = [
  {
    key: "daily-sales",
    title: "Daily sales",
    description: "Orders and paid revenue per day",
    permission: "reports:view",
    dateRange: true,
    defaultDays: 30,
    run: async ({ from, to }) => salesBy("day", from, to, "Daily sales"),
  },
  {
    key: "monthly-sales",
    title: "Monthly sales",
    description: "Orders and paid revenue per month",
    permission: "reports:view",
    dateRange: true,
    defaultDays: 365,
    run: async ({ from, to }) => salesBy("month", from, to, "Monthly sales"),
  },
  {
    key: "product-inventory",
    title: "Product inventory",
    description: "Finished products: physical ledger stock vs website stock",
    permission: "reports:view",
    dateRange: false,
    run: async ({ q }) => {
      const products = await prisma.product.findMany({
        where: { deletedAtSource: null, ...(q ? { OR: [{ name: like(q) }, { sku: like(q) }] } : {}) },
        include: { inventoryItems: { where: { category: "PRODUCT", active: true } } },
        orderBy: { name: "asc" },
      });
      return {
        title: "Product inventory",
        columns: [
          { key: "name", header: "Product", width: 36 },
          { key: "sku", header: "SKU", width: 16 },
          { key: "status", header: "Website status" },
          { key: "price", header: "Price", type: "money" },
          { key: "websiteStock", header: "Website stock (synced)", type: "number" },
          { key: "tracked", header: "Physically tracked" },
          { key: "onHand", header: "Physical on hand", type: "number" },
          { key: "reserved", header: "Reserved", type: "number" },
          { key: "available", header: "Available", type: "number" },
          { key: "dispatched", header: "Dispatched", type: "number" },
          { key: "returned", header: "Returned", type: "number" },
          { key: "damaged", header: "Damaged", type: "number" },
          { key: "threshold", header: "Low-stock threshold", type: "number" },
          { key: "source", header: "Data source" },
        ],
        rows: products.map((p) => {
          const s = (k: "qtyOnHand" | "qtyReserved" | "qtyDispatched" | "qtyReturned" | "qtyDamaged") => p.inventoryItems.reduce((a, i) => a + i[k], 0);
          const tracked = p.inventoryItems.length > 0;
          return {
            name: p.name,
            sku: p.sku,
            status: p.wpStatus,
            price: toNumber(p.price),
            websiteStock: p.wpStockQuantity,
            tracked: tracked ? "Yes" : "No",
            onHand: tracked ? s("qtyOnHand") : null,
            reserved: tracked ? s("qtyReserved") : null,
            available: tracked ? s("qtyOnHand") - s("qtyReserved") : null,
            dispatched: tracked ? s("qtyDispatched") : null,
            returned: tracked ? s("qtyReturned") : null,
            damaged: tracked ? s("qtyDamaged") : null,
            threshold: p.lowStockThreshold,
            source: p.isDemo ? "DEMO" : p.source,
          };
        }),
      };
    },
  },
  {
    key: "packaging-inventory",
    title: "Packaging & materials inventory",
    description: "Bottles, labels, caps, boxes, packaging and raw materials",
    permission: "reports:view",
    dateRange: false,
    run: async ({ q }) => itemsReport("Packaging & materials inventory", { category: { not: "PRODUCT" }, ...(q ? { OR: [{ name: like(q) }, { sku: like(q) }] } : {}) }),
  },
  {
    key: "stock-movements",
    title: "Stock movements",
    description: "Every ledger entry in the period, with reason and user",
    permission: "reports:view",
    dateRange: true,
    defaultDays: 30,
    run: async ({ from, to, q }) => {
      const rows = await prisma.inventoryLedgerEntry.findMany({
        where: { createdAt: { gte: from, lt: to }, ...(q ? { OR: [{ item: { name: like(q) } }, { item: { sku: like(q) } }, { reason: like(q) }] } : {}) },
        include: { item: true, user: { select: { name: true } }, location: true },
        orderBy: { createdAt: "asc" },
        take: 50_000,
      });
      return {
        title: "Stock movements",
        columns: [
          { key: "at", header: "Date/time", type: "date", width: 18 },
          { key: "sku", header: "SKU", width: 16 },
          { key: "item", header: "Item", width: 32 },
          { key: "category", header: "Category" },
          { key: "type", header: "Movement" },
          { key: "quantity", header: "Qty (±)", type: "number" },
          { key: "balance", header: "Balance after", type: "number" },
          { key: "location", header: "Location" },
          { key: "reason", header: "Reason", width: 40 },
          { key: "reference", header: "Reference" },
          { key: "user", header: "User" },
        ],
        rows: rows.map((r) => ({
          at: iso(r.createdAt),
          sku: r.item.sku,
          item: r.item.name,
          category: CATEGORY_LABELS[r.item.category],
          type: r.type,
          quantity: r.quantity,
          balance: r.balanceAfter,
          location: r.location.code,
          reason: r.reason,
          reference: r.referenceType ? `${r.referenceType}${r.referenceId ? `:${r.referenceId}` : ""}` : null,
          user: r.user?.name ?? "System",
        })),
      };
    },
  },
  {
    key: "pending-dispatch",
    title: "Orders pending dispatch",
    description: "Confirmed orders not yet dispatched",
    permission: "reports:view",
    dateRange: false,
    run: async ({ q }, user) => ordersReport("Orders pending dispatch", { status: { in: ["NEW", "CONFIRMED", "PROCESSING", "READY_TO_PACK", "READY_TO_DISPATCH", "ON_HOLD"] }, ...orderSearch(q) }, user),
  },
  {
    key: "dispatched",
    title: "Orders dispatched",
    description: "Shipments dispatched in the period (default: today)",
    permission: "reports:view",
    dateRange: true,
    defaultDays: 1,
    run: async ({ from, to, q }) => {
      const rows = await prisma.shipment.findMany({
        where: { dispatchedAt: { gte: from, lt: to }, ...(q ? { OR: [{ trackingNumber: like(q) }, { courier: like(q) }, { order: { number: like(q) } }] } : {}) },
        include: { order: { select: { number: true, customerName: true } }, lines: { include: { orderItem: { select: { name: true, sku: true } } } } },
        orderBy: { dispatchedAt: "asc" },
      });
      return {
        title: "Orders dispatched",
        columns: [
          { key: "dispatchedAt", header: "Dispatched", type: "date", width: 18 },
          { key: "order", header: "Order #" },
          { key: "customer", header: "Customer", width: 24 },
          { key: "items", header: "Items", width: 40 },
          { key: "units", header: "Units", type: "number" },
          { key: "courier", header: "Courier" },
          { key: "tracking", header: "Tracking #", width: 20 },
          { key: "status", header: "Shipment status" },
        ],
        rows: rows.map((s) => ({
          dispatchedAt: iso(s.dispatchedAt),
          order: s.order.number,
          customer: s.order.customerName,
          items: s.lines.map((l) => `${l.quantity}× ${l.orderItem.name}`).join("; "),
          units: s.lines.reduce((a, l) => a + l.quantity, 0),
          courier: s.courier,
          tracking: s.trackingNumber,
          status: s.status,
        })),
      };
    },
  },
  {
    key: "delivered-returned",
    title: "Delivered & returned orders",
    description: "Deliveries confirmed and returns received in the period",
    permission: "reports:view",
    dateRange: true,
    defaultDays: 30,
    run: async ({ from, to }) => {
      const [delivered, returns] = await Promise.all([
        prisma.shipment.findMany({ where: { deliveredAt: { gte: from, lt: to } }, include: { order: { select: { number: true, customerName: true, total: true } } } }),
        prisma.orderReturn.findMany({ where: { receivedAt: { gte: from, lt: to } }, include: { order: { select: { number: true, customerName: true, total: true } }, lines: { include: { orderItem: { select: { name: true } } } } } }),
      ]);
      return {
        title: "Delivered & returned orders",
        columns: [
          { key: "at", header: "Date", type: "date", width: 18 },
          { key: "event", header: "Event" },
          { key: "order", header: "Order #" },
          { key: "customer", header: "Customer", width: 24 },
          { key: "detail", header: "Detail", width: 40 },
          { key: "total", header: "Order total", type: "money" },
        ],
        rows: [
          ...delivered.map((d) => ({ at: iso(d.deliveredAt), event: "Delivered", order: d.order.number, customer: d.order.customerName, detail: `${d.courier ?? ""} ${d.trackingNumber ?? ""}`.trim(), total: toNumber(d.order.total) })),
          ...returns.map((r) => ({ at: iso(r.receivedAt), event: "Returned", order: r.order.number, customer: r.order.customerName, detail: `${r.reason}: ${r.lines.map((l) => `${l.quantity}× ${l.orderItem.name} (${l.condition})`).join("; ")}`, total: toNumber(r.order.total) })),
        ].sort((a, b) => String(a.at).localeCompare(String(b.at))),
      };
    },
  },
  {
    key: "low-stock",
    title: "Low-stock items",
    description: "All inventory items at or below reorder level",
    permission: "reports:view",
    dateRange: false,
    run: async () => {
      const ids = await prisma.$queryRaw<{ id: string }[]>`SELECT id FROM "InventoryItem" WHERE active AND "qtyOnHand" - "qtyReserved" <= "reorderLevel"`;
      return itemsReport("Low-stock items", { id: { in: ids.map((i) => i.id) } });
    },
  },
  {
    key: "onboarding-progress",
    title: "Product onboarding progress",
    description: "Every onboarding item with stage, owner and task progress",
    permission: "reports:view",
    dateRange: false,
    run: async ({ q }) => {
      const items = await prisma.onboardingItem.findMany({
        where: q ? { OR: [{ title: like(q) }, { sku: like(q) }] } : {},
        include: { stage: true, owner: { select: { name: true } }, tasks: true, documents: { select: { id: true } } },
        orderBy: [{ stage: { position: "asc" } }, { updatedAt: "desc" }],
      });
      return {
        title: "Product onboarding progress",
        columns: [
          { key: "title", header: "Product", width: 32 },
          { key: "sku", header: "SKU" },
          { key: "stage", header: "Stage", width: 22 },
          { key: "priority", header: "Priority" },
          { key: "owner", header: "Owner" },
          { key: "due", header: "Due", type: "date" },
          { key: "tasks", header: "Tasks done" },
          { key: "documents", header: "Documents", type: "number" },
          { key: "daysInStage", header: "Days in stage", type: "number" },
        ],
        rows: items.map((i) => ({
          title: i.title,
          sku: i.sku,
          stage: i.stage.name,
          priority: i.priority,
          owner: i.owner?.name ?? null,
          due: i.dueDate ? dayKey(i.dueDate) : null,
          tasks: `${i.tasks.filter((t) => t.done).length}/${i.tasks.length}`,
          documents: i.documents.length,
          daysInStage: Math.floor((Date.now() - i.stageEnteredAt.getTime()) / 86_400_000),
        })),
      };
    },
  },
  {
    key: "supplier-purchases",
    title: "Supplier purchases",
    description: "Goods received (GRN) lines in the period",
    permission: "reports:view",
    dateRange: true,
    defaultDays: 90,
    run: async ({ from, to, q }) => {
      const lines = await prisma.purchaseReceiptLine.findMany({
        where: { receipt: { receivedAt: { gte: from, lt: to }, ...(q ? { OR: [{ number: like(q) }, { supplier: { name: like(q) } }, { invoiceRef: like(q) }] } : {}) } },
        include: { receipt: { include: { supplier: true } }, item: true },
        orderBy: { receipt: { receivedAt: "asc" } },
      });
      return {
        title: "Supplier purchases",
        columns: [
          { key: "date", header: "Received", type: "date", width: 18 },
          { key: "grn", header: "GRN #", width: 18 },
          { key: "supplier", header: "Supplier", width: 24 },
          { key: "invoice", header: "Invoice ref" },
          { key: "sku", header: "SKU" },
          { key: "item", header: "Item", width: 30 },
          { key: "qty", header: "Quantity", type: "number" },
          { key: "unitCost", header: "Unit cost", type: "money" },
          { key: "lineTotal", header: "Line total", type: "money" },
        ],
        rows: lines.map((l) => ({
          date: iso(l.receipt.receivedAt),
          grn: l.receipt.number,
          supplier: l.receipt.supplier?.name ?? null,
          invoice: l.receipt.invoiceRef,
          sku: l.item.sku,
          item: l.item.name,
          qty: l.quantity,
          unitCost: l.unitCost ? toNumber(l.unitCost) : null,
          lineTotal: l.unitCost ? toNumber(l.unitCost) * l.quantity : null,
        })),
      };
    },
  },
  {
    key: "mlm-commissions",
    title: "MLM sales & commissions",
    description: "Commission ledger (only when the MLM module is enabled)",
    permission: "mlm:view",
    dateRange: true,
    defaultDays: 90,
    run: async ({ from, to, q }) => {
      const s = await getSettings();
      if (!s.mlmEnabled) throw new AppError("MLM module is disabled", 409, "MLM_DISABLED");
      const rows = await prisma.commission.findMany({
        where: { createdAt: { gte: from, lt: to }, ...(q ? { member: { OR: [{ name: like(q) }, { referralCode: like(q) }] } } : {}) },
        include: { member: true, order: { select: { number: true } }, rule: { select: { name: true } } },
        orderBy: { createdAt: "asc" },
      });
      return {
        title: "MLM sales & commissions",
        columns: [
          { key: "date", header: "Date", type: "date", width: 18 },
          { key: "member", header: "Member", width: 24 },
          { key: "code", header: "Referral code" },
          { key: "order", header: "Order #" },
          { key: "rule", header: "Rule" },
          { key: "level", header: "Level", type: "number" },
          { key: "base", header: "Eligible sale", type: "money" },
          { key: "rate", header: "Rate %", type: "number" },
          { key: "amount", header: "Commission", type: "money" },
          { key: "status", header: "Status" },
        ],
        rows: rows.map((c) => ({
          date: iso(c.createdAt),
          member: c.member.name,
          code: c.member.referralCode,
          order: c.order.number,
          rule: c.rule.name,
          level: c.level,
          base: toNumber(c.baseAmount),
          rate: toNumber(c.ratePercent),
          amount: toNumber(c.amount),
          status: c.status,
        })),
      };
    },
  },
];

function orderSearch(q?: string): Prisma.OrderWhereInput {
  return q ? { OR: [{ number: like(q) }, { customerName: like(q) }] } : {};
}

async function ordersReport(title: string, where: Prisma.OrderWhereInput, user: SessionUser): Promise<ReportResult> {
  const pii = can(user.role, "reports:export_sensitive");
  const orders = await prisma.order.findMany({ where, include: { items: true }, orderBy: { orderDate: "asc" } });
  const columns: Column[] = [
    { key: "number", header: "Order #" },
    { key: "date", header: "Order date", type: "date", width: 18 },
    { key: "expected", header: "Expected dispatch", type: "date" },
    { key: "customer", header: "Customer", width: 24 },
    ...(pii
      ? ([
          { key: "phone", header: "Phone" },
          { key: "email", header: "Email", width: 24 },
          { key: "address", header: "Shipping address", width: 40 },
        ] as Column[])
      : []),
    { key: "items", header: "Items", width: 40 },
    { key: "units", header: "Units", type: "number" },
    { key: "total", header: "Amount", type: "money" },
    { key: "status", header: "Status" },
    { key: "payment", header: "Payment" },
    { key: "shipping", header: "Shipping" },
  ];
  return {
    title,
    columns,
    rows: orders.map((o) => {
      const addr = (o.shippingAddress ?? o.billingAddress) as Record<string, string> | null;
      return {
        number: o.number,
        date: iso(o.orderDate),
        expected: o.expectedDispatchDate ? dayKey(o.expectedDispatchDate) : null,
        customer: o.customerName,
        ...(pii
          ? {
              phone: o.customerPhone,
              email: o.customerEmail,
              address: addr ? [addr.address_1, addr.address_2, addr.city, addr.state, addr.postcode, addr.country].filter(Boolean).join(", ") : null,
            }
          : {}),
        items: o.items.map((i) => `${i.quantity}× ${i.name}`).join("; "),
        units: o.items.reduce((a, i) => a + i.quantity, 0),
        total: toNumber(o.total),
        status: ORDER_STATUS_LABELS[o.status],
        payment: o.paymentStatus,
        shipping: o.shippingStatus,
      };
    }),
  };
}

async function itemsReport(title: string, where: Prisma.InventoryItemWhereInput): Promise<ReportResult> {
  const items = await prisma.inventoryItem.findMany({ where: { active: true, ...where }, include: { supplier: true }, orderBy: [{ category: "asc" }, { name: "asc" }] });
  return {
    title,
    columns: [
      { key: "sku", header: "SKU", width: 16 },
      { key: "name", header: "Item", width: 32 },
      { key: "category", header: "Category", width: 20 },
      { key: "unit", header: "Unit" },
      { key: "opening", header: "Opening", type: "number" },
      { key: "received", header: "Received", type: "number" },
      { key: "consumed", header: "Consumed", type: "number" },
      { key: "dispatched", header: "Dispatched", type: "number" },
      { key: "returned", header: "Returned", type: "number" },
      { key: "damaged", header: "Damaged", type: "number" },
      { key: "adjusted", header: "Adjustments", type: "number" },
      { key: "onHand", header: "Physical stock", type: "number" },
      { key: "reserved", header: "Reserved", type: "number" },
      { key: "available", header: "Available", type: "number" },
      { key: "reorder", header: "Reorder level", type: "number" },
      { key: "supplier", header: "Supplier", width: 22 },
      { key: "lastMovement", header: "Last movement", type: "date" },
    ],
    rows: items.map((i) => ({
      sku: i.sku,
      name: i.name,
      category: i.customCategory || CATEGORY_LABELS[i.category],
      unit: i.unit,
      opening: i.qtyOpening,
      received: i.qtyReceived,
      consumed: i.qtyConsumed,
      dispatched: i.qtyDispatched,
      returned: i.qtyReturned,
      damaged: i.qtyDamaged,
      adjusted: i.qtyAdjusted,
      onHand: i.qtyOnHand,
      reserved: i.qtyReserved,
      available: i.qtyOnHand - i.qtyReserved,
      reorder: i.reorderLevel,
      supplier: i.supplier?.name ?? null,
      lastMovement: iso(i.lastMovementAt),
    })),
  };
}

async function salesBy(unit: "day" | "month", from: Date, to: Date, title: string): Promise<ReportResult> {
  const rows = await prisma.$queryRawUnsafe<{ d: Date; orders: number; paid: number; gross: number; refunds: number; cancelled: number }[]>(
    `SELECT date_trunc('${unit}', ("orderDate" AT TIME ZONE 'UTC') AT TIME ZONE $3) AS d,
            COUNT(*)::int AS orders,
            COUNT(*) FILTER (WHERE "paymentStatus" IN ('PAID','PARTIALLY_REFUNDED'))::int AS paid,
            COALESCE(SUM(total) FILTER (WHERE "paymentStatus" IN ('PAID','PARTIALLY_REFUNDED')),0)::float AS gross,
            COALESCE(SUM("refundedTotal") FILTER (WHERE "paymentStatus" IN ('PAID','PARTIALLY_REFUNDED')),0)::float AS refunds,
            COUNT(*) FILTER (WHERE status = 'CANCELLED')::int AS cancelled
     FROM "Order" WHERE "orderDate" >= $1 AND "orderDate" < $2 GROUP BY 1 ORDER BY 1`,
    from,
    to,
    BUSINESS_TZ,
  );
  return {
    title,
    columns: [
      { key: "period", header: unit === "day" ? "Date" : "Month" },
      { key: "orders", header: "Orders", type: "number" },
      { key: "paid", header: "Paid orders", type: "number" },
      { key: "cancelled", header: "Cancelled", type: "number" },
      { key: "gross", header: "Gross paid sales", type: "money" },
      { key: "refunds", header: "Refunds", type: "money" },
      { key: "net", header: "Net sales", type: "money" },
    ],
    rows: rows.map((r) => {
      const d = new Date(r.d);
      return {
        period: unit === "day" ? dayKey(d) : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
        orders: r.orders,
        paid: r.paid,
        cancelled: r.cancelled,
        gross: Math.round(r.gross * 100) / 100,
        refunds: Math.round(r.refunds * 100) / 100,
        net: Math.round((r.gross - r.refunds) * 100) / 100,
      };
    }),
  };
}

export function listReports(user: SessionUser) {
  return DEFS.filter((d) => can(user.role, d.permission)).map(({ key, title, description, dateRange, defaultDays }) => ({ key, title, description, dateRange, defaultDays: defaultDays ?? null }));
}

export async function runReport(key: string, params: ReportParams, user: SessionUser): Promise<ReportResult> {
  const def = DEFS.find((d) => d.key === key);
  if (!def) throw new AppError("Unknown report", 404, "NOT_FOUND");
  if (!can(user.role, def.permission)) throw forbidden();
  const to = params.to ? addDays(startOfDay(params.to), 1) : addDays(startOfDay(), 1);
  const from = params.from ? startOfDay(params.from) : addDays(to, -(def.defaultDays ?? 30));
  if (from >= to) throw new AppError("Start date must be before end date", 400, "BAD_RANGE");
  return def.run({ ...params, from, to }, user);
}

// ───────────────────────────── Export formats ─────────────────────────────

/** Neutralise spreadsheet formula injection (=, +, -, @, tab, CR at the start of a cell). */
export function safeCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s) ? `'${s}` : s;
}

export function toCsv(report: ReportResult): string {
  const esc = (v: unknown) => {
    const s = safeCell(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [report.columns.map((c) => esc(c.header)).join(",")];
  for (const r of report.rows) lines.push(report.columns.map((c) => esc(r[c.key])).join(","));
  return "﻿" + lines.join("\r\n") + "\r\n";
}

export async function toXlsx(report: ReportResult, meta: { generatedBy: string; isDemo?: boolean }): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Luxe CRM";
  wb.created = new Date();
  const ws = wb.addWorksheet(report.title.slice(0, 31));
  ws.columns = report.columns.map((c) => ({ header: c.header, key: c.key, width: c.width ?? Math.max(12, c.header.length + 2) }));
  for (const r of report.rows) {
    const row: Record<string, unknown> = {};
    for (const c of report.columns) {
      const v = r[c.key];
      row[c.key] = typeof v === "string" ? safeCell(v) : v;
    }
    ws.addRow(row);
  }
  const header = ws.getRow(1);
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2E1065" } };
  ws.views = [{ state: "frozen", ySplit: 1 }];
  report.columns.forEach((c, i) => {
    if (c.type === "money") ws.getColumn(i + 1).numFmt = "#,##0.00";
    if (c.type === "number") ws.getColumn(i + 1).numFmt = "#,##0";
  });
  const info = wb.addWorksheet("About");
  info.addRows([
    ["Report", report.title],
    ["Generated", new Date().toISOString()],
    ["Generated by", meta.generatedBy],
    ["Rows", report.rows.length],
    ...(meta.isDemo ? [["WARNING", "Contains DEMO data — not real business data"]] : []),
  ]);
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf as ArrayBuffer);
}
