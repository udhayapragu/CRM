"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Bell, CheckCheck } from "lucide-react";
import { api } from "@/lib/client-api";
import { cn, timeAgo } from "@/lib/utils";

interface N {
  id: string;
  title: string;
  message: string;
  severity: string;
  link: string | null;
  createdAt: string;
  readAt: string | null;
  isDemo: boolean;
}

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<N[]>([]);
  const [unread, setUnread] = useState(0);
  const [error, setError] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const d = await api<{ items: N[]; unread: number }>("/api/notifications");
      setItems(d.items.slice(0, 12));
      setUnread(d.unread);
      setError(false);
    } catch {
      setError(true);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 45_000);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const markAll = async () => {
    await api("/api/notifications/read", { body: { ids: "all" } }).catch(() => {});
    load();
  };
  const markOne = (id: string) => api("/api/notifications/read", { body: { ids: [id] } }).then(load).catch(() => {});

  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen((o) => !o)} className="relative grid h-9 w-9 place-items-center rounded-xl border border-line/60 text-muted transition hover:border-brand/50 hover:text-fg" aria-label={`Notifications (${unread} unread)`}>
        <Bell className="h-4 w-4" />
        {unread > 0 && <span className="absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-gold px-1 text-[10px] font-bold text-black">{unread > 99 ? "99+" : unread}</span>}
      </button>
      {open && (
        <div className="absolute right-0 z-40 mt-2 w-[min(92vw,380px)] overflow-hidden rounded-2xl border border-line/70 bg-surface shadow-2xl animate-fade-in">
          <div className="flex items-center justify-between border-b border-line/50 px-4 py-3">
            <span className="text-sm font-semibold">Notifications</span>
            <button onClick={markAll} disabled={!unread} className="inline-flex items-center gap-1 text-xs text-brand-strong hover:underline disabled:opacity-40">
              <CheckCheck className="h-3.5 w-3.5" /> Mark all read
            </button>
          </div>
          <div className="max-h-[60vh] overflow-y-auto">
            {error && <p className="px-4 py-6 text-center text-sm text-danger">Could not load notifications.</p>}
            {!error && items.length === 0 && <p className="px-4 py-8 text-center text-sm text-muted">You&apos;re all caught up.</p>}
            {items.map((n) => (
              <Link
                key={n.id}
                href={n.link ?? "/notifications"}
                onClick={() => {
                  setOpen(false);
                  if (!n.readAt) markOne(n.id);
                }}
                className={cn("flex gap-3 border-b border-line/30 px-4 py-3 transition hover:bg-surface-2", !n.readAt && "bg-brand/5")}
              >
                <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", n.severity === "critical" ? "bg-danger" : n.severity === "warning" ? "bg-warning" : "bg-brand-strong", n.readAt && "opacity-30")} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-fg">
                    {n.title} {n.isDemo && <span className="ml-1 text-[10px] uppercase text-gold">demo</span>}
                  </span>
                  <span className="block text-xs text-muted line-clamp-2">{n.message}</span>
                  <span className="mt-0.5 block text-[10px] text-subtle">{timeAgo(n.createdAt)}</span>
                </span>
              </Link>
            ))}
          </div>
          <Link href="/notifications" onClick={() => setOpen(false)} className="block border-t border-line/50 py-2.5 text-center text-xs font-medium text-brand-strong hover:bg-surface-2">
            View all notifications
          </Link>
        </div>
      )}
    </div>
  );
}
