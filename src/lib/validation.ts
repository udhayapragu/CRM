import { z } from "zod";

const trimmed = (max = 200) => z.string().trim().max(max);
const optText = (max = 1000) => z.string().trim().max(max).optional().nullable().transform((v) => (v ? v : null));
const int = z.coerce.number().int();
const isoDate = z.coerce.date();

export const ROLES = ["SUPER_ADMIN", "INVENTORY_MANAGER", "ORDER_MANAGER", "DISPATCH_MANAGER", "ONBOARDING_MANAGER", "ACCOUNTANT", "VIEWER"] as const;
export const ORDER_STATUSES = ["NEW", "PENDING_PAYMENT", "CONFIRMED", "PROCESSING", "READY_TO_PACK", "READY_TO_DISPATCH", "DISPATCHED", "DELIVERED", "ON_HOLD", "CANCELLED", "RETURNED"] as const;
export const PAYMENT_STATUSES = ["UNPAID", "PENDING", "PAID", "FAILED", "PARTIALLY_REFUNDED", "REFUNDED"] as const;
export const CATEGORIES = ["PRODUCT", "BOTTLE", "LABEL", "CAP", "BOX", "PACKAGING", "RAW_MATERIAL", "OTHER"] as const;

export const loginSchema = z.object({ email: z.string().trim().email().max(200), password: z.string().min(1).max(200) });

export const setupSchema = z.object({
  name: trimmed(100).min(2),
  email: z.string().trim().email().max(200),
  password: z.string().min(10).max(200),
  setupToken: z.string().max(500).optional(),
});

export const passwordChangeSchema = z.object({ current: z.string().min(1).max(200), next: z.string().min(10).max(200) });

export const userCreateSchema = z.object({
  name: trimmed(100).min(2),
  email: z.string().trim().email().max(200),
  role: z.enum(ROLES),
  password: z.string().min(10).max(200),
});

export const userUpdateSchema = z.object({
  name: trimmed(100).min(2).optional(),
  role: z.enum(ROLES).optional(),
  active: z.boolean().optional(),
  password: z.string().min(10).max(200).optional(),
});

export const connectionSchema = z.object({
  name: trimmed(100).optional(),
  siteUrl: z.string().trim().min(4).max(300),
  adapter: z.enum(["WOOCOMMERCE", "WP_POST_TYPE"]),
  consumerKey: z.string().trim().max(200).optional(),
  consumerSecret: z.string().trim().max(200).optional(),
  wpUsername: z.string().trim().max(100).optional(),
  appPassword: z.string().trim().max(200).optional(),
  syncIntervalMinutes: int.min(5).max(1440).optional(),
  perPage: int.min(10).max(100).optional(),
  postType: z.string().trim().regex(/^[a-z0-9_-]{1,40}$/i).optional(),
  skuMetaKey: z.string().trim().max(100).optional(),
  priceMetaKey: z.string().trim().max(100).optional(),
  stockMetaKey: z.string().trim().max(100).optional(),
});

export const syncSchema = z.object({ type: z.enum(["PRODUCTS", "ORDERS", "FULL"]).default("FULL"), fullResync: z.boolean().default(false) });

export const itemCreateSchema = z.object({
  name: trimmed(200).min(2),
  sku: z.string().trim().min(2).max(60).regex(/^[A-Za-z0-9._\-/]+$/, "SKU may contain letters, numbers, . _ - /"),
  category: z.enum(CATEGORIES),
  customCategory: optText(60),
  unit: trimmed(20).optional(),
  reorderLevel: int.min(0).max(10_000_000).optional(),
  supplierId: z.string().max(40).optional().nullable(),
  productId: z.string().max(40).optional().nullable(),
  variantId: z.string().max(40).optional().nullable(),
  notes: optText(1000),
  openingStock: int.min(0).max(100_000_000).optional(),
});

export const itemUpdateSchema = z.object({
  name: trimmed(200).min(2).optional(),
  reorderLevel: int.min(0).max(10_000_000).optional(),
  supplierId: z.string().max(40).optional().nullable(),
  unit: trimmed(20).optional(),
  notes: optText(1000),
  customCategory: optText(60),
  active: z.boolean().optional(),
});

export const movementSchema = z.object({
  itemId: z.string().min(1).max(40),
  kind: z.enum(["STOCK_IN", "STOCK_OUT", "ADJUSTMENT", "DAMAGE", "RETURN"]),
  quantity: int.refine((n) => n !== 0, "Quantity cannot be zero").refine((n) => Math.abs(n) <= 100_000_000, "Quantity too large"),
  reason: trimmed(500).min(3, "Please give a reason (at least 3 characters)"),
  locationId: z.string().max(40).optional(),
  reference: trimmed(100).optional(),
});

export const transferSchema = z.object({
  itemId: z.string().min(1).max(40),
  fromLocationId: z.string().min(1).max(40),
  toLocationId: z.string().min(1).max(40),
  quantity: int.min(1).max(100_000_000),
  reason: trimmed(500).min(3),
});

export const receiptSchema = z.object({
  supplierId: z.string().max(40).optional().nullable(),
  invoiceRef: trimmed(100).optional(),
  receivedAt: isoDate.optional(),
  notes: trimmed(1000).optional(),
  locationId: z.string().max(40).optional(),
  lines: z.array(z.object({ itemId: z.string().min(1).max(40), quantity: int.min(1).max(100_000_000), unitCost: z.coerce.number().min(0).max(10_000_000).optional().nullable() })).min(1).max(200),
});

