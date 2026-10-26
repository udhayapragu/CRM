import { PackagePlus } from "lucide-react";
import { requirePageUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { prisma } from "@/lib/db";
import { formatDate, formatMoney } from "@/lib/utils";
import { Card, PageHeader } from "@/components/ui/card";
import { DemoBadge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/misc";
import { ReceiptButton } from "@/components/inventory/warehouse-forms";

export const metadata = { title: "Goods received" };

export default async function ReceiptsPage() {
  const user = await requirePageUser("inventory:view");
  const [receipts, items, suppliers, locations] = await Promise.all([
    prisma.purchaseReceipt.findMany({ orderBy: { receivedAt: "desc" }, take: 100, include: { supplier: true, lines: { include: { item: { select: { name: true, sku: true, unit: true } } } }, createdBy: { select: { name: true } } } }),
    prisma.inventoryItem.findMany({ where: { active: true }, select: { id: true, name: true, sku: true, unit: true }, orderBy: { name: "asc" } }),
    prisma.supplier.findMany({ where: { active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.inventoryLocation.findMany({ where: { active: true }, select: { id: true, name: true } }),
  ]);
  return (
    <>
      <PageHeader eyebrow="Warehouse" title="Goods received" subtitle="Purchase deliveries from suppliers. Posting a receipt adds stock through the ledger." actions={can(user.role, "inventory:adjust") && <ReceiptButton items={items} suppliers={suppliers} locations={locations} />} />
      <Card className="overflow-hidden">
        {receipts.length === 0 ? <EmptyState icon={<PackagePlus className="h-5 w-5" />} title="No goods received yet" message="Record supplier deliveries here to keep packaging and materials stock accurate." /> : (
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead><tr><th>GRN #</th><th>Received</th><th>Supplier</th><th>Invoice</th><th>Items</th><th className="text-right">Value</th><th>Recorded by</th></tr></thead>
              <tbody>
                {receipts.map((r) => (
                  <tr key={r.id}>
                    <td className="font-mono text-xs">{r.number} {r.isDemo && <DemoBadge />}</td>
                    <td className="whitespace-nowrap text-xs text-muted">{formatDate(r.receivedAt)}</td>
                    <td>{r.supplier?.name ?? "—"}</td>
                    <td className="text-xs text-muted">{r.invoiceRef ?? "—"}</td>
                    <td className="min-w-[240px] text-xs">{r.lines.map((l) => `${l.quantity} ${l.item.unit} × ${l.item.name}`).join("; ")}</td>
                    <td className="text-right tabular-nums">{r.totalCost && Number(r.totalCost) > 0 ? formatMoney(r.totalCost) : "—"}</td>
                    <td className="text-xs text-muted">{r.createdBy?.name ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
