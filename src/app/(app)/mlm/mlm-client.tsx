"use client";
import { useState } from "react";
import { BadgeCheck, Plus, ShieldAlert, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { Modal } from "@/components/ui/modal";
import { useAction } from "@/components/use-action";
import { formatMoney } from "@/lib/utils";

export function NewMemberButton() {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ name: "", email: "", phone: "", sponsorCode: "", notes: "" });
  const { run, busy } = useAction();
  return (
    <>
      <Button variant="gold" onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> Register member</Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Register member" description="Registration is free and never generates a commission for anyone." footer={<><Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button loading={busy} disabled={f.name.length < 2} onClick={async () => { if (await run("/api/mlm/members", { body: { ...f, sponsorCode: f.sponsorCode || null }, success: "Member registered (status: pending)" })) { setOpen(false); setF({ name: "", email: "", phone: "", sponsorCode: "", notes: "" }); } }}>Register</Button></>}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Full name" required className="sm:col-span-2"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="Email"><Input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
          <Field label="Phone"><Input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
          <Field label="Sponsor referral code" className="sm:col-span-2"><Input value={f.sponsorCode} onChange={(e) => setF({ ...f, sponsorCode: e.target.value.toUpperCase() })} /></Field>
          <Field label="Notes" className="sm:col-span-2"><Textarea value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
        </div>
      </Modal>
    </>
  );
}

export function MemberStatusSelect({ id, status }: { id: string; status: string }) {
  const { run, busy } = useAction();
  return (
    <select disabled={busy} value={status} onChange={(e) => run(`/api/mlm/members/${id}`, { method: "PATCH", body: { status: e.target.value }, success: "Status updated" })} className="rounded-lg border border-line/60 bg-surface-2 px-2 py-1 text-xs" aria-label="Member status">
      {["PENDING", "ACTIVE", "INACTIVE", "SUSPENDED"].map((s) => <option key={s}>{s}</option>)}
    </select>
  );
}

export function RuleEditor({ rule }: { rule?: { id: string; name: string; level: number; ratePercent: number; active: boolean; legallyReviewed: boolean; reviewedBy: string | null; notes: string | null } }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ name: rule?.name ?? "", level: String(rule?.level ?? 1), ratePercent: String(rule?.ratePercent ?? 5), active: rule?.active ?? false, legallyReviewed: rule?.legallyReviewed ?? false, reviewedBy: rule?.reviewedBy ?? "", notes: rule?.notes ?? "" });
  const { run, busy } = useAction();
  return (
    <>
      {rule ? <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>Edit</Button> : <Button variant="gold" onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> New rule</Button>}
      <Modal open={open} onClose={() => setOpen(false)} title={rule ? "Edit commission rule" : "New commission rule"} description="Rules pay a percentage of verified product sales only. A rule cannot be activated until it is marked as legally reviewed." footer={<><Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button loading={busy} onClick={async () => (await run(rule ? `/api/mlm/rules/${rule.id}` : "/api/mlm/rules", { method: rule ? "PATCH" : "POST", body: { ...f, level: Number(f.level), ratePercent: Number(f.ratePercent), reviewedBy: f.reviewedBy || null, notes: f.notes || null }, success: "Rule saved" })) && setOpen(false)}>Save</Button></>}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Rule name" className="sm:col-span-2"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. Personal retail sale" /></Field>
          <Field label="Level" hint="1 = the selling member, 2 = their sponsor…"><Input type="number" min={1} max={10} value={f.level} onChange={(e) => setF({ ...f, level: e.target.value })} /></Field>
          <Field label="Rate (% of eligible sale)"><Input type="number" min={0} max={50} step="0.01" value={f.ratePercent} onChange={(e) => setF({ ...f, ratePercent: e.target.value })} /></Field>
          <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={f.legallyReviewed} onChange={(e) => setF({ ...f, legallyReviewed: e.target.checked, active: e.target.checked ? f.active : false })} className="accent-[rgb(var(--gold))]" /> This rule has been reviewed by a qualified legal advisor</label>
          {f.legallyReviewed && <Field label="Reviewed by" className="sm:col-span-2"><Input value={f.reviewedBy} onChange={(e) => setF({ ...f, reviewedBy: e.target.value })} placeholder="Advisor / firm, reference" /></Field>}
          <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={f.active} disabled={!f.legallyReviewed} onChange={(e) => setF({ ...f, active: e.target.checked })} className="accent-[rgb(var(--brand))]" /> Active</label>
          <Field label="Notes" className="sm:col-span-2"><Textarea value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
        </div>
      </Modal>
    </>
  );
}

