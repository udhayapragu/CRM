"use client";
import { useState } from "react";
import { api } from "@/lib/client-api";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";

export function SetupForm({ requireToken }: { requireToken: boolean }) {
  const [f, setF] = useState({ name: "", email: "", password: "", confirm: "", setupToken: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (f.password !== f.confirm) return setError("Passwords do not match");
    setBusy(true);
    setError(null);
    try {
      await api("/api/setup", { body: { name: f.name, email: f.email, password: f.password, setupToken: f.setupToken || undefined } });
      window.location.href = "/settings/general?welcome=1";
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };
  return (
    <form onSubmit={submit} className="card space-y-4 p-6 sm:p-8">
      <Field label="Full name" required><Input required value={f.name} onChange={set("name")} autoComplete="name" /></Field>
      <Field label="Email" required><Input type="email" required value={f.email} onChange={set("email")} autoComplete="username" /></Field>
      <Field label="Password" required hint="At least 10 characters, with letters and numbers."><Input type="password" required minLength={10} value={f.password} onChange={set("password")} autoComplete="new-password" /></Field>
      <Field label="Confirm password" required><Input type="password" required value={f.confirm} onChange={set("confirm")} autoComplete="new-password" /></Field>
      {requireToken && (
        <Field label="Setup token" required hint="The SETUP_TOKEN value configured on the server.">
          <Input type="password" required value={f.setupToken} onChange={set("setupToken")} />
        </Field>
      )}
      {error && <p role="alert" className="rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
      <Button type="submit" variant="gold" size="lg" loading={busy} className="w-full justify-center">Create Super Admin</Button>
      <p className="text-center text-[11px] text-subtle">Next you can explore with clearly-labelled demo data, or connect your WordPress website.</p>
    </form>
  );
}
