import type { OrderStatus, PaymentStatus, ShippingStatus } from "@prisma/client";
import { Badge, type Tone } from "./badge";
import { humanize } from "@/lib/utils";

const ORDER: Record<OrderStatus, Tone> = {
  NEW: "brand",
  PENDING_PAYMENT: "warning",
  CONFIRMED: "info",
  PROCESSING: "info",
  READY_TO_PACK: "brand",
  READY_TO_DISPATCH: "gold",
  DISPATCHED: "gold",
  DELIVERED: "success",
  ON_HOLD: "warning",
  CANCELLED: "danger",
  RETURNED: "danger",
};
const PAYMENT: Record<PaymentStatus, Tone> = { UNPAID: "neutral", PENDING: "warning", PAID: "success", FAILED: "danger", PARTIALLY_REFUNDED: "warning", REFUNDED: "danger" };
const SHIPPING: Record<ShippingStatus, Tone> = { NOT_SHIPPED: "neutral", PACKED: "brand", AWAITING_PICKUP: "gold", IN_TRANSIT: "info", DELIVERED: "success", RETURNED: "danger" };

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  return <Badge tone={ORDER[status]} dot>{humanize(status)}</Badge>;
}
export function PaymentBadge({ status }: { status: PaymentStatus }) {
  return <Badge tone={PAYMENT[status]}>{humanize(status)}</Badge>;
}
export function ShippingBadge({ status }: { status: ShippingStatus }) {
  return <Badge tone={SHIPPING[status]}>{humanize(status)}</Badge>;
}
export function StockBadge({ state, source }: { state: "in" | "low" | "out" | "unknown"; source?: "PHYSICAL" | "WEBSITE" }) {
  const map = { in: ["success", "In stock"], low: ["warning", "Low stock"], out: ["danger", "Out of stock"], unknown: ["neutral", "Not tracked"] } as const;
  const [tone, label] = map[state];
  return (
    <span className="inline-flex items-center gap-1">
      <Badge tone={tone} dot>{label}</Badge>
      {source === "WEBSITE" && state !== "unknown" && <span className="text-[10px] uppercase tracking-wide text-subtle" title="Based on website stock — physical stock not tracked">web</span>}
    </span>
  );
}
