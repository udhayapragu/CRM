import Link from "next/link";
import { Download, Truck } from "lucide-react";
import { requirePageUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { formatDate } from "@/lib/utils";
import { hrefWith, str, type SP } from "@/lib/url";
import { Card, PageHeader } from "@/components/ui/card";
import { Badge, DemoBadge } from "@/components/ui/badge";
import { OrderStatusBadge } from "@/components/ui/status";
import { EmptyState, TabLinks } from "@/components/ui/misc";
import { DateRange, FilterBar, SearchBox } from "@/components/ui/table-tools";
import { Pagination } from "@/components/ui/table-server";
import { CancelShipmentButton, DeliverButton, DispatchButton, PackButton, PickupButton } from "@/components/orders/fulfilment-actions";
import { dispatchBoard, type DispatchView } from "@/server/services/queries";

export const metadata = { title: "Dispatch" };

const VIEWS: { key: DispatchView; label: string }[] = [
  { key: "to-pack", label: "Awaiting packing" },
  { key: "ready", label: "Ready for dispatch" },
  { key: "awaiting-pickup", label: "Awaiting pickup" },
  { key: "in-transit", label: "In transit" },
  { key: "dispatched-today", label: "Dispatched today" },
  { key: "delivered", label: "Delivered" },
  { key: "delayed", label: "Delayed" },
];

export default async function DispatchPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requirePageUser("dispatch:view");
  const sp = await searchParams;
  const view = (VIEWS.find((v) => v.key === str(sp, "view"))?.key ?? "to-pack") as DispatchView;
  const data = await dispatchBoard(view, { q: str(sp, "q"), from: str(sp, "from"), to: str(sp, "to"), page: Number(str(sp, "page")) || 1 }, user.role);
  const manage = can(user.role, "dispatch:manage");
  const path = "/dispatch";
  const today = new Date().toISOString().slice(0, 10);
  const exportFrom = str(sp, "from") ?? today;
  const exportTo = str(sp, "to") ?? today;
  return (
    <>
      <PageHeader
        eyebrow="Fulfilment"
        title="Dispatch"
        subtitle="Pack, dispatch and confirm delivery. Stock leaves the ledger once — at dispatch."
        actions={can(user.role, "reports:export") && (
          <>
            <a href={`/api/reports/dispatched?format=xlsx&from=${exportFrom}&to=${exportTo}`} className="inline-flex h-10 items-center gap-2 rounded-xl border border-line px-4 text-sm hover:bg-surface-2"><Download className="h-4 w-4" /> Dispatch report (Excel)</a>
            <a href={`/api/reports/dispatched?format=csv&from=${exportFrom}&to=${exportTo}`} className="inline-flex h-10 items-center gap-2 rounded-xl border border-line px-4 text-sm hover:bg-surface-2">CSV</a>
          </>
        )}
      />
      <TabLinks active={view} tabs={VIEWS.map((v) => ({ key: v.key, label: v.label, count: data.counts[v.key], href: hrefWith(path, {}, { view: v.key }) }))} />
      <FilterBar>
        <SearchBox placeholder="Order #, customer, tracking…" />
        {(view === "dispatched-today" || view === "delivered") && <DateRange />}
      </FilterBar>

      {data.kind === "orders" && (
        <Card className="overflow-hidden">
          {data.rows.length === 0 ? <EmptyState icon={<Truck className="h-5 w-5" />} title="Nothing to pack" message="Confirmed and processing orders appear here." /> : (
            <div className="overflow-x-auto">
              <table className="table-base">
                <thead><tr><th>Order</th><th>Customer</th><th>Items to pack</th><th>Status</th><th>Dispatch by</th><th className="text-right">Action</th></tr></thead>
                <tbody>
                  {data.rows.map((o) => {
                    const late = o.expectedDispatchDate && o.expectedDispatchDate < new Date();
                    return (
                      <tr key={o.id}>
                        <td><Link href={`/orders/${o.id}`} className="font-semibold hover:text-brand-strong">#{o.number}</Link> {o.isDemo && <DemoBadge />}</td>
                        <td className="text-sm">{o.customerName}<div className="text-[11px] text-subtle">{(o.shippingAddress as Record<string, string> | null)?.city ?? ""}</div></td>
                        <td className="min-w-[240px] text-xs">{o.items.map((i) => <div key={i.id}>{i.quantity - i.packedQty} of {i.quantity} × {i.name}</div>)}</td>
                        <td><OrderStatusBadge status={o.status} /></td>
                        <td className={`text-xs ${late ? "font-semibold text-danger" : "text-muted"}`}>{formatDate(o.expectedDispatchDate)}{late && " · late"}</td>
                        <td className="text-right">{manage && <PackButton size="sm" orderId={o.id} lines={o.items.map((i) => ({ id: i.id, name: i.name, sku: i.sku, quantity: i.quantity, packedQty: i.packedQty, dispatchedQty: i.dispatchedQty, returnedQty: i.returnedQty }))} />}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <Pagination page={data.page} pageSize={data.pageSize} total={data.total} sp={sp} path={path} />
        </Card>
      )}

      {data.kind === "shipments" && (
        <Card className="overflow-hidden">
          {data.rows.length === 0 ? <EmptyState icon={<Truck className="h-5 w-5" />} title="No shipments here" /> : (
            <div className="overflow-x-auto">
              <table className="table-base">
                <thead><tr><th>Order</th><th>Customer</th><th>Contents</th><th>Courier</th><th>Tracking</th><th>Packed</th><th>Dispatched</th><th>ETA / Delivered</th><th className="text-right">Actions</th></tr></thead>
                <tbody>
                  {data.rows.map((s) => (
                    <tr key={s.id}>
                      <td><Link href={`/orders/${s.order.id}`} className="font-semibold hover:text-brand-strong">#{s.order.number}</Link> {s.isDemo && <DemoBadge />}</td>
                      <td className="text-sm">{s.order.customerName}</td>
                      <td className="min-w-[200px] text-xs">{s.lines.map((l) => `${l.quantity}× ${l.orderItem.name}`).join(", ")}</td>
                      <td className="text-sm">{s.courier ?? "—"}</td>
                      <td className="font-mono text-[11px] text-muted">{s.trackingNumber ?? "—"}</td>
                      <td className="whitespace-nowrap text-xs text-muted">{formatDate(s.packedAt, true)}</td>
                      <td className="whitespace-nowrap text-xs text-muted">{formatDate(s.dispatchedAt, true)}</td>
                      <td className="whitespace-nowrap text-xs text-muted">{s.deliveredAt ? <Badge tone="success">{formatDate(s.deliveredAt)}</Badge> : formatDate(s.expectedDeliveryAt)}</td>
                      <td className="text-right">
                        {manage && (
                          <div className="flex justify-end gap-2">
                            {s.status === "PACKED" && <><CancelShipmentButton size="sm" shipmentId={s.id} /><DispatchButton size="sm" shipmentId={s.id} /></>}
                            {s.status === "AWAITING_PICKUP" && <PickupButton size="sm" shipmentId={s.id} />}
                            {(s.status === "IN_TRANSIT" || s.status === "AWAITING_PICKUP") && <DeliverButton size="sm" shipmentId={s.id} />}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <Pagination page={data.page} pageSize={data.pageSize} total={data.total} sp={sp} path={path} />
        </Card>
      )}

      {data.kind === "delayed" && (
        <div className="grid gap-4 xl:grid-cols-2">
          <Card>
            <div className="border-b border-line/40 px-5 py-3 text-sm font-semibold">Not dispatched by expected date ({data.orders.length})</div>
            {data.orders.length === 0 ? <p className="p-5 text-sm text-muted">None — great work.</p> : (
              <ul className="divide-y divide-line/30">{data.orders.map((o) => (
                <li key={o.id} className="flex items-center justify-between px-5 py-3 text-sm"><Link href={`/orders/${o.id}`} className="hover:text-brand-strong">#{o.number} · {o.customerName}</Link><span className="text-xs text-danger">due {formatDate(o.expectedDispatchDate)}</span></li>
              ))}</ul>
            )}
          </Card>
          <Card>
            <div className="border-b border-line/40 px-5 py-3 text-sm font-semibold">In transit past expected delivery ({data.shipments.length})</div>
            {data.shipments.length === 0 ? <p className="p-5 text-sm text-muted">None.</p> : (
              <ul className="divide-y divide-line/30">{data.shipments.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm"><Link href={`/orders/${s.order.id}`} className="hover:text-brand-strong">#{s.order.number} · {s.courier} {s.trackingNumber}</Link><span className="flex items-center gap-2 text-xs text-danger">ETA {formatDate(s.expectedDeliveryAt)} {manage && <DeliverButton size="sm" shipmentId={s.id} />}</span></li>
              ))}</ul>
            )}
          </Card>
        </div>
      )}
    </>
  );
}
