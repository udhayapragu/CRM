import Link from "next/link";
import { ExternalLink, ImageOff, Info } from "lucide-react";
import { requirePageUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { orNotFound } from "@/lib/page-helpers";
import { formatDate, formatMoney, timeAgo } from "@/lib/utils";
import { Card, CardHeader, PageHeader, Stat } from "@/components/ui/card";
import { Badge, SourceBadge } from "@/components/ui/badge";
import { OrderStatusBadge } from "@/components/ui/status";
import { KeyValue } from "@/components/ui/misc";
import { LedgerTable } from "@/components/ledger-table";
import { getProductDetail } from "@/server/services/products";
import { ThresholdEditor, TrackProductButton } from "./product-actions";

export default async function ProductDetail({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePageUser("products:view");
  const { id } = await params;
  const { product: p, ledger, orderItems } = await orNotFound(getProductDetail(id));
  const s = p.stock;
  const trackedVariantIds = new Set(p.inventoryItems.map((i) => i.variantId).filter(Boolean));
  const parentTracked = p.inventoryItems.some((i) => !i.variantId);
  const diff = s.source === "PHYSICAL" && p.wpManageStock && p.wpStockQuantity !== null ? p.wpStockQuantity - (s.available ?? 0) : null;

  return (
    <>
      <PageHeader
        eyebrow={<Link href="/products" className="hover:underline">Products</Link>}
        title={p.name}
        subtitle={<span className="flex flex-wrap items-center gap-2"><SourceBadge source={p.source} isDemo={p.isDemo} /><span className="font-mono">{p.sku ?? "No SKU"}</span>{p.categories.map((c) => <Badge key={c}>{c}</Badge>)}{p.deletedAtSource && <Badge tone="danger">Removed from website {formatDate(p.deletedAtSource)}</Badge>}</span>}
        actions={
          <>
            {p.permalink && <a href={p.permalink} target="_blank" rel="noopener noreferrer" className="inline-flex h-10 items-center gap-2 rounded-xl border border-line px-4 text-sm hover:bg-surface-2"><ExternalLink className="h-4 w-4" /> View on website</a>}
            {can(user.role, "products:edit") && <ThresholdEditor productId={p.id} value={p.lowStockThreshold} />}
            {can(user.role, "inventory:manage") && (!parentTracked || p.variants.some((v) => !trackedVariantIds.has(v.id))) && (
              <TrackProductButton productId={p.id} defaultSku={p.sku ?? ""} threshold={p.lowStockThreshold} variants={p.variants.map((v) => ({ id: v.id, name: v.name, tracked: trackedVariantIds.has(v.id) }))} />
            )}
          </>
        }
      />
      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="Stock position" subtitle={s.source === "PHYSICAL" ? "Physical stock calculated from the inventory ledger" : "Physical stock is not tracked — showing website stock only"} />
          <div className="grid grid-cols-2 gap-3 p-5 sm:grid-cols-4">
            <Stat label="Total stock" value={s.totalStock ?? "—"} hint={s.source === "WEBSITE" ? "Website figure" : "On hand"} />
            <Stat label="Available" value={s.available ?? "—"} tone={s.available !== null && s.available <= s.threshold ? "warning" : "success"} hint="On hand − reserved" />
            <Stat label="Reserved" value={s.reserved ?? "—"} hint="Open orders" />
            <Stat label="Threshold" value={s.threshold} />
            <Stat label="Dispatched" value={s.dispatched ?? "—"} />
            <Stat label="Returned" value={s.returned ?? "—"} />
            <Stat label="Damaged" value={s.damaged ?? "—"} tone="danger" />
            <Stat label="Website stock" value={p.wpManageStock ? p.wpStockQuantity ?? "—" : "Not managed"} hint={p.syncedAt ? `Synced ${timeAgo(p.syncedAt)}` : p.isDemo ? "Demo value" : "Never synced"} />
          </div>
          {diff !== null && diff !== 0 && (
            <div className="mx-5 mb-5 flex items-start gap-2 rounded-xl border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
              <Info className="mt-0.5 h-4 w-4 shrink-0" />
              Website shows {p.wpStockQuantity} but physical available stock is {s.available} ({diff > 0 ? "+" : ""}{diff}). The CRM never changes website stock — update it in WordPress if needed.
            </div>
          )}
        </Card>
        <Card>
          <div className="flex gap-4 p-5">
            {p.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={p.imageUrl} alt={p.name} className="h-24 w-24 rounded-xl border border-line/60 object-cover" />
            ) : (
              <div className="grid h-24 w-24 place-items-center rounded-xl border border-line/60 bg-surface-2 text-subtle"><ImageOff className="h-6 w-6" /></div>
            )}
            <div className="min-w-0">
              <div className="font-display text-2xl gold-text">{p.price ? formatMoney(p.price, p.currency ?? "INR") : "—"}</div>
              {p.salePrice && <div className="text-xs text-muted">Regular {formatMoney(p.regularPrice)}</div>}
              <Badge tone={p.wpStatus === "publish" ? "success" : "neutral"} className="mt-2">{p.wpStatus}</Badge>
            </div>
          </div>
          <div className="border-t border-line/40 p-5">
            <KeyValue items={[
              { label: "Type", value: p.type },
              { label: "Website ID", value: p.externalId ?? "—" },
              { label: "Last updated on website", value: formatDate(p.externalUpdatedAt, true) },
              { label: "Last synced", value: p.syncedAt ? formatDate(p.syncedAt, true) : "—" },
            ]} />
          </div>
        </Card>
      </div>

      {p.inventoryItems.length > 0 && (
        <Card className="mt-4">
          <CardHeader title="Linked inventory items" subtitle="Physical stock records for this product" />
          <div className="overflow-x-auto p-2">
            <table className="table-base">
              <thead><tr><th>SKU</th><th>Item</th><th className="text-right">On hand</th><th className="text-right">Reserved</th><th className="text-right">Available</th><th>Locations</th></tr></thead>
              <tbody>
                {p.inventoryItems.map((i) => (
                  <tr key={i.id}>
                    <td className="font-mono text-xs"><Link href={`/inventory/${i.id}`} className="hover:text-brand-strong">{i.sku}</Link></td>
                    <td>{i.name}</td>
                    <td className="text-right tabular-nums">{i.qtyOnHand}</td>
                    <td className="text-right tabular-nums">{i.qtyReserved}</td>
                    <td className="text-right font-semibold tabular-nums">{i.qtyOnHand - i.qtyReserved}</td>
                    <td className="text-xs text-muted">{i.stockLevels.map((l) => `${l.location.code}: ${l.qtyOnHand}`).join(" · ") || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {p.variants.length > 0 && (
        <Card className="mt-4">
          <CardHeader title={`Variants (${p.variants.length})`} subtitle="Synchronised from the website" />
          <div className="overflow-x-auto p-2">
            <table className="table-base">
              <thead><tr><th>Variant</th><th>SKU</th><th>Price</th><th className="text-right">Website stock</th><th className="text-right">Physical available</th></tr></thead>
              <tbody>
                {p.variants.map((v) => {
                  const it = v.inventoryItems[0];
                  return (
                    <tr key={v.id}>
                      <td>{v.name}</td>
                      <td className="font-mono text-xs text-muted">{v.sku ?? "—"}</td>
                      <td>{v.price ? formatMoney(v.price) : "—"}</td>
                      <td className="text-right tabular-nums">{v.wpStockQuantity ?? "—"}</td>
                      <td className="text-right tabular-nums">{it ? it.qtyOnHand - it.qtyReserved : <span className="text-subtle">not tracked</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader title="Packaging consumption rules" subtitle="Materials consumed per unit dispatched" action={<Link href="/inventory/rules" className="text-xs text-brand-strong hover:underline">Manage</Link>} />
          <div className="p-5">
            {p.consumptionRules.length === 0 ? (
              <p className="text-sm text-muted">No rules — dispatching this product does not consume packaging stock.</p>
            ) : (
              <ul className="space-y-2">
                {p.consumptionRules.map((r) => (
                  <li key={r.id} className="flex items-center justify-between rounded-xl border border-line/50 bg-surface-2/50 px-3 py-2 text-sm">
                    <Link href={`/inventory/${r.material.id}`} className="hover:text-brand-strong">{r.material.name}</Link>
                    <span className="tabular-nums text-muted">{r.quantityPerUnit} {r.material.unit} / unit {!r.active && <Badge>inactive</Badge>}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>
        <Card>
          <CardHeader title="Related orders" subtitle="Most recent 50" />
          <div className="overflow-x-auto p-2">
            {orderItems.length === 0 ? <p className="px-3 py-8 text-center text-sm text-muted">No orders for this product yet.</p> : (
              <table className="table-base">
                <thead><tr><th>Order</th><th>Date</th><th>Customer</th><th className="text-right">Qty</th><th>Status</th></tr></thead>
                <tbody>
                  {orderItems.map((oi) => (
                    <tr key={oi.id}>
                      <td><Link href={`/orders/${oi.order.id}`} className="font-medium hover:text-brand-strong">#{oi.order.number}</Link></td>
                      <td className="text-xs text-muted">{formatDate(oi.order.orderDate)}</td>
                      <td className="text-sm">{oi.order.customerName}</td>
                      <td className="text-right tabular-nums">{oi.quantity}</td>
                      <td><OrderStatusBadge status={oi.order.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader title="Inventory history" subtitle="Ledger entries for this product's physical stock (latest 100)" />
        <div className="p-2"><LedgerTable rows={ledger} /></div>
      </Card>
    </>
  );
}
