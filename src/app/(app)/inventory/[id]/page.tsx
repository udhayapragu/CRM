import Link from "next/link";
import { requirePageUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { prisma } from "@/lib/db";
import { orNotFound } from "@/lib/page-helpers";
import { formatDate, formatNumber } from "@/lib/utils";
import { str, type SP } from "@/lib/url";
import { Card, CardHeader, PageHeader, Stat } from "@/components/ui/card";
import { Badge, DemoBadge } from "@/components/ui/badge";
import { KeyValue } from "@/components/ui/misc";
import { Pagination } from "@/components/ui/table-server";
import { LedgerTable } from "@/components/ledger-table";
import { EditItemButton, StockMovementButton, TransferButton, VerifyLedgerButton } from "@/components/inventory/inventory-actions";
import { CATEGORY_LABELS } from "@/server/services/inventory-ops";
import { getInventoryItemDetail, listLedger } from "@/server/services/queries";

export default async function InventoryItemPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SP> }) {
  const user = await requirePageUser("inventory:view");
  const { id } = await params;
  const sp = await searchParams;
  const item = await orNotFound(getInventoryItemDetail(id));
  const [ledger, locations, suppliers] = await Promise.all([
    listLedger({ itemId: id, page: Number(str(sp, "page")) || 1, pageSize: 25 }),
    prisma.inventoryLocation.findMany({ where: { active: true }, select: { id: true, name: true }, orderBy: { isDefault: "desc" } }),
    prisma.supplier.findMany({ where: { active: true }, select: { id: true, name: true } }),
  ]);
  const opt = [{ id: item.id, name: item.name, sku: item.sku, unit: item.unit }];
  const available = item.qtyOnHand - item.qtyReserved;
  const u = item.unit;
  const formula: [string, number, string][] = [
    ["Opening stock", item.qtyOpening, "+"],
    ["Received", item.qtyReceived, "+"],
    ["Returned", item.qtyReturned, "+"],
    ["Consumed", item.qtyConsumed, "−"],
    ["Dispatched", item.qtyDispatched, "−"],
    ["Damaged / wastage", item.qtyDamaged, "−"],
    ["Adjustments", item.qtyAdjusted, "±"],
  ];
  return (
    <>
      <PageHeader
        eyebrow={<Link href="/inventory" className="hover:underline">Inventory</Link>}
        title={item.name}
        subtitle={<span className="flex flex-wrap items-center gap-2"><span className="font-mono">{item.sku}</span><Badge>{item.customCategory || CATEGORY_LABELS[item.category]}</Badge>{item.isDemo && <DemoBadge />}{!item.active && <Badge tone="danger">Archived</Badge>}</span>}
        actions={
          <>
            <VerifyLedgerButton itemId={item.id} canRepair={can(user.role, "inventory:manage")} />
            {can(user.role, "inventory:manage") && <EditItemButton item={item} suppliers={suppliers} />}
            {can(user.role, "inventory:adjust") && <TransferButton items={opt} locations={locations} presetItemId={item.id} />}
            {can(user.role, "inventory:adjust") && <StockMovementButton items={opt} locations={locations} presetItemId={item.id} />}
          </>
        }
      />
      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="Stock position" subtitle="Calculated from the immutable ledger" />
          <div className="grid grid-cols-2 gap-3 p-5 md:grid-cols-4">
            <Stat label="Physical stock" value={`${formatNumber(item.qtyOnHand)} ${u}`} tone="gold" />
            <Stat label="Reserved" value={formatNumber(item.qtyReserved)} hint="For open orders" />
            <Stat label="Available" value={formatNumber(available)} tone={item.qtyOnHand <= 0 ? "danger" : available <= item.reorderLevel ? "warning" : "success"} />
            <Stat label="Reorder level" value={formatNumber(item.reorderLevel)} />
          </div>
          <div className="mx-5 mb-5 rounded-xl border border-line/50 bg-surface-2/50 p-4">
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-subtle">How physical stock is calculated</div>
            <table className="w-full text-sm">
              <tbody>
                {formula.map(([label, v, sign]) => (
                  <tr key={label}><td className="py-1 text-muted">{sign} {label}</td><td className="py-1 text-right tabular-nums">{formatNumber(v)}</td></tr>
                ))}
                <tr className="border-t border-line/60 font-semibold"><td className="pt-2">= Current physical stock</td><td className="pt-2 text-right tabular-nums text-gold">{formatNumber(item.qtyOnHand)} {u}</td></tr>
              </tbody>
            </table>
          </div>
        </Card>
        <Card>
          <CardHeader title="Details" />
          <div className="p-5">
            <KeyValue items={[
              { label: "Unit", value: u },
              { label: "Supplier", value: item.supplier ? `${item.supplier.name}${item.supplier.phone ? ` · ${item.supplier.phone}` : ""}` : "—" },
              { label: "Linked product", value: item.product ? <Link href={`/products/${item.product.id}`} className="text-brand-strong hover:underline">{item.product.name}</Link> : "—" },
              { label: "Website stock", value: item.variant?.wpStockQuantity ?? item.product?.wpStockQuantity ?? "—" },
              { label: "Last movement", value: formatDate(item.lastMovementAt, true) },
              { label: "Created", value: formatDate(item.createdAt) },
            ]} />
            {item.notes && <p className="mt-4 rounded-xl bg-surface-2 p-3 text-xs text-muted">{item.notes}</p>}
          </div>
          {item.stockLevels.length > 0 && (
            <div className="border-t border-line/40 p-5">
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-subtle">By location</div>
              {item.stockLevels.map((l) => (
                <div key={l.locationId} className="flex justify-between py-1 text-sm"><span className="text-muted">{l.location.name}</span><span className="tabular-nums">{formatNumber(l.qtyOnHand)}</span></div>
              ))}
            </div>
          )}
        </Card>
      </div>
      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader title="Active reservations" subtitle="Stock held for open orders" />
          <div className="p-5">
            {item.reservations.length === 0 ? <p className="text-sm text-muted">No active reservations.</p> : (
              <ul className="space-y-2">{item.reservations.map((r) => (
                <li key={r.id} className="flex justify-between rounded-xl border border-line/50 px-3 py-2 text-sm"><Link href={`/orders/${r.order.id}`} className="hover:text-brand-strong">#{r.order.number} · {r.order.customerName}</Link><span className="tabular-nums">{r.quantity} {u}</span></li>
              ))}</ul>
            )}
          </div>
        </Card>
        <Card>
          <CardHeader title="Used in packaging rules" subtitle="Consumed automatically when these products are dispatched" />
          <div className="p-5">
            {item.usedInRules.length === 0 ? <p className="text-sm text-muted">Not used in any consumption rule.</p> : (
              <ul className="space-y-2">{item.usedInRules.map((r) => (
                <li key={r.id} className="flex justify-between rounded-xl border border-line/50 px-3 py-2 text-sm"><Link href={`/products/${r.product.id}`} className="hover:text-brand-strong">{r.product.name}</Link><span className="tabular-nums">{r.quantityPerUnit} {u} / unit</span></li>
              ))}</ul>
            )}
          </div>
        </Card>
      </div>
      <Card className="mt-4 overflow-hidden">
        <CardHeader title="Stock movement history" subtitle="Every change, with reason, time and responsible user" />
        <div className="p-2"><LedgerTable rows={ledger.rows} /></div>
        <Pagination page={ledger.page} pageSize={ledger.pageSize} total={ledger.total} sp={sp} path={`/inventory/${id}`} />
      </Card>
    </>
  );
}