export function CommissionTable({ rows, canApprove }: { rows: { id: string; createdAt: string; member: string; code: string; order: string; orderId: string; rule: string; level: number; base: number; rate: number; amount: number; status: string; note: string | null }[]; canApprove: boolean }) {
  const [sel, setSel] = useState<string[]>([]);
  const { run, busy } = useAction();
  const pending = rows.filter((r) => r.status === "PENDING");
  return (
    <div>
      {canApprove && (
        <div className="mb-3 flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={() => setSel(sel.length ? [] : pending.map((p) => p.id))}>{sel.length ? "Clear selection" : `Select all pending (${pending.length})`}</Button>
          <Button size="sm" loading={busy} disabled={!sel.length} onClick={async () => (await run("/api/mlm/commissions", { body: { ids: sel, to: "APPROVED" }, success: "Approved" })) && setSel([])}><BadgeCheck className="h-3.5 w-3.5" /> Approve ({sel.length})</Button>
          <Button size="sm" variant="danger" loading={busy} disabled={!sel.length} onClick={async () => confirm("Void the selected commissions?") && (await run("/api/mlm/commissions", { body: { ids: sel, to: "VOID" }, success: "Voided" })) && setSel([])}>Void</Button>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="table-base">
          <thead><tr>{canApprove && <th />}<th>Date</th><th>Member</th><th>Order</th><th>Rule</th><th className="text-right">Eligible sale</th><th className="text-right">Rate</th><th className="text-right">Commission</th><th>Status</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                {canApprove && <td><input type="checkbox" disabled={r.status !== "PENDING"} checked={sel.includes(r.id)} onChange={(e) => setSel(e.target.checked ? [...sel, r.id] : sel.filter((x) => x !== r.id))} aria-label="Select commission" /></td>}
                <td className="whitespace-nowrap text-xs text-muted">{new Date(r.createdAt).toLocaleDateString("en-IN")}</td>
                <td className="text-sm">{r.member} <span className="font-mono text-[10px] text-subtle">{r.code}</span></td>
                <td><a href={`/orders/${r.orderId}`} className="text-sm hover:text-brand-strong">#{r.order}</a></td>
                <td className="text-xs text-muted" title={r.note ?? ""}>L{r.level} · {r.rule}</td>
                <td className="text-right tabular-nums">{formatMoney(r.base)}</td>
                <td className="text-right tabular-nums">{r.rate}%</td>
                <td className={`text-right font-medium tabular-nums ${r.amount < 0 ? "text-danger" : ""}`}>{formatMoney(r.amount)}</td>
                <td><Badge tone={r.status === "PAID" ? "success" : r.status === "APPROVED" ? "gold" : r.status === "VOID" ? "neutral" : "warning"}>{r.status.toLowerCase()}</Badge></td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={9} className="py-10 text-center text-sm text-muted">No commissions yet. Commissions appear only for verified sales attributed to active members, under active and legally reviewed rules.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function PayoutButton({ memberId, amount }: { memberId: string; amount: number }) {
  const [open, setOpen] = useState(false);
  const [ref, setRef] = useState("");
  const { run, busy } = useAction();
  return (
    <>
      <Button size="sm" variant="gold" disabled={amount <= 0} onClick={() => setOpen(true)}><Wallet className="h-3.5 w-3.5" /> Pay {formatMoney(amount)}</Button>
      <Modal size="sm" open={open} onClose={() => setOpen(false)} title="Record payout" description="Marks all approved commissions (net of clawbacks) for this member as paid." footer={<><Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button loading={busy} onClick={async () => (await run("/api/mlm/payouts", { body: { memberId, reference: ref || undefined }, success: "Payout recorded" })) && setOpen(false)}>Record payout</Button></>}>
        <Field label="Payment reference" hint="Bank / UPI transaction ID"><Input value={ref} onChange={(e) => setRef(e.target.value)} /></Field>
      </Modal>
    </>
  );
}

export function RecalculateButton() {
  const { run, busy } = useAction();
  return <Button variant="secondary" loading={busy} onClick={() => run("/api/mlm/recalculate", { success: "Commissions recalculated" })}>Recalculate</Button>;
}

export function ComplianceNotice() {
  return (
    <div className="mb-4 flex gap-3 rounded-2xl border border-warning/30 bg-warning/10 p-4 text-sm">
      <ShieldAlert className="h-5 w-5 shrink-0 text-warning" />
      <div className="text-muted">
        <b className="text-fg">Compliance guard-rails.</b> Commissions are calculated only from verified product sales, under rules marked as legally reviewed, and are reduced or clawed back for cancellations, returns and refunds. The system has no recruitment rewards, joining fees or mandatory purchases. Have your compensation plan reviewed by a lawyer familiar with direct-selling regulations in your jurisdiction before activating any rule.
      </div>
    </div>
  );
}

export { Select };
