"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { KeyRound, LogOut } from "lucide-react";
import { api } from "@/lib/client-api";

export function UserMenu({ name, email, roleLabel }: { name: string; email: string; roleLabel: string }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDoc = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);
  const initials = name.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase();
  const logout = async () => {
    setBusy(true);
    await api("/api/auth/logout", { method: "POST" }).catch(() => {});
    window.location.href = "/login";
  };
  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-2 rounded-xl border border-line/60 py-1 pl-1 pr-2 transition hover:border-gold/40" aria-label="Account menu">
        <span className="grid h-7 w-7 place-items-center rounded-lg bg-gradient-to-br from-brand to-brand-soft text-[11px] font-bold text-white">{initials}</span>
        <span className="hidden text-left leading-tight md:block">
          <span className="block max-w-[140px] truncate text-xs font-medium">{name}</span>
          <span className="block text-[10px] text-gold">{roleLabel}</span>
        </span>
      </button>
      {open && (
        <div className="absolute right-0 z-40 mt-2 w-60 overflow-hidden rounded-2xl border border-line/70 bg-surface shadow-2xl animate-fade-in">
          <div className="border-b border-line/50 px-4 py-3">
            <div className="truncate text-sm font-medium">{name}</div>
            <div className="truncate text-xs text-muted">{email}</div>
          </div>
          <Link href="/account" onClick={() => setOpen(false)} className="flex items-center gap-2 px-4 py-2.5 text-sm text-muted hover:bg-surface-2 hover:text-fg">
            <KeyRound className="h-4 w-4" /> Change password
          </Link>
          <button onClick={logout} disabled={busy} className="flex w-full items-center gap-2 px-4 py-2.5 text-sm text-danger hover:bg-surface-2">
            <LogOut className="h-4 w-4" /> {busy ? "Signing out…" : "Sign out"}
          </button>
        </div>
      )}
    </div>
  );
}
