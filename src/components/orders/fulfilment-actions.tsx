"use client";
import { useState } from "react";
import { CheckCircle2, PackageCheck, RotateCcw, Truck, Undo2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { Modal } from "@/components/ui/modal";
import { useAction } from "@/components/use-action";

export interface LineInfo { id: string; name: string; sku: string | null; quantity: number; packedQty: number; dispatchedQty: number; returnedQty: number }

const COURIERS = ["Blue Dart", "Delhivery", "DTDC", "Ecom Express", "India Post", "Shiprocket", "Xpressbees", "Own delivery"];
const localNow = () => {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
};

export function PackButton({ orderId, lines, size = "md" }: { orderId: string; lines: LineInfo[]; size?: "sm" | "md" }) {
  const [open, setOpen] = useState(false);
  const remaining = lines.map((l) => ({ ...l, left: l.quantity - l.packedQty }));
  const [qty, setQty] = useState<Record<string, string>>(Object.fromEntries(remaining.map((l) => [l.id, String(l.left)])));
  const [notes, setNotes] = useState("");
  const { run, busy } = useAction();
  if (remaining.every((l) => l.left <= 0)) return null;
  return (
    <>
      <Button size={size} onClick={() => setOpen(true)}><PackageCheck className="h-4 w-4" /> Pack</Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Record packed quantities" description="Packing creates a shipment. Stock is deducted only when the shipment is dispatched." footer={<><Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button loading={busy} onClick={async () => (await run(`/api/orders/${orderId}/pack`, { body: { lines: remaining.map((l) => ({ orderItemId: l.id, quantity: Number(qty[l.id]) || 0 })), notes: notes || undefined }, success: "Packed — shipment ready to dispatch" })) && setOpen(false)}>Confirm packed</Button></>}>
        <div className="space-y-3">
          {remaining.map((l) => (
            <div key={l.id} className="flex items-center gap-3 rounded-xl border border-line/50 p-3">
              <div className="min-w-0 flex-1"><div className="truncate text-sm font-medium">{l.name}</div><div className="text-xs text-muted">{l.left} of {l.quantity} left to pack</div></div>
              <Input type="number" min={0} max={l.left} className="w-24" value={qty[l.id]} disabled={l.left <= 0} onChange={(e) => setQty({ ...qty, [l.id]: e.target.value })} aria-label={`Packed quantity for ${l.name}`} />
            </div>
          ))}
          <Field label="Packing notes"><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Box size, gift wrap, batch numbers…" /></Field>
        </div>
      </Modal>
    </>
  );
}

export function DispatchButton({ shipmentId, size = "md" }: { shipmentId: string; size?: "sm" | "md" }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ courier: COURIERS[0], customCourier: "", trackingNumber: "", trackingUrl: "", dispatchedAt: localNow(), expectedDeliveryAt: "", notes: "", awaitingPickup: false });
  const { run, busy } = useAction();
  const submit = async () => {
    const courier = f.courier === "__other" ? f.customCourier : f.courier;
    const res = await run(`/api/shipments/${shipmentId}/dispatch`, {
      body: { courier, trackingNumber: f.trackingNumber || undefined, trackingUrl: f.trackingUrl || undefined, dispatchedAt: new Date(f.dispatchedAt).toISOString(), expectedDeliveryAt: f.expectedDeliveryAt ? new Date(f.expectedDeliveryAt + "T18:00:00").toISOString() : null, notes: f.notes || undefined, awaitingPickup: f.awaitingPickup },
      success: "Dispatched — stock deducted in the ledger",
    });
    if (res) setOpen(false);
  };
  return (
    <>
      <Button size={size} variant="gold" onClick={() => setOpen(true)}><Truck className="h-4 w-4" /> Dispatch</Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Dispatch shipment" description="Records courier and tracking, and deducts the product (plus packaging per rules) from physical stock exactly once." footer={<><Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button variant="gold" loading={busy} disabled={f.courier === "__other" && !f.customCourier} onClick={submit}>Confirm dispatch</Button></>}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Courier / transport" required>
            <Select value={f.courier} onChange={(e) => setF({ ...f, courier: e.target.value })}>{COURIERS.map((c) => <option key={c}>{c}</option>)}<option value="__other">Other…</option></Select>
          </Field>
          {f.courier === "__other" && <Field label="Courier name" required><Input value={f.customCourier} onChange={(e) => setF({ ...f, customCourier: e.target.value })} /></Field>}
          <Field label="Tracking number"><Input value={f.trackingNumber} onChange={(e) => setF({ ...f, trackingNumber: e.target.value })} /></Field>
          <Field label="Tracking URL"><Input type="url" value={f.trackingUrl} onChange={(e) => setF({ ...f, trackingUrl: e.target.value })} placeholder="https://" /></Field>
          <Field label="Dispatch date & time" required><Input type="datetime-local" value={f.dispatchedAt} onChange={(e) => setF({ ...f, dispatchedAt: e.target.value })} /></Field>
          <Field label="Expected delivery"><Input type="date" value={f.expectedDeliveryAt} onChange={(e) => setF({ ...f, expectedDeliveryAt: e.target.value })} /></Field>
          <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={f.awaitingPickup} onChange={(e) => setF({ ...f, awaitingPickup: e.target.checked })} className="accent-[rgb(var(--brand))]" /> Booked, awaiting courier pickup</label>
          <Field label="Shipment notes" className="sm:col-span-2"><Textarea value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
        </div>
      </Modal>
    </>
  );
}

