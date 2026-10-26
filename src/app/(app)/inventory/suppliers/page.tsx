import { Building2 } from "lucide-react";
import { requirePageUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { prisma } from "@/lib/db";
import { Card, CardHeader, PageHeader } from "@/components/ui/card";
import { Badge, DemoBadge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/misc";
import { LocationButton, SupplierButton } from "@/components/inventory/warehouse-forms";

export const metadata = { title: "Suppliers" };

export default async function SuppliersPage() {
  const user = await requirePageUser("inventory:view");
  const [suppliers, locations] = await Promise.all([
    prisma.supplier.findMany({ orderBy: { name: "asc" }, include: { _count: { select: { items: true, receipts: true } } } }),
    prisma.inventoryLocation.findMany({ orderBy: [{ isDefault: "desc" }, { code: "asc" }], include: { _count: { select: { stockLevels: true } } } }),
  ]);
  const manage = can(user.role, "inventory:manage");
  return (
    <>
      <PageHeader eyebrow="Warehouse" title="Suppliers & locations" subtitle="Who supplies your materials, and where stock is kept." actions={manage && <><LocationButton /><SupplierButton /></>} />
      <Card className="overflow-hidden">
        {suppliers.length === 0 ? <EmptyState icon={<Building2 className="h-5 w-5" />} title="No suppliers yet" /> : (
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead><tr><th>Supplier</th><th>Contact</th><th>Phone</th><th>Email</th><th>Tax ID</th><th className="text-right">Items</th><th className="text-right">Receipts</th><th /></tr></thead>
              <tbody>
                {suppliers.map((s) => (
                  <tr key={s.id}>
                    <td className="font-medium">{s.name} {s.isDemo && <DemoBadge />} {!s.active && <Badge>inactive</Badge>}</td>
                    <td className="text-sm text-muted">{s.contactName ?? "—"}</td>
                    <td className="text-sm text-muted">{s.phone ?? "—"}</td>
                    <td className="text-sm text-muted">{s.email ?? "—"}</td>
                    <td className="font-mono text-xs text-muted">{s.gstOrTaxId ?? "—"}</td>
                    <td className="text-right tabular-nums">{s._count.items}</td>
                    <td className="text-right tabular-nums">{s._count.receipts}</td>
                    <td className="text-right">{manage && <SupplierButton supplier={{ id: s.id, name: s.name, contactName: s.contactName ?? "", email: s.email ?? "", phone: s.phone ?? "", address: s.address ?? "", gstOrTaxId: s.gstOrTaxId ?? "", notes: s.notes ?? "" }} />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <Card className="mt-4">
        <CardHeader title="Storage locations" subtitle="Add a second location to enable stock transfers" />
        <ul className="grid gap-3 p-5 sm:grid-cols-2 lg:grid-cols-4">
          {locations.map((l) => (
            <li key={l.id} className="rounded-xl border border-line/50 bg-surface-2/50 p-3">
              <div className="font-mono text-xs text-gold">{l.code}</div>
              <div className="font-medium">{l.name}</div>
              <div className="mt-1 text-xs text-muted">{l._count.stockLevels} items stocked {l.isDefault && <Badge tone="brand">default</Badge>}</div>
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}
