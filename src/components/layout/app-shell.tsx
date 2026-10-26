"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Menu, Search } from "lucide-react";
import { Sidebar } from "./sidebar";
import { ThemeToggle } from "./theme-toggle";
import { NotificationBell } from "./notification-bell";
import { UserMenu } from "./user-menu";
import type { NavGroup } from "./nav";
import { ToastProvider } from "@/components/ui/toast";

export function AppShell({
  groups, user, businessName, syncPill, banners, children, canSearchOrders,
}: {
  groups: NavGroup[];
  user: { name: string; email: string; roleLabel: string };
  businessName: string;
  syncPill: React.ReactNode;
  banners: React.ReactNode;
  children: React.ReactNode;
  canSearchOrders: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const router = useRouter();
  return (
    <ToastProvider>
      <Sidebar groups={groups} businessName={businessName} open={open} onClose={() => setOpen(false)} />
      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 border-b border-line/40 bg-bg/75 backdrop-blur-xl">
          <div className="flex h-16 items-center gap-3 px-4 sm:px-6">
            <button className="rounded-lg p-2 text-muted hover:bg-surface-2 lg:hidden" onClick={() => setOpen(true)} aria-label="Open navigation">
              <Menu className="h-5 w-5" />
            </button>
            {canSearchOrders && (
              <form
                className="relative hidden max-w-md flex-1 md:block"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (q.trim()) router.push(`/orders?q=${encodeURIComponent(q.trim())}`);
                }}
              >
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" />
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search orders, customers, SKU, tracking #…" className="input h-9 pl-9" aria-label="Search orders" />
              </form>
            )}
            <div className="ml-auto flex items-center gap-2">
              {syncPill}
              <ThemeToggle />
              <NotificationBell />
              <UserMenu {...user} />
            </div>
          </div>
        </header>
        {banners}
        <main className="mx-auto w-full max-w-[1500px] px-4 py-6 sm:px-6 lg:py-8">{children}</main>
      </div>
    </ToastProvider>
  );
}
