import type { Tx } from "@/lib/db";
import { recalculateOrderCommissions } from "./mlm";

/**
 * Called by fulfilment / sync code whenever an order's delivery, payment, return or cancellation state
 * changes. Keeps the optional MLM module decoupled: it is a no-op unless the module is enabled and
 * the order is attributed to a member.
 */
export async function onOrderFulfilmentChanged(tx: Tx, orderId: string) {
  await recalculateOrderCommissions(tx, orderId);
}
