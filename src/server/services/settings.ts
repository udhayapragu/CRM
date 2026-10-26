import { prisma, type Tx } from "@/lib/db";

export interface AppSettings {
  dispatchSlaDays: number;
  defaultLowStockThreshold: number;
  mlmEnabled: boolean;
  mlmCommissionTrigger: "DELIVERED" | "PAID";
  currency: string;
  businessName: string;
}

export const DEFAULT_SETTINGS: AppSettings = {
  dispatchSlaDays: 2,
  defaultLowStockThreshold: 10,
  mlmEnabled: false,
  mlmCommissionTrigger: "DELIVERED",
  currency: "INR",
  businessName: "Luxe CRM",
};

export async function getSettings(tx: Tx = prisma): Promise<AppSettings> {
  const rows = await tx.appSetting.findMany({ where: { key: { in: Object.keys(DEFAULT_SETTINGS) } } });
  const out: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  for (const r of rows) out[r.key] = r.value;
  return out as unknown as AppSettings;
}

export async function updateSettings(patch: Partial<AppSettings>, tx: Tx = prisma) {
  for (const [key, value] of Object.entries(patch)) {
    if (!(key in DEFAULT_SETTINGS) || value === undefined) continue;
    await tx.appSetting.upsert({ where: { key }, create: { key, value: value as never }, update: { value: value as never } });
  }
  return getSettings(tx);
}

/** True when any demo records exist in the database. */
export async function hasDemoData(tx: Tx = prisma) {
  const [p, o, i] = await Promise.all([
    tx.product.count({ where: { isDemo: true }, take: 1 }),
    tx.order.count({ where: { isDemo: true }, take: 1 }),
    tx.inventoryItem.count({ where: { isDemo: true }, take: 1 }),
  ]);
  return p + o + i > 0;
}
