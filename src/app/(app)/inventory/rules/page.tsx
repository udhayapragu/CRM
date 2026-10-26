import Link from "next/link";
import { Workflow } from "lucide-react";
import { requirePageUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { prisma } from "@/lib/db";
import { Card, PageHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/misc";
import { DeleteRuleButton, RuleButton } from "@/components/inventory/warehouse-forms";

export const metadata = { title: "Packaging rules" };

export default async function RulesPage() {
  const user = await requirePageUser("inventory:view");
  const [rules, products, materials] = await Promise.all([
    prisma.consumptionRule.findMany({ include: { product: { select: { id: true, name: true, sku: true } }, material: { select: { id: true, name: true, sku: true, unit: true, qtyOnHand: true } } }, orderBy: [{ product: { name: "asc" } }] }),
    prisma.product.findMany({ where: { deletedAtSource: null }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.inventoryItem.findMany({ where: { active: true, category: { not: "PRODUCT" } }, select: { id: true, name: true, sku: true, unit: true }, orderBy: { name: "asc" } }),
  ]);
  const manage = can(user.role, "inventory:manage");
  const grouped = new Map<string, typeof rules>();
  for (const r of rules) grouped.set(r.productId, [...(grouped.get(r.productId) ?? []), r]);
  return (
    <>
      <PageHeader eyebrow="Warehouse" title="Packaging consumption rules" subtitle="Products and packaging stock are linked only through these explicit rules. Without a rule, dispatching a product never touches packaging stock." actions={manage && <RuleButton products={products} materials={materials} />} />
      {grouped.size === 0 ? (
        <Card><EmptyState icon={<Workflow className="h-5 w-5" />} title="No rules defined" message="Example: 1 × Noir Velvet 100ml consumes 1 bottle, 1 front label, 1 cap and 1 carton." /></Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {[...grouped.values()].map((rs) => (
            <Card key={rs[0].productId}>
              <div className="flex items-center justify-between border-b border-line/40 px-5 py-3">
                <Link href={`/products/${rs[0].product.id}`} className="font-medium hover:text-brand-strong">{rs[0].product.name}</Link>
                <span className="text-xs text-muted">per 1 unit dispatched</span>
              </div>
              <ul className="divide-y divide-line/30">
                {rs.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-2.5 text-sm">
                    <span><Link href={`/inventory/${r.material.id}`} className="hover:text-brand-strong">{r.material.name}</Link> <span className="font-mono text-[10px] text-subtle">{r.material.sku}</span></span>
                    <span className="flex items-center gap-3">
                      <Badge tone="gold">{r.quantityPerUnit} {r.material.unit}</Badge>
                      <span className="text-xs text-muted">{r.material.qtyOnHand} in stock</span>
                      {manage && <DeleteRuleButton id={r.id} />}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
