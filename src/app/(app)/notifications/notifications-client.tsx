"use client";
import Link from "next/link";
import { CheckCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAction } from "@/components/use-action";
import { cn, formatDate } from "@/lib/utils";

interface N { id: string; type: string; title: string; message: string; severity: string; link: string | null; createdAt: string; readAt: string | null; isDemo: boolean }

export function NotificationsList({ items }: { items: N[] }) {
  const { run, busy } = useAction();
  const unread = items.filter((i) => !i.readAt).length;
  return (
    <div className="card overflow-hidden">
      <div className="flex items-center justify-between border-b border-line/50 px-5 py-3">
        <span className="text-sm text-muted">{unread} unread</span>
        <Button size="sm" variant="secondary" loading={busy} disabled={!unread} onClick={() => run("/api/notifications/read", { body: { ids: "all" }, success: "All marked as read" })}><CheckCheck className="h-3.5 w-3.5" /> Mark all read</Button>
      </div>
      {items.length === 0 && <p className="p-10 text-center text-sm text-muted">No notifications.</p>}
      <ul className="divide-y divide-line/30">
        {items.map((n) => (
          <li key={n.id} className={cn("flex gap-4 px-5 py-4", !n.readAt && "bg-brand/5")}>
            <span className={cn("mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full", n.severity === "critical" ? "bg-danger" : n.severity === "warning" ? "bg-warning" : "bg-brand-strong", n.readAt && "opacity-30")} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2 text-sm font-medium">{n.title}<span className="rounded bg-surface-3 px-1.5 text-[10px] uppercase tracking-wider text-subtle">{n.type.replace(/_/g, " ")}</span>{n.isDemo && <span className="text-[10px] uppercase text-gold">demo</span>}</div>
              <p className="text-sm text-muted">{n.message}</p>
              <div className="mt-1 flex gap-3 text-[11px] text-subtle">{formatDate(n.createdAt, true)}{n.link && <Link href={n.link} className="text-brand-strong hover:underline">Open →</Link>}{!n.readAt && <button onClick={() => run("/api/notifications/read", { body: { ids: [n.id] } })} className="hover:text-fg">Mark read</button>}</div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
