"use client";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";

/** Re-fetches server data periodically (and on demand) — the dashboard's "live" mode. */
export function AutoRefresh({ seconds = 60, generatedAt }: { seconds?: number; generatedAt: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [, force] = useState(0);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  useEffect(() => {
    const t = setInterval(() => document.visibilityState === "visible" && start(() => router.refresh()), seconds * 1000);
    const tick = setInterval(() => force((x) => x + 1), 15_000);
    return () => {
      clearInterval(t);
      clearInterval(tick);
    };
  }, [router, seconds]);
  const ago = Math.max(0, Math.round((Date.now() - new Date(generatedAt).getTime()) / 1000));
  return (
    <button onClick={() => start(() => router.refresh())} className="inline-flex items-center gap-2 rounded-xl border border-line/60 px-3 py-2 text-xs text-muted hover:border-brand/50 hover:text-fg" title={`Auto-refreshes every ${seconds}s`}>
      <RefreshCw className={`h-3.5 w-3.5 ${pending ? "animate-spin text-brand-strong" : ""}`} />
      {pending ? "Refreshing…" : !mounted ? "Live" : `Updated ${ago < 60 ? `${ago}s` : `${Math.round(ago / 60)}m`} ago`}
    </button>
  );
}
