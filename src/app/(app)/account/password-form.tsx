"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";
import { useAction } from "@/components/use-action";

export function PasswordForm() {
  const [f, setF] = useState({ current: "", next: "", confirm: "" });
  const { run, busy } = useAction();
  const mismatch = f.confirm.length > 0 && f.next !== f.confirm;
  return (
    <form className="grid gap-4" onSubmit={async (e) => { e.preventDefault(); if (await run("/api/me/password", { body: { current: f.current, next: f.next }, success: "Password changed" })) setF({ current: "", next: "", confirm: "" }); }}>
      <Field label="Current password"><Input type="password" autoComplete="current-password" value={f.current} onChange={(e) => setF({ ...f, current: e.target.value })} /></Field>
      <Field label="New password" hint="At least 10 characters with letters and numbers"><Input type="password" autoComplete="new-password" value={f.next} onChange={(e) => setF({ ...f, next: e.target.value })} /></Field>
      <Field label="Confirm new password" error={mismatch ? "Passwords do not match" : null}><Input type="password" autoComplete="new-password" value={f.confirm} onChange={(e) => setF({ ...f, confirm: e.target.value })} /></Field>
      <Button type="submit" loading={busy} disabled={!f.current || f.next.length < 10 || mismatch} className="justify-self-start">Update password</Button>
    </form>
  );
}
