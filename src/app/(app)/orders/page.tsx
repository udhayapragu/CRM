import Link from "next/link";
import { AlertTriangle, ShoppingBag } from "lucide-react";
import type { OrderStatus } from "@prisma/client";
import { requirePageUser } from "@/lib/auth/session";
import { formatDate, formatMoney } from "@/lib/utils";
import { hrefWith, str, type SP } from "@/lib/url";
import { Card, PageHeader } from "@/components/ui/card";
import { SourceBadge } from "@/components/ui/badge";
import { OrderStatusBadge, PaymentBadge, ShippingBadge } from "@/components/ui/status";
import { EmptyState, TabLinks } from "@/components/ui/misc";
import { DateRange, FilterBar, FilterSelect, SearchBox } from "@/components/ui/table-tools";
import { Pagination, SortHeader } from "@/components/ui/table-server";
import { ORDER_STATUS_LABELS } from "@/server/services/orders";
import { listOrders } from "@/server/services/queries";

export const metadata = { title: "Orders" };

const TABS: (OrderStatus | "ATTENTION" | "DELAYED" | "")[] = ["", "NEW", "PENDING_PAYMENT", "CONFIRMED", "PROCESSING", "READY_TO_PACK", "READY_TO_DISPATCH", "DISPATCHED", "DELIVERED", "ON_HOLD", "CANCELLED", "RETURNED", "ATTENTION", "DELAYED"];

export default async function OrdersPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requirePageUser("orders:view");
  const sp = await searchParams;
  const status = (str(sp, "status") ?? "") as (typeof TABS)[number];
  const data = await listOrders({ q: str(sp, "q"), status, payment: str(sp, "payment"), from: str(sp, "from"), to: str(sp, "to"), sort: str(sp, "sort") as never, dir: str(sp, "dir") as never, page: Number(str(sp, "page")) || 1 }, user.role);
  const path = "/orders";
  const all = Object.entries(data.counts).filter(([k]) => k !== "ATTENTION" && k !== "DELAYED").reduce((s, [, v]) => s + v, 0);
  return (
    <>
      <PageHeader eyebrow="Commerce" title="Orders" subtitle="All orders from your website and CRM. Order, payment and shipping statuses are tracked separately." />
      <TabLinks
        active={status || "all"}
        tabs={TABS.map((t) => ({
          key: t || "all",
          label: t === "" ? "All" : t === "ATTENTION" ? "⚠ Needs attention" : t === "DELAYED" ? "Delayed" : t === "NEW" ? "New orders" : ORDER_STATUS_LABELS[t as OrderStatus],
          count: t === "" ? all : data.counts[t] ?? 0,
          href: hrefWith(path, sp, { status: t || undefined, page: undefined }),
        }))}
      />
      <FilterBar>
        <SearchBox placeholder="Order #, customer, SKU, tracking…" />
        <FilterSelect param="payment" placeholder="Any payment status" options={["UNPAID", "PENDING", "PAID", "FAILED", "PARTIALLY_REFUNDED", "REFUNDED"].map((p) => ({ value: p, label: p.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase()) }))} />
        <DateRange />
      </FilterBar>
      <Card className="overflow-hidden">
        {data.rows.length === 0 ? (
          <EmptyState icon={<ShoppingBag className="h-5 w-5" />} title="No orders found" message={all === 0 ? "Orders appear here once WordPress is connected and synchronised (or demo data is loaded)." : "Try a different filter."} />
        ) : (
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <SortHeader label="Order" field="number" sp={sp} path={path} />
                  <SortHeader label="Date" field="orderDate" sp={sp} path={path} />
                  <th>Customer</th>
                  <th>Items</th>
                  <SortHeader label="Amount" field="total" sp={sp} path={path} className="text-right" />
                  <th>Status</th>
                  <th>Payment</th>
                  <th>Shipping</th>
                  <SortHeader label="Dispatch by" field="expectedDispatchDate" sp={sp} path={path} defaultDir="asc" />
                  <th>Tracking</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((o) => {
                  const late = o.expectedDispatchDate && o.expectedDispatchDate < new Date() && ["NEW", "CONFIRMED", "PROCESSING", "READY_TO_PACK", "READY_TO_DISPATCH"].includes(o.status);
                  return (
                    <tr key={o.id}>
                      <td className="whitespace-nowrap">
                        <Link href={`/orders/${o.id}`} className="font-semibold hover:text-brand-strong">#{o.number}</Link>
                        <div className="mt-0.5 flex items-center gap-1"><SourceBadge source={o.source} isDemo={o.isDemo} />{o.needsAttention && <span title={o.attentionReason ?? ""}><AlertTriangle className="h-3.5 w-3.5 text-danger" /></span>}</div>
                      </td>
                      <td className="whitespace-nowrap text-xs text-muted">{formatDate(o.orderDate, true)}</td>
                      <td className="min-w-[160px]"><div className="text-sm">{o.customerName}</div><div className="text-[11px] text-subtle">{o.customerPhone ?? o.customerEmail ?? ""}</div></td>
                      <td className="min-w-[200px] text-xs text-muted">{o.items.slice(0, 2).map((i) => `${i.quantity}× ${i.name}`).join(", ")}{o.items.length > 2 && ` +${o.items.length - 2} more`}</td>
                      <td className="whitespace-nowrap text-right font-medium tabular-nums">{formatMoney(o.total, o.currency)}</td>
                      <td><OrderStatusBadge status={o.status} /></td>
                      <td><PaymentBadge status={o.paymentStatus} /></td>
                      <td><ShippingBadge status={o.shippingStatus} /></td>
                      <td className={`whitespace-nowrap text-xs ${late ? "font-semibold text-danger" : "text-muted"}`}>{formatDate(o.expectedDispatchDate)}{late && " · late"}</td>
                      <td className="whitespace-nowrap font-mono text-[11px] text-muted">{o.shipments[0]?.trackingNumber ?? "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <Pagination page={data.page} pageSize={data.pageSize} total={data.total} sp={sp} path={path} />
      </Card>
    </>
  );
}
