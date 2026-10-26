import Link from "next/link";
import { AlertTriangle, FlaskConical, Unplug } from "lucide-react";
import { requirePageUser } from "@/lib/auth/session";
import { can, ROLE_LABELS } from "@/lib/auth/permissions";
import { timeAgo } from "@/lib/utils";
import { AppShell } from "@/components/layout/app-shell";
import { NAV } from "@/components/layout/nav";
import { getSettings, hasDemoData } from "@/server/services/settings";
import { getPrimaryConnection, publicConnection } from "@/server/integrations/wordpress/connection-service";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requirePageUser();
  const [settings, demo, conn] = await Promise.all([getSettings(), hasDemoData(), getPrimaryConnection()]);
  const c = conn ? publicConnection(conn) : null;
  const groups = NAV.map((g) => ({ ...g, items: g.items.filter((i) => can(user.role, i.permission)) })).filter((g) => g.items.length);

  const syncState = !c || !c.enabled ? "off" : c.status === "ERROR" ? "error" : c.isStale ? "stale" : "ok";
  const pill = (
    <Link
      href="/settings/integration"
      className="hidden items-center gap-2 rounded-xl border border-line/60 px-3 py-1.5 text-xs text-muted transition hover:border-brand/50 hover:text-fg sm:inline-flex"
      title={c?.lastSuccessfulSyncAt ? `Last successful sync ${new Date(c.lastSuccessfulSyncAt).toLocaleString()}` : "Not synchronised"}
    >
      <span className={`h-2 w-2 rounded-full ${syncState === "ok" ? "bg-success animate-pulse-dot" : syncState === "off" ? "bg-subtle" : syncState === "stale" ? "bg-warning" : "bg-danger"}`} />
      {syncState === "off" ? "WordPress not connected" : syncState === "error" ? "Sync error" : `Synced ${timeAgo(c!.lastSuccessfulSyncAt)}`}
    </Link>
  );

  const banners = (
    <>
      {demo && (
        <div className="border-b border-gold/30 bg-gradient-to-r from-gold/15 via-gold/10 to-transparent">
          <div className="mx-auto flex max-w-[1500px] flex-wrap items-center gap-2 px-4 py-2 text-xs sm:px-6">
            <FlaskConical className="h-4 w-4 text-gold" />
            <b className="uppercase tracking-wider text-gold">Demo environment</b>
            <span className="text-muted">All products, orders and stock shown are sample data — not your business.</span>
            {can(user.role, "settings:manage") && (
              <Link href="/settings/general#demo" className="ml-auto font-medium text-gold underline-offset-2 hover:underline">
                Clear demo data &amp; go live →
              </Link>
            )}
          </div>
        </div>
      )}
      {c?.enabled && (c.status === "ERROR" || c.isStale) && (
        <div className="border-b border-warning/30 bg-warning/10">
          <div className="mx-auto flex max-w-[1500px] flex-wrap items-center gap-2 px-4 py-2 text-xs sm:px-6">
            {c.status === "ERROR" ? <Unplug className="h-4 w-4 text-danger" /> : <AlertTriangle className="h-4 w-4 text-warning" />}
            <span className="text-fg">
              {c.status === "ERROR" ? "WordPress connection error — website data may be outdated." : `Website data may be stale: last successful sync ${timeAgo(c.lastSuccessfulSyncAt)}.`}
            </span>
            <Link href="/settings/integration" className="ml-auto font-medium text-warning hover:underline">View sync status →</Link>
          </div>
        </div>
      )}
    </>
  );

  return (
    <AppShell
      groups={groups}
      user={{ name: user.name, email: user.email, roleLabel: ROLE_LABELS[user.role] }}
      businessName={settings.businessName}
      syncPill={pill}
      banners={banners}
      canSearchOrders={can(user.role, "orders:view")}
    >
      {children}
    </AppShell>
  );
}
