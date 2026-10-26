import Link from "next/link";
import { AlertTriangle, Check, Circle, ExternalLink, Package, Truck } from "lucide-react";
import type { OrderStatus } from "@prisma/client";
import { requirePageUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { prisma } from "@/lib/db";
import { orNotFound } from "@/lib/page-helpers";
import { cn, formatDate, formatMoney, humanize } from "@/lib/utils";
import { Card, CardHeader, PageHeader } from "@/components/ui/card";
import { Badge, SourceBadge } from "@/components/ui/badge";
import { OrderStatusBadge, PaymentBadge, ShippingBadge } from "@/components/ui/status";
import { KeyValue } from "@/components/ui/misc";
import { CancelShipmentButton, DeliverButton, DispatchButton, PackButton, PickupButton, ReturnButton } from "@/components/orders/fulfilment-actions";
import { AttributeMemberButton, DetailsEditor, NoteForm, PaymentChangeButton, ResolveAttentionButton, StatusChangeButton } from "@/components/orders/order-actions";
import { MANUAL_TRANSITIONS } from "@/server/services/orders";
import { getOrderDetail } from "@/server/services/queries";
import { getSettings } from "@/server/services/settings";

const STEPS: { key: string; label: string; reached: (s: OrderStatus, ship: string) => boolean }[] = [
  { key: "placed", label: "Placed", reached: () => true },
  { key: "confirmed", label: "Confirmed", reached: (s) => !["NEW", "PENDING_PAYMENT"].includes(s) && s !== "CANCELLED" },
  { key: "packed", label: "Packed", reached: (s, sh) => ["READY_TO_DISPATCH", "DISPATCHED", "DELIVERED", "RETURNED"].includes(s) || sh !== "NOT_SHIPPED" },
  { key: "dispatched", label: "Dispatched", reached: (s) => ["DISPATCHED", "DELIVERED", "RETURNED"].includes(s) },
  { key: "delivered", label: "Delivered", reached: (s) => ["DELIVERED", "RETURNED"].includes(s) },
];

function addr(a: unknown) {
  const x = a as Record<string, string> | null;
  if (!x) return "—";
  return [[x.first_name, x.last_name].filter(Boolean).join(" "), x.company, x.address_1, x.address_2, [x.city, x.state, x.postcode].filter(Boolean).join(", "), x.country].filter(Boolean).join("\n") || "—";
}

export default async function OrderDetail({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePageUser("orders:view");
  const { id } = await params;
  const o = await orNotFound(getOrderDetail(id, user.role));
  const settings = await getSettings();
  const members = settings.mlmEnabled && can(user.role, "mlm:manage") ? await prisma.member.findMany({ where: { status: "ACTIVE" }, select: { id: true, name: true, referralCode: true }, orderBy: { name: "asc" } }) : [];
  const editOrders = can(user.role, "orders:edit");
  const manageDispatch = can(user.role, "dispatch:manage");
  const lines = o.items.map((i) => ({ id: i.id, name: i.name, sku: i.sku, quantity: i.quantity, packedQty: i.packedQty, dispatchedQty: i.dispatchedQty, returnedQty: i.returnedQty }));
  const cancelled = o.status === "CANCELLED";
  const canPack = manageDispatch && ["CONFIRMED", "PROCESSING", "READY_TO_PACK", "READY_TO_DISPATCH"].includes(o.status);

  return (
    <>
      <PageHeader
        eyebrow={<Link href="/orders" className="hover:underline">Orders</Link>}
        title={<>Order <span className="gold-text">#{o.number}</span></>}
        subtitle={<span className="flex flex-wrap items-center gap-2"><SourceBadge source={o.source} isDemo={o.isDemo} />Placed {formatDate(o.orderDate, true)}{o.wcStatus && <Badge>Website status: {o.wcStatus}</Badge>}</span>}
        actions={
          <>
            {editOrders && <StatusChangeButton orderId={o.id} allowed={MANUAL_TRANSITIONS[o.status]} />}
            {editOrders && <PaymentChangeButton orderId={o.id} current={o.paymentStatus} />}
            {canPack && <PackButton orderId={o.id} lines={lines} />}
            {editOrders && can(user.role, "inventory:adjust") && <ReturnButton orderId={o.id} lines={lines} />}
          </>
        }
      />

      {o.needsAttention && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-2xl border border-danger/40 bg-danger/10 px-4 py-3 text-sm">
          <AlertTriangle className="h-5 w-5 text-danger" />
          <span className="flex-1 text-fg">{o.attentionReason ?? "This order needs attention."}</span>
          {editOrders && <ResolveAttentionButton orderId={o.id} />}
        </div>
      )}

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <div className="card p-4"><div className="text-[11px] uppercase tracking-wider text-subtle">Order status</div><div className="mt-2"><OrderStatusBadge status={o.status} /></div></div>
        <div className="card p-4"><div className="text-[11px] uppercase tracking-wider text-subtle">Payment status</div><div className="mt-2"><PaymentBadge status={o.paymentStatus} /> <span className="ml-2 text-xs text-muted">{o.paymentMethod}</span></div></div>
        <div className="card p-4"><div className="text-[11px] uppercase tracking-wider text-subtle">Shipping status</div><div className="mt-2"><ShippingBadge status={o.shippingStatus} /> <span className="ml-2 text-xs text-muted">{o.shippingMethod}</span></div></div>
      </div>

      <Card className="mb-4">
        <div className="overflow-x-auto px-5 py-6">
          <ol className="flex min-w-[560px] items-center">
            {STEPS.map((s, i) => {
              const reached = !cancelled && s.reached(o.status, o.shippingStatus);
              const next = STEPS[i + 1];
              const nextReached = next && !cancelled && next.reached(o.status, o.shippingStatus);
              return (
                <li key={s.key} className="flex flex-1 items-center last:flex-none">
                  <div className="flex flex-col items-center gap-2">
                    <span className={cn("grid h-9 w-9 place-items-center rounded-full border-2 transition", reached ? "border-gold bg-gold/15 text-gold shadow-gold" : "border-line text-subtle")}>{reached ? <Check className="h-4 w-4" /> : <Circle className="h-3 w-3" />}</span>
                    <span className={cn("text-xs font-medium", reached ? "text-fg" : "text-subtle")}>{s.label}</span>
                  </div>
                  {next && <div className={cn("mx-2 mb-6 h-0.5 flex-1 rounded", nextReached ? "bg-gradient-to-r from-gold to-gold/60" : "bg-line")} />}
                </li>
              );
            })}
          </ol>
          {cancelled && <p className="mt-2 text-center text-sm text-danger">This order was cancelled.</p>}
          {o.status === "RETURNED" && <p className="mt-2 text-center text-sm text-danger">This order was returned.</p>}
        </div>
      </Card>

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <Card>
            <CardHeader title="Items" subtitle="Fulfilment progress per line" />
            <div className="overflow-x-auto p-2">
              <table className="table-base">
                <thead><tr><th>Product</th><th>SKU</th><th className="text-right">Qty</th><th className="text-right">Price</th><th className="text-right">Total</th><th>Packed</th><th>Dispatched</th><th>Returned</th><th>Reserved</th></tr></thead>
                <tbody>
                  {o.items.map((i) => (
                    <tr key={i.id}>
                      <td className="min-w-[200px]">{i.product ? <Link href={`/products/${i.product.id}`} className="font-medium hover:text-brand-strong">{i.name}</Link> : <span className="font-medium">{i.name}</span>}{!i.product && <div className="text-[10px] text-subtle">Product not yet synced / linked</div>}</td>
                      <td className="font-mono text-xs text-muted">{i.sku ?? "—"}</td>
                      <td className="text-right tabular-nums">{i.quantity}</td>
                      <td className="text-right tabular-nums">{formatMoney(i.unitPrice, o.currency)}</td>
                      <td className="text-right tabular-nums">{formatMoney(i.total, o.currency)}</td>
                      <td className="tabular-nums text-xs">{i.packedQty}/{i.quantity}</td>
                      <td className="tabular-nums text-xs">{i.dispatchedQty}/{i.quantity}</td>
                      <td className="tabular-nums text-xs">{i.returnedQty || "—"}</td>
                      <td className="tabular-nums text-xs">{i.reservations.reduce((s, r) => s + r.quantity, 0) || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex justify-end border-t border-line/40 px-5 py-4">
              <dl className="w-full max-w-xs space-y-1 text-sm">
                <div className="flex justify-between text-muted"><dt>Subtotal</dt><dd className="tabular-nums">{formatMoney(o.subtotal, o.currency)}</dd></div>
                {Number(o.discountTotal) > 0 && <div className="flex justify-between text-muted"><dt>Discount</dt><dd className="tabular-nums">−{formatMoney(o.discountTotal, o.currency)}</dd></div>}
                <div className="flex justify-between text-muted"><dt>Shipping</dt><dd className="tabular-nums">{formatMoney(o.shippingTotal, o.currency)}</dd></div>
                <div className="flex justify-between text-muted"><dt>Tax</dt><dd className="tabular-nums">{formatMoney(o.taxTotal, o.currency)}</dd></div>
                {Number(o.refundedTotal) > 0 && <div className="flex justify-between text-danger"><dt>Refunded</dt><dd className="tabular-nums">−{formatMoney(o.refundedTotal, o.currency)}</dd></div>}
                <div className="flex justify-between border-t border-line/50 pt-2 text-base font-semibold"><dt>Total</dt><dd className="tabular-nums gold-text">{formatMoney(o.total, o.currency)}</dd></div>
              </dl>
            </div>
          </Card>

          <Card>
            <CardHeader title="Shipments" subtitle="Packing, dispatch and delivery records" />
            <div className="space-y-3 p-5">
              {o.shipments.length === 0 && <p className="text-sm text-muted">No shipments yet.{canPack ? " Use “Pack” to create one." : ""}</p>}
              {o.shipments.map((s) => (
                <div key={s.id} className={cn("rounded-xl border p-4", s.status === "CANCELLED" ? "border-line/30 opacity-60" : "border-line/60 bg-surface-2/40")}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      {s.dispatchedAt ? <Truck className="h-4 w-4 text-gold" /> : <Package className="h-4 w-4 text-brand-strong" />}
                      <Badge tone={s.status === "DELIVERED" ? "success" : s.status === "CANCELLED" ? "neutral" : s.status === "PACKED" ? "brand" : "gold"}>{humanize(s.status)}</Badge>
                      <span className="text-xs text-muted">{s.lines.map((l) => `${l.quantity}× ${l.orderItem.name}`).join(", ")}</span>
                    </div>
                    {manageDispatch && (
                      <div className="flex flex-wrap gap-2">
                        {s.status === "PACKED" && <><CancelShipmentButton shipmentId={s.id} size="sm" /><DispatchButton shipmentId={s.id} size="sm" /></>}
                        {s.status === "AWAITING_PICKUP" && <PickupButton shipmentId={s.id} size="sm" />}
                        {(s.status === "IN_TRANSIT" || s.status === "AWAITING_PICKUP") && <DeliverButton shipmentId={s.id} size="sm" />}
                      </div>
                    )}
                  </div>
                  <div className="mt-3 grid gap-2 text-xs text-muted sm:grid-cols-4">
                    <span>Packed: {formatDate(s.packedAt, true)}</span>
                    <span>Dispatched: {formatDate(s.dispatchedAt, true)}</span>
                    <span>Courier: {s.courier ?? "—"} {s.trackingNumber && <>· <span className="font-mono">{s.trackingNumber}</span></>} {s.trackingUrl && <a href={s.trackingUrl} target="_blank" rel="noopener noreferrer" className="inline-flex text-brand-strong"><ExternalLink className="h-3 w-3" /></a>}</span>
                    <span>{s.deliveredAt ? `Delivered: ${formatDate(s.deliveredAt, true)}` : s.expectedDeliveryAt ? `ETA: ${formatDate(s.expectedDeliveryAt)}` : ""}</span>
                  </div>
                  {s.notes && <p className="mt-2 text-xs text-muted">Note: {s.notes}</p>}
                </div>
              ))}
              {o.returns.map((r) => (
                <div key={r.id} className="rounded-xl border border-danger/30 bg-danger/5 p-4 text-xs">
                  <div className="font-medium text-danger">Return received {formatDate(r.receivedAt, true)}</div>
                  <div className="mt-1 text-muted">{r.lines.map((l) => `${l.quantity}× ${l.orderItem.name} (${l.condition.toLowerCase()})`).join(", ")} — {r.reason}</div>
                </div>
              ))}
            </div>
          </Card>

          <Card>
            <CardHeader title="Timeline" subtitle="Every status, payment, shipping and sync event" />
            <div className="p-5">
              <NoteForm orderId={o.id} />
              <ol className="relative mt-5 space-y-4 border-l border-line/60 pl-5">
                {[...o.events].reverse().map((e) => (
                  <li key={e.id} className="relative">
                    <span className={cn("absolute -left-[25px] top-1.5 h-2.5 w-2.5 rounded-full ring-4 ring-surface", e.type === "SYNC" ? "bg-info" : e.type === "SHIPPING" ? "bg-gold" : e.type === "RETURN" ? "bg-danger" : e.type === "NOTE" ? "bg-subtle" : "bg-brand-strong")} />
                    <div className="text-sm text-fg">{e.message}</div>
                    <div className="mt-0.5 text-[11px] text-subtle">{formatDate(e.createdAt, true)} · {e.user?.name ?? (e.actor === "SYNC" ? "WordPress sync" : e.actor === "WEBHOOK" ? "WordPress webhook" : "System")} · {humanize(e.type)}</div>
                  </li>
                ))}
              </ol>
            </div>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Customer" />
            <div className="space-y-4 p-5">
              <KeyValue items={[{ label: "Name", value: o.customerName }, { label: "Email", value: o.customerEmail }, { label: "Phone", value: o.customerPhone }]} />
              <div><div className="text-[11px] uppercase tracking-wider text-subtle">Shipping address</div><p className="mt-1 whitespace-pre-line text-sm">{addr(o.shippingAddress ?? o.billingAddress)}</p></div>
              {!can(user.role, "orders:view_pii") && <p className="text-[11px] text-subtle">Contact details are hidden for your role.</p>}
              {o.customerNote && <div className="rounded-xl bg-surface-2 p-3 text-xs"><b>Customer note:</b> {o.customerNote}</div>}
            </div>
          </Card>
          <Card>
            <CardHeader title="Fulfilment" action={editOrders && <DetailsEditor orderId={o.id} expected={o.expectedDispatchDate?.toISOString() ?? null} notes={o.internalNotes} />} />
            <div className="space-y-3 p-5">
              <KeyValue items={[{ label: "Expected dispatch", value: formatDate(o.expectedDispatchDate) }, { label: "Paid at", value: formatDate(o.paidAt, true) }, { label: "Last synced", value: o.syncedAt ? formatDate(o.syncedAt, true) : o.source === "WORDPRESS" ? "—" : "CRM record" }, { label: "Website order ID", value: o.externalId ?? "—" }]} />
              {o.internalNotes && <p className="whitespace-pre-line rounded-xl bg-surface-2 p-3 text-xs text-muted">{o.internalNotes}</p>}
            </div>
          </Card>
          {settings.mlmEnabled && can(user.role, "mlm:view") && (
            <Card>
              <CardHeader title="Direct selling" action={members.length > 0 && <AttributeMemberButton orderId={o.id} members={members} current={o.memberSale?.member.id ?? null} />} />
              <div className="space-y-2 p-5 text-sm">
                <div>Seller: {o.memberSale ? <Link href={`/mlm?member=${o.memberSale.member.id}`} className="text-brand-strong hover:underline">{o.memberSale.member.name} ({o.memberSale.member.referralCode})</Link> : <span className="text-muted">not attributed</span>}</div>
                {o.commissions.map((c) => <div key={c.id} className="flex justify-between text-xs"><span>L{c.level} · {c.member.name}</span><span className="tabular-nums">{formatMoney(c.amount, o.currency)} <Badge>{c.status}</Badge></span></div>)}
              </div>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
