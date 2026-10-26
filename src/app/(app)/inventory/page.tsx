import Link from "next/link";
import { Boxes } from "lucide-react";
import type { InventoryCategory } from "@prisma/client";
import { requirePageUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { prisma } from "@/lib/db";
import { formatNumber, timeAgo } from "@/lib/utils";
import { hrefWith, str, type SP } from "@/lib/url";
import { Card, PageHeader } from "@/components/ui/card";
import { Badge, DemoBadge } from "@/components/ui/badge";
import { EmptyState, TabLinks } from "@/components/ui/misc";
import { FilterBar, FilterSelect, SearchBox } from "@/components/ui/table-tools";
import { Pagination, SortHeader } from "@/components/ui/table-server";
import { NewItemButton, StockMovementButton, TransferButton } from "@/components/inventory/inventory-actions";
import { CATEGORY_LABELS } from "@/server/services/inventory-ops";
import { listInventoryItems } from "@/server/services/queries";

export const metadata = { title: "Inventory" };

export default async function InventoryPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requirePageUser("inventory:view");
  const sp = await searchParams;
  const category = (str(sp, "category") ?? "") as InventoryCategory | "";
  const [data, allItems, locations, suppliers] = await Promise.all([
    listInventoryItems({ q: str(sp, "q"), category, stock: str(sp, "stock") as never, archived: str(sp, "archived"), sort: str(sp, "sort") as never, dir: str(sp, "dir") as never, page: Number(str(sp, "page")) || 1 }),
    prisma.inventoryItem.findMany({ where: { active: true }, select: { id: true, name: true, sku: true, unit: true }, orderBy: { name: "asc" } }),
    prisma.inventoryLocation.findMany({ where: { active: true }, select: { id: true, name: true }, orderBy: { isDefault: "desc" } }),
    prisma.supplier.findMany({ where: { active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  const path = "/inventory";
  const catCount = (c: string) => data.byCategory.find((b) => b.category === c)?._count._all ?? 0;
  const total = data.byCategory.reduce((s, b) => s + b._count._all, 0);
  return (
    <>
      <PageHeader
        eyebrow="Warehouse"
        title="Inventory"
        subtitle="Finished goods, bottles, labels, caps, boxes, packaging and raw materials — every quantity is calculated from the auditable stock ledger."
        actions={
          <>
            {can(user.role, "inventory:adjust") && <TransferButton items={allItems} locations={locations} />}
            {can(user.role, "inventory:adjust") && <StockMovementButton items={allItems} locations={locations} />}
            {can(user.role, "inventory:manage") && <NewItemButton suppliers={suppliers} />}
          </>
        }
      />
      <TabLinks
        active={category || "all"}
        tabs={[{ key: "all", label: "All items", href: hrefWith(path, sp, { category: undefined, page: undefined }), count: total }, ...(Object.keys(CATEGORY_LABELS) as InventoryCategory[]).map((c) => ({ key: c, label: CATEGORY_LABELS[c], href: hrefWith(path, sp, { category: c, page: undefined }), count: catCount(c) }))]}
      />
      <FilterBar>
        <SearchBox placeholder="Search item or SKU…" />
        <FilterSelect param="stock" placeholder="Any stock level" options={[{ value: "ok", label: "Healthy" }, { value: "low", label: "Low stock" }, { value: "out", label: "Out of stock" }]} />
        <FilterSelect param="archived" placeholder="Active items" options={[{ value: "1", label: "Archived items" }]} />
      </FilterBar>
      <Card className="overflow-hidden">
        {data.rows.length === 0 ? (
          <EmptyState icon={<Boxes className="h-5 w-5" />} title="No inventory items" message="Add packaging and raw materials with “New item”, or start tracking a website product from its product page." />
        ) : (
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <SortHeader label="Item" field="name" sp={sp} path={path} defaultDir="asc" />
                  <SortHeader label="SKU" field="sku" sp={sp} path={path} defaultDir="asc" />
                  <SortHeader label="Category" field="category" sp={sp} path={path} defaultDir="asc" />
                  <th className="text-right">Opening</th>
                  <th className="text-right">Received</th>
                  <th className="text-right">Consumed</th>
                  <th className="text-right">Dispatched</th>
                  <th className="text-right">Damaged</th>
                  <SortHeader label="Physical" field="qtyOnHand" sp={sp} path={path} className="text-right" />
                  <th className="text-right">Reserved</th>
                  <th className="text-right">Available</th>
                  <th className="text-right">Reorder</th>
                  <th>Supplier</th>
                  <SortHeader label="Last movement" field="lastMovementAt" sp={sp} path={path} />
                </tr>
              </thead>
              <tbody>
                {data.rows.map((i) => {
                  const avail = i.qtyOnHand - i.qtyReserved;
                  const state = i.qtyOnHand <= 0 ? "out" : avail <= i.reorderLevel ? "low" : "ok";
                  return (
                    <tr key={i.id}>
                      <td className="min-w-[220px]">
                        <Link href={`/inventory/${i.id}`} className="font-medium hover:text-brand-strong">{i.name}</Link>
                        <div className="mt-0.5 flex gap-1">{i.isDemo && <DemoBadge />}{i.product && <Badge tone="info">Website product</Badge>}</div>
                      </td>
                      <td className="font-mono text-xs text-muted">{i.sku}</td>
                      <td className="text-xs text-muted">{i.customCategory || CATEGORY_LABELS[i.category]}</td>
                      <td className="text-right tabular-nums text-muted">{formatNumber(i.qtyOpening)}</td>
                      <td className="text-right tabular-nums text-muted">{formatNumber(i.qtyReceived)}</td>
                      <td className="text-right tabular-nums text-muted">{formatNumber(i.qtyConsumed)}</td>
                      <td className="text-right tabular-nums text-muted">{formatNumber(i.qtyDispatched)}</td>
                      <td className="text-right tabular-nums text-muted">{formatNumber(i.qtyDamaged)}</td>
                      <td className="text-right font-semibold tabular-nums">{formatNumber(i.qtyOnHand)} <span className="text-[10px] font-normal text-subtle">{i.unit}</span></td>
                      <td className="text-right tabular-nums">{formatNumber(i.qtyReserved)}</td>
                      <td className="text-right tabular-nums">
                        <Badge tone={state === "out" ? "danger" : state === "low" ? "warning" : "success"}>{formatNumber(avail)}</Badge>
                      </td>
                      <td className="text-right tabular-nums text-muted">{formatNumber(i.reorderLevel)}</td>
                      <td className="text-xs text-muted">{i.supplier?.name ?? "—"}</td>
                      <td className="whitespace-nowrap text-xs text-muted">{timeAgo(i.lastMovementAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <Pagination page={data.page} pageSize={data.pageSize} total={data.total} sp={sp} path={path} />
      </Card>
      <p className="mt-3 text-[11px] text-subtle">Physical = opening + received − consumed − dispatched + returned − damaged ± adjustments. Available = physical − reserved for open orders.</p>
    </>
  );
}