export function PickupButton({ shipmentId, size = "md" }: { shipmentId: string; size?: "sm" | "md" }) {
  const { run, busy } = useAction();
  return <Button size={size} variant="secondary" loading={busy} onClick={() => run(`/api/shipments/${shipmentId}/pickup`, { success: "Marked as picked up — in transit" })}><Truck className="h-4 w-4" /> Picked up</Button>;
}

export function DeliverButton({ shipmentId, size = "md" }: { shipmentId: string; size?: "sm" | "md" }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ deliveredAt: localNow(), note: "" });
  const { run, busy } = useAction();
  return (
    <>
      <Button size={size} variant="secondary" onClick={() => setOpen(true)}><CheckCircle2 className="h-4 w-4 text-success" /> Confirm delivery</Button>
      <Modal size="sm" open={open} onClose={() => setOpen(false)} title="Confirm delivery" description="Only confirm once delivery is verified (courier proof or customer confirmation)." footer={<><Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button loading={busy} onClick={async () => (await run(`/api/shipments/${shipmentId}/deliver`, { body: { deliveredAt: new Date(f.deliveredAt).toISOString(), note: f.note || undefined }, success: "Delivery confirmed" })) && setOpen(false)}>Confirm delivered</Button></>}>
        <div className="grid gap-4">
          <Field label="Delivered at"><Input type="datetime-local" value={f.deliveredAt} onChange={(e) => setF({ ...f, deliveredAt: e.target.value })} /></Field>
          <Field label="Proof / note" hint="e.g. POD reference, receiver name"><Input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
        </div>
      </Modal>
    </>
  );
}

export function CancelShipmentButton({ shipmentId, size = "md" }: { shipmentId: string; size?: "sm" | "md" }) {
  const { run, busy } = useAction();
  return <Button size={size} variant="ghost" loading={busy} onClick={() => confirm("Unpack this shipment? Packed quantities will be released.") && run(`/api/shipments/${shipmentId}/cancel`, { success: "Shipment cancelled" })}><XCircle className="h-4 w-4" /> Unpack</Button>;
}

export function ReturnButton({ orderId, lines }: { orderId: string; lines: LineInfo[] }) {
  const returnable = lines.filter((l) => l.dispatchedQty - l.returnedQty > 0);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [rows, setRows] = useState<Record<string, { qty: string; condition: "RESTOCK" | "DAMAGED" }>>(Object.fromEntries(returnable.map((l) => [l.id, { qty: "0", condition: "RESTOCK" as const }])));
  const { run, busy } = useAction();
  if (!returnable.length) return null;
  return (
    <>
      <Button variant="danger" onClick={() => setOpen(true)}><Undo2 className="h-4 w-4" /> Record return</Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Record a return" description="Restocked units go back to sellable stock; damaged units are returned and written off — both are ledger entries." footer={<><Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button variant="danger" loading={busy} disabled={reason.trim().length < 3} onClick={async () => (await run(`/api/orders/${orderId}/return`, { body: { reason, lines: returnable.map((l) => ({ orderItemId: l.id, quantity: Number(rows[l.id].qty) || 0, condition: rows[l.id].condition })) }, success: "Return recorded" })) && setOpen(false)}>Record return</Button></>}>
        <div className="space-y-3">
          {returnable.map((l) => (
            <div key={l.id} className="grid grid-cols-12 items-center gap-2 rounded-xl border border-line/50 p-3">
              <div className="col-span-12 sm:col-span-6"><div className="text-sm font-medium">{l.name}</div><div className="text-xs text-muted">{l.dispatchedQty - l.returnedQty} returnable</div></div>
              <Input className="col-span-4 sm:col-span-2" type="number" min={0} max={l.dispatchedQty - l.returnedQty} value={rows[l.id].qty} onChange={(e) => setRows({ ...rows, [l.id]: { ...rows[l.id], qty: e.target.value } })} aria-label="Returned quantity" />
              <Select className="col-span-8 sm:col-span-4" value={rows[l.id].condition} onChange={(e) => setRows({ ...rows, [l.id]: { ...rows[l.id], condition: e.target.value as "RESTOCK" | "DAMAGED" } })}><option value="RESTOCK">Restock (sellable)</option><option value="DAMAGED">Damaged (write off)</option></Select>
            </div>
          ))}
          <Field label="Reason" required><Textarea value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        </div>
      </Modal>
    </>
  );
}

export { RotateCcw };
