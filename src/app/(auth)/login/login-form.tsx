"use client";
import { useState } from "react";
import { Lock, Mail } from "lucide-react";
import { api } from "@/lib/client-api";
import { Button } from "@/components/ui/button";

export function LoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/api/auth/login", { body: { email, password } });
      window.location.href = "/dashboard";
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };
  return (
    <form onSubmit={submit} className="card space-y-4 p-6 sm:p-8">
      <label className="block">
        <span className="label">Email</span>
        <div className="relative">
          <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" />
          <input type="email" required autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} className="input pl-9" placeholder="you@company.com" />
        </div>
      </label>
      <label className="block">
        <span className="label">Password</span>
        <div className="relative">
          <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" />
          <input type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className="input pl-9" placeholder="••••••••••" />
        </div>
      </label>
      {error && <p role="alert" className="rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
      <Button type="submit" variant="gold" size="lg" loading={busy} className="w-full justify-center">
        Sign in
      </Button>
      <p className="text-center text-[11px] text-subtle">Accounts are created by your Super Admin. Repeated failed attempts lock the account for 15 minutes.</p>
    </form>
  );
}