export const ruleSchema = z.object({
  productId: z.string().min(1).max(40),
  materialId: z.string().min(1).max(40),
  quantityPerUnit: int.min(1).max(10_000),
  active: z.boolean().optional(),
  notes: optText(300),
});

export const supplierSchema = z.object({
  name: trimmed(200).min(2),
  contactName: optText(100),
  email: z.string().trim().email().max(200).optional().nullable().or(z.literal("").transform(() => null)),
  phone: optText(40),
  address: optText(500),
  gstOrTaxId: optText(40),
  notes: optText(1000),
  active: z.boolean().optional(),
});

export const locationSchema = z.object({ code: z.string().trim().min(2).max(12).regex(/^[A-Za-z0-9_-]+$/), name: trimmed(100).min(2) });

export const trackProductSchema = z.object({
  variantId: z.string().max(40).optional().nullable(),
  openingStock: int.min(0).max(100_000_000).optional(),
  sku: z.string().trim().max(60).optional(),
  reorderLevel: int.min(0).optional(),
});

export const orderStatusSchema = z.object({ status: z.enum(ORDER_STATUSES), note: trimmed(500).optional() });
export const paymentStatusSchema = z.object({ paymentStatus: z.enum(PAYMENT_STATUSES), note: trimmed(500).optional() });
export const orderPatchSchema = z.object({ expectedDispatchDate: isoDate.nullable().optional(), internalNotes: optText(5000) });
export const noteSchema = z.object({ note: trimmed(2000).min(1) });

export const packSchema = z.object({
  lines: z.array(z.object({ orderItemId: z.string().min(1).max(40), quantity: int.min(0).max(100_000) })).min(1).max(200),
  notes: trimmed(1000).optional(),
});

export const dispatchSchema = z.object({
  courier: trimmed(100).min(2),
  trackingNumber: trimmed(100).optional(),
  trackingUrl: z.string().trim().url().max(500).optional().or(z.literal("").transform(() => undefined)),
  dispatchedAt: isoDate.optional(),
  expectedDeliveryAt: isoDate.optional().nullable(),
  notes: trimmed(1000).optional(),
  awaitingPickup: z.boolean().optional(),
});

export const deliverSchema = z.object({ deliveredAt: isoDate.optional(), note: trimmed(500).optional() });

export const returnSchema = z.object({
  reason: trimmed(500).min(3),
  lines: z.array(z.object({ orderItemId: z.string().min(1).max(40), quantity: int.min(0).max(100_000), condition: z.enum(["RESTOCK", "DAMAGED"]) })).min(1).max(200),
});

export const onboardingSchema = z.object({
  title: trimmed(200).min(2),
  sku: optText(60),
  category: optText(60),
  description: optText(5000),
  stageId: z.string().max(40).optional(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).optional(),
  ownerId: z.string().max(40).optional().nullable(),
  dueDate: isoDate.optional().nullable(),
  productId: z.string().max(40).optional().nullable(),
  holdReason: optText(500),
});

export const taskSchema = z.object({ title: trimmed(300).min(2), assigneeId: z.string().max(40).optional().nullable(), dueDate: isoDate.optional().nullable() });
export const taskUpdateSchema = z.object({ done: z.boolean().optional(), title: trimmed(300).min(2).optional(), assigneeId: z.string().max(40).optional().nullable(), dueDate: isoDate.optional().nullable() });
export const commentSchema = z.object({ body: trimmed(5000).min(1) });
export const stageSchema = z.object({ name: trimmed(80).min(2), color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(), position: int.min(0).max(1000).optional() });

export const settingsSchema = z.object({
  dispatchSlaDays: int.min(0).max(60).optional(),
  defaultLowStockThreshold: int.min(0).max(100000).optional(),
  mlmEnabled: z.boolean().optional(),
  mlmCommissionTrigger: z.enum(["DELIVERED", "PAID"]).optional(),
  currency: z.string().trim().length(3).toUpperCase().optional(),
  businessName: trimmed(100).min(1).optional(),
});

export const memberSchema = z.object({
  name: trimmed(150).min(2),
  email: z.string().trim().email().max(200).optional().nullable().or(z.literal("").transform(() => null)),
  phone: optText(40),
  sponsorCode: z.string().trim().max(20).optional().nullable(),
  notes: optText(1000),
});
export const memberUpdateSchema = z.object({
  name: trimmed(150).min(2).optional(),
  email: z.string().trim().email().max(200).optional().nullable().or(z.literal("").transform(() => null)),
  phone: optText(40),
  status: z.enum(["PENDING", "ACTIVE", "INACTIVE", "SUSPENDED"]).optional(),
  notes: optText(1000),
});
export const commissionRuleSchema = z.object({
  name: trimmed(120).min(2),
  level: int.min(1).max(10),
  ratePercent: z.coerce.number().min(0).max(50),
  active: z.boolean().optional(),
  legallyReviewed: z.boolean().optional(),
  reviewedBy: optText(120),
  notes: optText(2000),
});
export const commissionActionSchema = z.object({ ids: z.array(z.string().max(40)).min(1).max(500), to: z.enum(["APPROVED", "VOID"]) });
export const payoutSchema = z.object({ memberId: z.string().min(1).max(40), reference: trimmed(120).optional() });
export const attributeSchema = z.object({ memberId: z.string().max(40).nullable() });

export const reportQuerySchema = z.object({
  format: z.enum(["json", "csv", "xlsx"]).default("json"),
  from: isoDate.optional(),
  to: isoDate.optional(),
  q: z.string().trim().max(100).optional(),
});
