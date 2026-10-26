/** Normalised shapes produced by source adapters and consumed by the sync service. */

export interface NormalizedVariant {
  externalId: string;
  sku: string | null;
  name: string;
  attributes: Record<string, string>;
  price: number | null;
  stockQuantity: number | null;
  stockStatus: string | null;
}

export interface NormalizedProduct {
  externalId: string;
  name: string;
  sku: string | null;
  slug: string | null;
  type: string;
  status: string;
  imageUrl: string | null;
  permalink: string | null;
  categories: string[];
  price: number | null;
  regularPrice: number | null;
  salePrice: number | null;
  manageStock: boolean;
  stockQuantity: number | null;
  stockStatus: string | null;
  lowStockAmount: number | null;
  createdAt: Date | null;
  updatedAt: Date | null;
  hasVariations: boolean;
}

export interface NormalizedOrderLine {
  externalId: string;
  productExternalId: string | null;
  variationExternalId: string | null;
  name: string;
  sku: string | null;
  quantity: number;
  unitPrice: number;
  total: number;
}

export interface NormalizedOrder {
  externalId: string;
  number: string;
  wcStatus: string;
  currency: string;
  customerName: string;
  customerEmail: string | null;
  customerPhone: string | null;
  billingAddress: Record<string, string> | null;
  shippingAddress: Record<string, string> | null;
  shippingMethod: string | null;
  paymentMethod: string | null;
  subtotal: number;
  shippingTotal: number;
  taxTotal: number;
  discountTotal: number;
  total: number;
  refundedTotal: number;
  customerNote: string | null;
  orderDate: Date;
  paidAt: Date | null;
  completedAt: Date | null;
  updatedAt: Date | null;
  lines: NormalizedOrderLine[];
}

export interface Page<T> {
  items: T[];
  page: number;
  totalPages: number;
  total: number | null;
}

export interface TestStep {
  name: string;
  ok: boolean;
  message: string;
}

export interface TestResult {
  ok: boolean;
  wooCommerceDetected: boolean;
  siteName: string | null;
  namespaces: string[];
  versionInfo: string | null;
  steps: TestStep[];
  /** Adapter-specific settings discovered during the test (e.g. which auth method works). */
  discovered?: Record<string, unknown>;
  counts?: { products?: number | null; orders?: number | null };
}

export interface SourceAdapter {
  readonly kind: "WOOCOMMERCE" | "WP_POST_TYPE";
  readonly supportsOrders: boolean;
  readonly supportsWebhooks: boolean;
  test(): Promise<TestResult>;
  listProducts(page: number, perPage: number, modifiedAfter?: Date | null): Promise<Page<NormalizedProduct>>;
  listVariations(productExternalId: string, parentName?: string): Promise<NormalizedVariant[]>;
  listOrders(page: number, perPage: number, modifiedAfter?: Date | null): Promise<Page<NormalizedOrder>>;
  getOrder?(externalId: string): Promise<NormalizedOrder | null>;
  registerWebhooks?(deliveryUrl: string, secret: string): Promise<{ topic: string; ok: boolean; message: string }[]>;
}
