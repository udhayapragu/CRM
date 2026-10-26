"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Boxes, Building2, FileSpreadsheet, Gem, LayoutDashboard, Network, PackagePlus, PlugZap, ScrollText, Settings, ShieldCheck, ShoppingBag, Sparkles, Truck, Users, Workflow, X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { NavGroup } from "./nav";

const ICONS = { Boxes, Building2, FileSpreadsheet, Gem, LayoutDashboard, Network, PackagePlus, PlugZap, ScrollText, Settings, ShieldCheck, ShoppingBag, Sparkles, Truck, Users, Workflow } as const;

export function Sidebar({ groups, businessName, open, onClose }: { groups: NavGroup[]; businessName: string; open: boolean; onClose: () => void }) {
  const pathname = usePathname();
  const allHrefs = groups.flatMap((g) => g.items.map((i) => i.href));
  // Longest matching href wins so /inventory/movements doesn't also highlight /inventory.
  const activeHref = allHrefs.filter((h) => pathname === h || pathname.startsWith(h + "/")).sort((a, b) => b.length - a.length)[0];

  const content = (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between px-5 pb-4 pt-6">
        <Link href="/dashboard" className="group flex items-center gap-3" onClick={onClose}>
          <div className="grid h-10 w-10 place-items-center rounded-xl border border-gold/40 bg-gradient-to-br from-brand-soft to-surface shadow-gold">
            <span className="font-display text-xl font-bold gold-text">L</span>
          </div>
          <div className="leading-tight">
            <div className="font-display text-lg font-semibold tracking-wide text-fg">{businessName}</div>
            <div className="text-[10px] uppercase tracking-[0.25em] text-gold/80">Operations Suite</div>
          </div>
        </Link>
        <button className="rounded-lg p-1.5 text-muted hover:bg-surface-2 lg:hidden" onClick={onClose} aria-label="Close navigation">
          <X className="h-5 w-5" />
        </button>
      </div>
      <nav className="min-h-0 flex-1 space-y-5 overflow-y-auto px-3 pb-6">
        {groups.map((g) => (
          <div key={g.label}>
            <div className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.2em] text-subtle">{g.label}</div>
            <ul className="space-y-0.5">
              {g.items.map((item) => {
                const Icon = ICONS[item.icon as keyof typeof ICONS] ?? LayoutDashboard;
                const active = item.href === activeHref;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={onClose}
                      className={cn(
                        "group relative flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition-all",
                        active ? "bg-gradient-to-r from-brand/25 to-brand/5 text-fg" : "text-muted hover:bg-surface-2 hover:text-fg",
                      )}
                    >
                      {active && <span className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-gold" />}
                      <Icon className={cn("h-[18px] w-[18px] transition-colors", active ? "text-gold" : "text-subtle group-hover:text-brand-strong")} />
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
      <div className="mx-4 mb-5 rounded-xl border border-line/50 bg-surface-2/60 p-3 text-[11px] text-muted">
        Physical stock is derived from an immutable ledger. Website data is read-only.
      </div>
    </div>
  );

  return (
    <>
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 border-r border-line/50 bg-surface/80 backdrop-blur-xl lg:block">{content}</aside>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
          <aside className="absolute inset-y-0 left-0 w-72 border-r border-line/60 bg-surface animate-slide-in">{content}</aside>
        </div>
      )}
    </>
  );
}
