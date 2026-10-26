import Link from "next/link";
import { cn } from "@/lib/utils";

export function KpiCard({ label, value, hint, icon, tone = "default", href, accent }: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  icon: React.ReactNode;
  tone?: "default" | "success" | "warning" | "danger" | "gold";
  href?: string;
  accent?: boolean;
}) {
  const toneCls = { default: "text-brand-strong bg-brand/10", success: "text-success bg-success/10", warning: "text-warning bg-warning/10", danger: "text-danger bg-danger/10", gold: "text-gold bg-gold/10" }[tone];
  const body = (
    <div className={cn("card group relative h-full overflow-hidden p-4 transition-all hover:-translate-y-0.5 hover:shadow-glow animate-fade-in", accent && "border-gold/30")}>
      {accent && <div className="pointer-events-none absolute -right-10 -top-10 h-28 w-28 rounded-full bg-gold/10 blur-2xl" />}
      <div className="flex items-start justify-between gap-2">
        <span className="text-[11px] font-medium uppercase tracking-wider text-subtle">{label}</span>
        <span className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-lg", toneCls)}>{icon}</span>
      </div>
      <div className={cn("mt-2 truncate text-2xl font-semibold tabular-nums tracking-tight", accent && "gold-text")}>{value}</div>
      {hint && <div className="mt-1 text-[11px] text-muted">{hint}</div>}
    </div>
  );
  return href ? <Link href={href} className="block h-full">{body}</Link> : body;
}
