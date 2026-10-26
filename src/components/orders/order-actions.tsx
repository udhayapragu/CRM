"use client";
import { useState } from "react";
import { CalendarClock, CheckCheck, CreditCard, MessageSquarePlus, Network, Repeat } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { Modal } from "@/components/ui/modal";
import { useAction } from "@/components/use-action";
import { humanize } from "@/lib/utils";

export function StatusChangeButton({ orderId, allowed }: { orderId: string; allowed: string[] }) {
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState(allowed[0] ?? "");
  const [note, setNote] = useState("");
  const { run, busy } = useAction();
  if (!allowed.length) return null;
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}><Repeat className="h-4 w-4" /> Change status</Button>
      <Modal size="sm" open={open} onClose={() => setOpen(false)} title="Change order status" description="Dispatched, Delivered and Returned can only be set through the dispatch and returns workflows." footer={<><Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button variant={to === "CANCELLED" ? "danger" : "primary"} loading={busy} onClick={async () => (await run(`/api/orders/${orderId}/status`, { body: { status: to, note: note || undefined }, success: `Status changed to ${humanize(to)}` })) && setOpen(false)}>Update status</Button></>}>
        <div className="grid gap-4">
          <Field label="New status"><Select value={to} onChange={(e) => setTo(e.target.value)}>{allowed.map((s) => <option key={s} value={s}>{humanize(s)}</option>)}</Select></Field>
          {to === "CANCELLED" && <p className="rounded-xl border border-danger/30 bg-danger/10 p-2 text-xs text-danger">Cancelling releases reserved stock and unpacks undispatched shipments.</p>}
          <Field label="Note"><Textarea value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        </div>
      </Modal>
    </>
  );
}

export function PaymentChangeButton({ orderId, current }: { orderId: string; current: string }) {
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState(current);
  const [note, setNote] = useState("");
  const { run, busy } = useAction();
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}><CreditCard className="h-4 w-4" /> Payment</Button>
      <Modal size="sm" open={open} onClose={() => setOpen(false)} title="Update payment status" description="E.g. mark a cash-on-delivery order as paid once cash is received." footer={<><Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button loading={busy} onClick={async () => (await run(`/api/orders/${orderId}/payment`, { body: { paymentStatus: to, note: note || undefined }, success: "Payment status updated" })) && setOpen(false)}>Save</Button></>}>
        <div className="grid gap-4">
          <Field label="Payment status"><Select value={to} onChange={(e) => setTo(e.target.value)}>{["UNPAID", "PENDING", "PAID", "FAILED", "PARTIALLY_REFUNDED", "REFUNDED"].map((s) => <option key={s} value={s}>{humanize(s)}</option>)}</Select></Field>
          <Field label="Reference / note"><Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Receipt or transaction reference" /></Field>
        </div>
      </Modal>
    </>
  );
}

export function NoteForm({ orderId }: { orderId: string }) {
  const [note, setNote] = useState("");
  const { run, busy } = useAction();
  return (
    <form className="flex gap-2" onSubmit={async (e) => { e.preventDefault(); if (note.trim() && (await run(`/api/orders/${orderId}/notes`, { body: { note }, success: "Note added" }))) setNote(""); }}>
      <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a note to the timeline…" aria-label="Note" />
      <Button type="submit" variant="secondary" loading={busy} disabled={!note.trim()}><MessageSquarePlus className="h-4 w-4" /></Button>
    </form>
  );
}

export function DetailsEditor({ orderId, expected, notes }: { orderId: string; expected: string | null; notes: string | null }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ expected: expected ? expected.slice(0, 10) : "", notes: notes ?? "" });
  const { run, busy } = useAction();
  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}><CalendarClock className="h-3.5 w-3.5" /> Edit dispatch date & notes</Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Fulfilment details" description="CRM-only fields — never overwritten by WordPress sync." footer={<><Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button loading={busy} onClick={async () => (await run(`/api/orders/${orderId}`, { method: "PATCH", body: { expectedDispatchDate: f.expected ? new Date(f.expected + "T18:00:00").toISOString() : null, internalNotes: f.notes || null }, success: "Saved" })) && setOpen(false)}>Save</Button></>}>
        <div className="grid gap-4">
          <Field label="Expected dispatch date"><Input type="date" value={f.expected} onChange={(e) => setF({ ...f, expected: e.target.value })} /></Field>
          <Field label="Internal notes"><Textarea value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
        </div>
      </Modal>
    </>
  );
}

export function ResolveAttentionButton({ orderId }: { orderId: string }) {
  const { run, busy } = useAction();
  return <Button size="sm" variant="secondary" loading={busy} onClick={() => run(`/api/orders/${orderId}/resolve`, { success: "Marked as resolved" })}><CheckCheck className="h-3.5 w-3.5" /> Mark resolved</Button>;
}

export function AttributeMemberButton({ orderId, members, current }: { orderId: string; members: { id: string; name: string; referralCode: string }[]; current: string | null }) {
  const [open, setOpen] = useState(false);
  const [memberId, setMemberId] = useState(current ?? "");
  const { run, busy } = useAction();
  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}><Network className="h-3.5 w-3.5" /> {current ? "Change seller" : "Attribute to member"}</Button>
      <Modal size="sm" open={open} onClose={() => setOpen(false)} title="Attribute sale to a member" description="Commissions are only calculated on verified sales under legally reviewed rules." footer={<><Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button loading={busy} onClick={async () => (await run(`/api/orders/${orderId}/member`, { body: { memberId: memberId || null }, success: "Attribution saved" })) && setOpen(false)}>Save</Button></>}>
        <Field label="Selling member"><Select value={memberId} onChange={(e) => setMemberId(e.target.value)}><option value="">None</option>{members.map((m) => <option key={m.id} value={m.id}>{m.name} ({m.referralCode})</option>)}</Select></Field>
      </Modal>
    </>
  );
}
