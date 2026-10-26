"use client";
import { useState } from "react";
import { FlaskConical, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/form";
import { useAction } from "@/components/use-action";
import type { AppSettings } from "@/server/services/settings";

export function SettingsForm({ settings }: { settings: AppSettings }) {
  const [f, setF] = useState({ ...settings, dispatchSlaDays: String(settings.dispatchSlaDays), defaultLowStockThreshold: String(settings.defaultLowStockThreshold) });
  const { run, busy } = useAction();
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Business name"><Input value={f.businessName} onChange={(e) => setF({ ...f, businessName: e.target.value })} /></Field>
      <Field label="Currency (ISO code)"><Input value={f.currency} maxLength={3} onChange={(e) => setF({ ...f, currency: e.target.value.toUpperCase() })} /></Field>
      <Field label="Dispatch SLA (days after order)" hint="Used to set the expected dispatch date of newly imported orders"><Input type="number" min={0} value={f.dispatchSlaDays} onChange={(e) => setF({ ...f, dispatchSlaDays: e.target.value })} /></Field>
      <Field label="Default low-stock threshold" hint="Applied to newly synced products (CRM-owned)"><Input type="number" min={0} value={f.defaultLowStockThreshold} onChange={(e) => setF({ ...f, defaultLowStockThreshold: e.target.value })} /></Field>
      <Button className="justify-self-start" loading={busy} onClick={() => run("/api/settings", { method: "PATCH", body: { businessName: f.businessName, currency: f.currency, dispatchSlaDays: Number(f.dispatchSlaDays), defaultLowStockThreshold: Number(f.defaultLowStockThreshold) }, success: "Settings saved" })}>Save settings</Button>
    </div>
  );
}

export function DemoControls({ demoPresent, liveConnected }: { demoPresent: boolean; liveConnected: boolean }) {
  const { run, busy } = useAction();
  return demoPresent ? (
    <div>
      <p className="mb-3 text-sm text-muted">Demo data is currently loaded and labelled throughout the app. Clearing removes every demo product, order, stock item, ledger entry, supplier, onboarding item and member. Your users, settings and WordPress connection are kept.</p>
      <Button variant="danger" loading={busy} onClick={() => confirm("Permanently remove all demo data?") && run("/api/demo", { method: "DELETE", success: "Demo data cleared — you can now enable WordPress sync" })}><Trash2 className="h-4 w-4" /> Clear demo data</Button>
    </div>
  ) : (
    <div>
      <p className="mb-3 text-sm text-muted">Explore every module with realistic sample data before connecting your website. Demo records are flagged and visibly labelled, and must be cleared before real data can be synchronised.</p>
      <Button variant="gold" loading={busy} disabled={liveConnected} onClick={() => run("/api/demo", { method: "POST", success: "Demo environment loaded" })}><FlaskConical className="h-4 w-4" /> Load demo data</Button>
      {liveConnected && <p className="mt-2 text-xs text-subtle">Unavailable while a live WordPress connection is enabled.</p>}
    </div>
  );
}

export function MlmToggle({ enabled, trigger }: { enabled: boolean; trigger: string }) {
  const [t, setT] = useState(trigger);
  const { run, busy } = useAction();
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">Optional direct-selling module (members, referral codes, sales-based commissions). It is separate from inventory and WordPress sync and is not needed to run the CRM.</p>
      <Field label="Commission becomes eligible when" hint="Delivered is safer: fewer clawbacks from cancellations/returns"><Select value={t} onChange={(e) => setT(e.target.value)}><option value="DELIVERED">Order is paid AND delivered</option><option value="PAID">Order is paid</option></Select></Field>
      <div className="flex gap-2">
        <Button variant={enabled ? "danger" : "primary"} loading={busy} onClick={() => run("/api/settings", { method: "PATCH", body: { mlmEnabled: !enabled, mlmCommissionTrigger: t }, success: enabled ? "MLM module disabled" : "MLM module enabled" })}>{enabled ? "Disable module" : "Enable module"}</Button>
        {enabled && <Button variant="secondary" loading={busy} onClick={() => run("/api/settings", { method: "PATCH", body: { mlmCommissionTrigger: t }, success: "Saved" })}>Save</Button>}
      </div>
    </div>
  );
}

export function StagesEditor({ stages }: { stages: { id: string; name: string; color: string; position: number }[] }) {
  const [name, setName] = useState("");
  const { run, busy } = useAction();
  return (
    <div>
      <ul className="space-y-2">
        {stages.map((s) => (
          <li key={s.id} className="flex items-center gap-3">
            <input type="color" defaultValue={s.color} onBlur={(e) => e.target.value !== s.color && run(`/api/onboarding/stages/${s.id}`, { method: "PATCH", body: { color: e.target.value } })} className="h-8 w-8 cursor-pointer rounded border border-line bg-transparent" aria-label={`${s.name} colour`} />
            <Input defaultValue={s.name} onBlur={(e) => e.target.value.trim() && e.target.value !== s.name && run(`/api/onboarding/stages/${s.id}`, { method: "PATCH", body: { name: e.target.value.trim() }, success: "Stage renamed" })} aria-label="Stage name" />
            <Input type="number" className="w-20" defaultValue={s.position} onBlur={(e) => Number(e.target.value) !== s.position && run(`/api/onboarding/stages/${s.id}`, { method: "PATCH", body: { position: Number(e.target.value) } })} aria-label="Order" />
          </li>
        ))}
      </ul>
      <form className="mt-3 flex gap-2" onSubmit={async (e) => { e.preventDefault(); if (await run("/api/onboarding/stages", { body: { name }, success: "Stage added" })) setName(""); }}>
        <Input placeholder="New stage name…" value={name} onChange={(e) => setName(e.target.value)} />
        <Button type="submit" variant="secondary" loading={busy} disabled={name.trim().length < 2}><Plus className="h-4 w-4" /> Add</Button>
      </form>
    </div>
  );
}
