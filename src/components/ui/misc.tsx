import Link from "next/link";
import { cn } from "@/lib/utils";

export function Skeleton({ className }: { className?: string }) {
  return (
    <div className={cn("relative overflow-hidden rounded-lg bg-surface-3/60", className)}>
      <div className="absolute inset-0 -translate-x-full animate-shimmer bg-gradient-to-r from-transparent via-white/5 to-transparent" />
    </div>
  );
}

export function EmptyState({ icon, title, message, action }: { icon?: React.ReactNode; title: string; message?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      {icon && <div className="mb-3 rounded-2xl border border-line/60 bg-surface-2 p-3 text-gold">{icon}</div>}
      <h3 className="font-display text-xl font-semibold">{title}</h3>
      {message && <p className="mt-1 max-w-md text-sm text-muted">{message}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function TabLinks({ tabs, active }: { tabs: { key: string; label: React.ReactNode; href: string; count?: number }[]; active: string }) {
  return (
    <div className="-mx-1 mb-4 flex gap-1 overflow-x-auto px-1 pb-1">
      {tabs.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          scroll={false}
          className={cn(
            "inline-flex shrink-0 items-center gap-2 rounded-xl border px-3 py-1.5 text-xs font-medium transition",
            active === t.key ? "border-brand/50 bg-brand/15 text-fg shadow-glow" : "border-line/60 bg-surface text-muted hover:text-fg",
          )}
        >
          {t.label}
          {t.count !== undefined && <span className={cn("rounded-full px-1.5 text-[10px] tabular-nums", active === t.key ? "bg-brand/30 text-fg" : "bg-surface-3 text-subtle")}>{t.count}</span>}
        </Link>
      ))}
    </div>
  );
}

export function KeyValue({ items }: { items: { label: string; value: React.ReactNode }[] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
      {items.map((i) => (
        <div key={i.label} className="min-w-0">
          <dt className="text-[11px] uppercase tracking-wider text-subtle">{i.label}</dt>
          <dd className="mt-0.5 break-words text-sm text-fg">{i.value ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}
