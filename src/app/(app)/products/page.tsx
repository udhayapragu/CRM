import Link from "next/link";
import { Gem, ImageOff } from "lucide-react";
import { requirePageUser } from "@/lib/auth/session";
import { formatMoney, formatNumber, timeAgo } from "@/lib/utils";
import { str, type SP } from "@/lib/url";
import { PageHeader, Card } from "@/components/ui/card";
import { SourceBadge, Badge } from "@/components/ui/badge";
import { StockBadge } from "@/components/ui/status";
import { EmptyState, TabLinks } from "@/components/ui/misc";
import { FilterBar, FilterSelect, SearchBox } from "@/components/ui/table-tools";
import { Pagination, SortHeader } from "@/components/ui/table-server";
import { listProducts, productCategories, type StockFilter } from "@/server/services/products";
import { getSettings } from "@/server/services/settings";
import { hrefWith } from "@/lib/url";

export const metadata = { title: "Products" };

const FILTERS: { key: StockFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "in", label: "In stock" },
  { key: "low", label: "Low stock" },
  { key: "out", label: "Out of stock" },
  { key: "active", label: "Active" },
  { key: "draft", label: "Draft" },
  { key: "recent", label: "Recently added" },
  { key: "untracked", label: "Physical stock not tracked" },
  { key: "removed", label: "Removed from website" },
];

export default async function ProductsPage({ searchParams }: { searchParams: Promise<SP> }) {
  await requirePageUser("products:view");
  const sp = await searchParams;
  const filter = (str(sp, "filter") as StockFilter) ?? "all";
  const [data, cats, settings] = await Promise.all([
    listProducts({ q: str(sp, "q"), filter, category: str(sp, "category"), sort: str(sp, "sort") as never, dir: str(sp, "dir") as never, page: Number(str(sp, "page")) || 1 }),
    productCategories(),
    getSettings(),
  ]);
  const path = "/products";
  return (
    <>
      <PageHeader eyebrow="Catalogue" title="Products" subtitle="Products synchronised from your website, with physical stock from the inventory ledger where tracked." />
      <TabLinks active={filter} tabs={FILTERS.map((f) => ({ key: f.key, label: f.label, href: hrefWith(path, sp, { filter: f.key === "all" ? undefined : f.key, page: undefined }) }))} />
      <FilterBar>
        <SearchBox placeholder="Search name or SKU…" />
        {cats.length > 0 && <FilterSelect param="category" placeholder="All categories" options={cats.map((c) => ({ value: c, label: c }))} />}
      </FilterBar>
      <Card className="overflow-hidden">
        {data.rows.length === 0 ? (
          <EmptyState icon={<Gem className="h-5 w-5" />} title="No products found" message={data.total === 0 && !str(sp, "q") ? "Connect your WordPress site (Settings → WordPress Sync) or load demo data to see products here." : "Try a different search or filter."} />
        ) : (
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <SortHeader label="Product" field="name" sp={sp} path={path} defaultDir="asc" />
                  <SortHeader label="SKU" field="sku" sp={sp} path={path} defaultDir="asc" />
                  <th>Category</th>
                  <SortHeader label="Price" field="price" sp={sp} path={path} />
                  <SortHeader label="Total stock" field="onhand" sp={sp} path={path} className="text-right" />
                  <SortHeader label="Available" field="available" sp={sp} path={path} className="text-right" />
                  <th className="text-right">Reserved</th>
                  <th className="text-right">Dispatched</th>
                  <th className="text-right">Returned</th>
                  <th className="text-right">Damaged</th>
                  <th className="text-right">Threshold</th>
                  <th>Stock</th>
                  <th>Status</th>
                  <SortHeader label="Updated" field="updated" sp={sp} path={path} />
                </tr>
              </thead>
              <tbody>
                {data.rows.map((p) => (
                  <tr key={p.id}>
                    <td className="min-w-[240px]">
                      <Link href={`/products/${p.id}`} className="flex items-center gap-3">
                        {p.imageUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={p.imageUrl} alt="" className="h-10 w-10 rounded-lg border border-line/60 object-cover" loading="lazy" />
                        ) : (
                          <span className="grid h-10 w-10 place-items-center rounded-lg border border-line/60 bg-surface-2 text-subtle"><ImageOff className="h-4 w-4" /></span>
                        )}
                        <span className="min-w-0">
                          <span className="block truncate font-medium text-fg hover:text-brand-strong">{p.name}</span>
                          <span className="mt-0.5 flex gap-1"><SourceBadge source={p.source} isDemo={p.isDemo} />{p._count.variants > 0 && <Badge>{p._count.variants} variants</Badge>}</span>
                        </span>
                      </Link>
                    </td>
                    <td className="font-mono text-xs text-muted">{p.sku ?? "—"}</td>
                    <td className="text-xs text-muted">{p.categories.slice(0, 2).join(", ") || "—"}</td>
                    <td className="tabular-nums">{p.price ? formatMoney(p.price, p.currency ?? settings.currency) : "—"}</td>
                    <Num v={p.stock.totalStock} web={p.stock.source === "WEBSITE"} />
                    <Num v={p.stock.available} web={p.stock.source === "WEBSITE"} strong />
                    <Num v={p.stock.reserved} />
                    <Num v={p.stock.dispatched} />
                    <Num v={p.stock.returned} />
                    <Num v={p.stock.damaged} />
                    <Num v={p.stock.threshold} />
                    <td><StockBadge state={p.stockState} source={p.stock.source} /></td>
                    <td>{p.deletedAtSource ? <Badge tone="danger">Removed</Badge> : <Badge tone={p.wpStatus === "publish" ? "success" : "neutral"}>{p.wpStatus === "publish" ? "Active" : p.wpStatus}</Badge>}</td>
                    <td className="whitespace-nowrap text-xs text-muted">{timeAgo(p.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pagination page={data.page} pageSize={data.pageSize} total={data.total} sp={sp} path={path} />
      </Card>
      <p className="mt-3 text-[11px] text-subtle">Figures marked <span className="uppercase">web</span> come from the website&apos;s own stock count because physical stock isn&apos;t tracked for that product yet. Open a product to start tracking it.</p>
    </>
  );
}

function Num({ v, web, strong }: { v: number | null; web?: boolean; strong?: boolean }) {
  return (
    <td className={`text-right tabular-nums ${strong ? "font-semibold" : ""} ${v !== null && v < 0 ? "text-danger" : ""}`}>
      {v === null ? <span className="text-subtle">—</span> : formatNumber(v)}
      {web && v !== null && <span className="ml-1 text-[9px] uppercase text-subtle">web</span>}
    </td>
  );
}
