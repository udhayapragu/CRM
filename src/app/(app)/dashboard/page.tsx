import Link from "next/link";
import {
  AlertTriangle, Archive, Ban, Boxes, CalendarCheck, CheckCircle2, Clock, Gem, IndianRupee, Loader, PackageCheck, PackageOpen, ShoppingBag, Sparkles, TrendingUp, Truck,
} from "lucide-react";
import { requirePageUser } from "@/lib/auth/session";
import { formatMoney, formatMoneyCompact, formatNumber, formatDate, timeAgo } from "@/lib/utils";
import { PageHeader, Card, CardHeader } from "@/components/ui/card";
import { KpiCard } from "@/components/kpi-card";
import { OrderStatusBadge } from "@/components/ui/status";
import { DemoBadge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/misc";
import { AutoRefresh } from "@/components/auto-refresh";
import { HorizontalBars, LowStockTrendChart, OrdersDispatchChart, SalesChart, StockLevelsChart } from "@/components/charts/charts";
import { getActivityFeed, getAttentionOrders, getCharts, getKpis } from "@/server/services/dashboard";
import { getSettings } from "@/server/services/settings";

export const metadata = { title: "Dashboard" };

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ denied?: string }> }) {
  const user = await requirePageUser("dashboard:view");
  const sp = await searchParams;
  const [k, charts, activity, attention, settings] = await Promise.all([getKpis(), getCharts(), getActivityFeed(14), getAttentionOrders(8), getSettings()]);
  const cur = settings.currency;
  const icon = "h-4 w-4";
  const greeting = new Date().getHours() < 12 ? "Good morning" : new Date().getHours() < 17 ? "Good afternoon" : "Good evening";

  return (
    <>
      {sp.denied && <div className="mb-4 rounded-xl border border-warning/30 bg-warning/10 px-4 py-2 text-sm text-warning">You don&apos;t have access to that page.</div>}
      <PageHeader
        eyebrow={new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" })}
        title={<>{greeting}, <span className="gold-text">{user.name.split(" ")[0]}</span></>}
        subtitle="A real-time view of your website, warehouse and fulfilment — every figure is calculated from synchronised and recorded data."
        actions={<AutoRefresh generatedAt={new Date().toISOString()} />}
      />

      <section aria-label="Key metrics" className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        <KpiCard label="Today's sales" value={<span title={formatMoney(k.todaysSales, cur)}>{formatMoneyCompact(k.todaysSales, cur)}</span>} hint="Paid orders, net of refunds" icon={<IndianRupee className={icon} />} tone="gold" accent />
        <KpiCard label="Total revenue" value={<span title={formatMoney(k.totalRevenue, cur)}>{formatMoneyCompact(k.totalRevenue, cur)}</span>} hint={`${formatMoney(k.totalRevenue, cur)} · all paid orders`} icon={<TrendingUp className={icon} />} tone="gold" accent />
        <KpiCard label="Total orders" value={formatNumber(k.totalOrders)} icon={<ShoppingBag className={icon} />} href="/orders" />
        <KpiCard label="Today's orders" value={formatNumber(k.todaysOrders)} icon={<CalendarCheck className={icon} />} href={`/orders?from=${new Date().toISOString().slice(0, 10)}`} />
        <KpiCard label="Dispatched today" value={formatNumber(k.dispatchedToday)} icon={<Truck className={icon} />} href="/dispatch?view=dispatched-today" tone="success" />
        <KpiCard label="Pending orders" value={formatNumber(k.pendingOrders)} hint="New, awaiting payment, confirmed, on hold" icon={<Clock className={icon} />} tone="warning" href="/orders?status=NEW" />
        <KpiCard label="Processing" value={formatNumber(k.processingOrders)} hint="Processing, packing, ready" icon={<Loader className={icon} />} href="/dispatch" />
        <KpiCard label="Delivered" value={formatNumber(k.deliveredOrders)} icon={<CheckCircle2 className={icon} />} tone="success" href="/orders?status=DELIVERED" />
        <KpiCard label="Cancelled" value={formatNumber(k.cancelledOrders)} icon={<Ban className={icon} />} tone="danger" href="/orders?status=CANCELLED" />
        <KpiCard label="Total products" value={formatNumber(k.totalProducts)} icon={<Gem className={icon} />} href="/products" />
        <KpiCard label="Available stock" value={formatNumber(k.totalAvailableStock)} hint="Finished goods, physical" icon={<PackageCheck className={icon} />} href="/inventory?category=PRODUCT" />
        <KpiCard label="Low-stock items" value={formatNumber(k.lowStockItems)} icon={<AlertTriangle className={icon} />} tone="warning" href="/inventory?stock=low" />
        <KpiCard label="Out of stock" value={formatNumber(k.outOfStockItems)} icon={<Archive className={icon} />} tone="danger" href="/inventory?stock=out" />
        <KpiCard label="Packaging stock" value={formatNumber(k.packagingUnits)} hint={`${k.packagingSkus} material SKUs`} icon={<Boxes className={icon} />} href="/inventory?category=BOTTLE" />
        <KpiCard label="Ready to onboard" value={formatNumber(k.readyForOnboarding)} icon={<Sparkles className={icon} />} tone="gold" href="/onboarding" />
        <KpiCard label="Awaiting onboarding" value={formatNumber(k.awaitingOnboarding)} icon={<PackageOpen className={icon} />} href="/onboarding" />
      </section>

      <div className="mt-6 grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="Orders & dispatches" subtitle="Last 14 days" />
          <div className="px-5 pb-5 pt-12"><OrdersDispatchChart data={charts.daily} /></div>
        </Card>
        <Card>
          <CardHeader title="Sales" subtitle={`Net paid sales (${cur})`} />
          <div className="px-5 pb-5 pt-12"><SalesChart weekly={charts.weekly} monthly={charts.monthly} currency={cur} /></div>
        </Card>
        <Card>
          <CardHeader title="Order status distribution" subtitle="All orders" />
          <div className="px-5 pb-5 pt-12"><HorizontalBars data={charts.statusDistribution} labelKey="label" valueKey="value" name="Orders" height={300} empty="No orders yet" /></div>
        </Card>
        <Card>
          <CardHeader title="Lowest stock levels" subtitle="Available units (on hand − reserved)" />
          <div className="px-5 pb-5 pt-12"><StockLevelsChart data={charts.stockLevels} /></div>
        </Card>
        <Card>
          <CardHeader title="Fast-moving products" subtitle="Units ordered, last 30 days" />
          <div className="px-5 pb-5 pt-12"><HorizontalBars data={charts.fastMoving} labelKey="name" valueKey="qty" name="Units" colorKey="c2" height={300} empty="No sales in the last 30 days" /></div>
        </Card>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card>
          <CardHeader title="Low-stock trend" subtitle="Items at/below reorder level, reconstructed from the ledger (30 days)" />
          <div className="px-5 pb-5 pt-12"><LowStockTrendChart data={charts.lowStockTrend} /></div>
        </Card>
        <Card>
          <CardHeader title="Needs immediate attention" subtitle="Flagged or past expected dispatch date" action={<Link href="/orders?status=ATTENTION" className="text-xs text-brand-strong hover:underline">View all</Link>} />
          <div className="px-2 pb-3 pt-2">
            {attention.length === 0 ? (
              <EmptyState icon={<CheckCircle2 className="h-5 w-5" />} title="All clear" message="No orders need attention right now." />
            ) : (
              <ul>
                {attention.map((o) => (
                  <li key={o.id}>
                    <Link href={`/orders/${o.id}`} className="flex items-start gap-3 rounded-xl px-3 py-2.5 hover:bg-surface-2">
                      <AlertTriangle className={`mt-0.5 h-4 w-4 shrink-0 ${o.needsAttention ? "text-danger" : "text-warning"}`} />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2 text-sm font-medium">#{o.number} · {o.customerName} {o.isDemo && <DemoBadge />}</div>
                        <div className="truncate text-xs text-muted">{o.reason}</div>
                        <div className="mt-1 flex items-center gap-2 text-[11px] text-subtle"><OrderStatusBadge status={o.status} /> due {formatDate(o.expectedDispatchDate)}</div>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>
        <Card>
          <CardHeader title="Recent activity" subtitle="Order events and stock movements" />
          <div className="px-2 pb-3 pt-2">
            {activity.length === 0 ? (
              <EmptyState title="No activity yet" message="Connect WordPress or load demo data to get started." />
            ) : (
              <ul className="relative">
                {activity.map((a) => (
                  <li key={a.id}>
                    <Link href={a.href} className="flex gap-3 rounded-xl px-3 py-2 hover:bg-surface-2">
                      <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${a.kind === "order" ? "bg-brand-strong" : "bg-gold"}`} />
                      <div className="min-w-0">
                        <div className="truncate text-sm text-fg">{a.title}</div>
                        <div className="truncate text-xs text-muted">{a.message}</div>
                        <div className="text-[10px] text-subtle">{timeAgo(a.at)} · {a.actor}</div>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>
      </div>
    </>
  );
}
