import { cn } from "@/lib/utils";

export type Tone = "neutral" | "brand" | "gold" | "success" | "warning" | "danger" | "info";

const tones: Record<Tone, string> = {
  neutral: "bg-surface-3 text-muted border-line/70",
  brand: "bg-brand/15 text-brand-strong border-brand/30",
  gold: "bg-gold/15 text-gold border-gold/35",
  success: "bg-success/12 text-success border-success/30",
  warning: "bg-warning/12 text-warning border-warning/30",
  danger: "bg-danger/12 text-danger border-danger/30",
  info: "bg-info/12 text-info border-info/30",
};

export function Badge({ tone = "neutral", children, className, dot }: { tone?: Tone; children: React.ReactNode; className?: string; dot?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium", tones[tone], className)}>
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

export function DemoBadge() {
  return <Badge tone="gold" className="uppercase tracking-wider">Demo</Badge>;
}

export function SourceBadge({ source, isDemo }: { source: string; isDemo?: boolean }) {
  if (isDemo || source === "DEMO") return <DemoBadge />;
  if (source === "WORDPRESS") return <Badge tone="info">Synced</Badge>;
  return <Badge>Manual</Badge>;
}
