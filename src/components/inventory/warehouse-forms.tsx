"use client";
import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { Modal } from "@/components/ui/modal";
import { useAction } from "@/components/use-action";
import type { ItemOption, Opt } from "./inventory-actions";

export function ReceiptButton({ items, suppliers, locations }: { items: ItemOption[]; suppliers: Opt[]; locations: Opt[] }) {
  const [open, setOpen] = useState(false);
  const [head, setHead] = useState({ supplierId: "", invoiceRef: "", receivedAt: new Date().toISOString().slice(0, 10), notes: "", locationId: "" });
  const [lines, setLines] = useState([{ itemId: "", quantity: "", unitCost: "" }]);
  const { run, busy } = useAction();
  const submit = async () => {
    const res = await run("/api/inventory/receipts", {
      body: {
        ...head,
        supplierId: head.supplierId || null,
        locationId: head.locationId || undefined,
        receivedAt: head.receivedAt ? new Date(head.receivedAt + "T12:00:00").toISOString() : undefined,
        lines: lines.filter((l) => l.itemId && Number(l.quantity) > 0).map((l) => ({ itemId: l.itemId, quantity: Number(l.quantity), unitCost: l.unitCost ? Number(l.unitCost) : null })),
      },
      success: "Goods received — stock added to the ledger",
    });
    if (res) {
      setOpen(false);
      setLines([{ itemId: "", quantity: "", unitCost: "" }]);
    }
  };
  return (
    <>
      <Button variant="gold" onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> Record goods received</Button>
      <Modal size="xl" open={open} onClose={() => setOpen(false)} title="Goods received note (GRN)" description="Records a purchase delivery and adds each line to stock." footer={<><Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button loading={busy} onClick={submit} disabled={!lines.some((l) => l.itemId && Number(l.quantity) > 0)}>Post receipt</Button></>}>
        <div className="grid gap-4 sm:grid-cols-4">
          <Field label="Supplier" className="sm:col-span-2"><Select value={head.supplierId} onChange={(e) => setHead({ ...head, supplierId: e.target.value })}><option value="">—</option>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>
          <Field label="Supplier invoice #"><Input value={head.invoiceRef} onChange={(e) => setHead({ ...head, invoiceRef: e.target.value })} /></Field>
          <Field label="Received on"><Input type="date" value={head.receivedAt} onChange={(e) => setHead({ ...head, receivedAt: e.target.value })} /></Field>
          {locations.length > 1 && <Field label="Into location" className="sm:col-span-2"><Select value={head.locationId} onChange={(e) => setHead({ ...head, locationId: e.target.value })}><option value="">Default</option>{locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</Select></Field>}
        </div>
        <div className="mt-5 space-y-2">
          <div className="grid grid-cols-12 gap-2 text-[11px] uppercase tracking-wider text-subtle"><span className="col-span-6">Item</span><span className="col-span-2">Qty</span><span className="col-span-3">Unit cost</span></div>
          {lines.map((l, i) => (
            <div key={i} className="grid grid-cols-12 gap-2">
              <Select className="col-span-6" value={l.itemId} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, itemId: e.target.value } : x)))}><option value="">Select item…</option>{items.map((it) => <option key={it.id} value={it.id}>{it.name} ({it.sku})</option>)}</Select>
              <Input className="col-span-2" type="number" min={1} value={l.quantity} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, quantity: e.target.value } : x)))} />
              <Input className="col-span-3" type="number" min={0} step="0.01" value={l.unitCost} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, unitCost: e.target.value } : x)))} placeholder="optional" />
              <button className="col-span-1 grid place-items-center rounded-lg text-subtle hover:text-danger" onClick={() => setLines(lines.length > 1 ? lines.filter((_, j) => j !== i) : lines)} aria-label="Remove line"><Trash2 className="h-4 w-4" /></button>
            </div>
          ))}
          <Button variant="ghost" size="sm" onClick={() => setLines([...lines, { itemId: "", quantity: "", unitCost: "" }])}><Plus className="h-3.5 w-3.5" /> Add line</Button>
        </div>
        <Field label="Notes" className="mt-4"><Textarea value={head.notes} onChange={(e) => setHead({ ...head, notes: e.target.value })} /></Field>
      </Modal>
    </>
  );
}

export function RuleButton({ products, materials }: { products: Opt[]; materials: ItemOption[] }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ productId: "", materialId: "", quantityPerUnit: "1", notes: "" });
  const { run, busy } = useAction();
  return (
    <>
      <Button variant="gold" onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> New rule</Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Packaging consumption rule" description="When one unit of the product is dispatched, this quantity of material is consumed from stock." footer={<><Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button loading={busy} disabled={!f.productId || !f.materialId} onClick={async () => (await run("/api/inventory/rules", { body: { ...f, quantityPerUnit: Number(f.quantityPerUnit) }, success: "Rule saved" })) && setOpen(false)}>Save rule</Button></>}>
        <div className="grid gap-4">
          <Field label="Product (dispatched)" required><Select value={f.productId} onChange={(e) => setF({ ...f, productId: e.target.value })}><option value="">Select product…</option>{products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>
          <Field label="Material (consumed)" required><Select value={f.materialId} onChange={(e) => setF({ ...f, materialId: e.target.value })}><option value="">Select material…</option>{materials.map((m) => <option key={m.id} value={m.id}>{m.name} ({m.sku})</option>)}</Select></Field>
          <Field label="Quantity per unit dispatched" required><Input type="number" min={1} value={f.quantityPerUnit} onChange={(e) => setF({ ...f, quantityPerUnit: e.target.value })} /></Field>
          <Field label="Notes"><Input value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
        </div>
      </Modal>
    </>
  );
}

export function DeleteRuleButton({ id }: { id: string }) {
  const { run, busy } = useAction();
  return <Button variant="ghost" size="sm" loading={busy} onClick={() => confirm("Remove this rule? Future dispatches will no longer consume this material.") && run(`/api/inventory/rules/${id}`, { method: "DELETE", success: "Rule removed" })}><Trash2 className="h-3.5 w-3.5" /> Remove</Button>;
}

type SupplierForm = { name: string; contactName: string; email: string; phone: string; address: string; gstOrTaxId: string; notes: string };
const emptySupplier: SupplierForm = { name: "", contactName: "", email: "", phone: "", address: "", gstOrTaxId: "", notes: "" };

export function SupplierButton({ supplier }: { supplier?: SupplierForm & { id: string } }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState<SupplierForm>(supplier ?? emptySupplier);
  const { run, busy } = useAction();
  const set = (k: keyof SupplierForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <>
      {supplier ? <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>Edit</Button> : <Button variant="gold" onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> New supplier</Button>}
      <Modal open={open} onClose={() => setOpen(false)} title={supplier ? "Edit supplier" : "New supplier"} footer={<><Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button loading={busy} disabled={!f.name} onClick={async () => (await run(supplier ? `/api/suppliers/${supplier.id}` : "/api/suppliers", { method: supplier ? "PATCH" : "POST", body: f, success: "Supplier saved" })) && setOpen(false)}>Save</Button></>}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Company name" required className="sm:col-span-2"><Input value={f.name} onChange={set("name")} /></Field>
          <Field label="Contact person"><Input value={f.contactName ?? ""} onChange={set("contactName")} /></Field>
          <Field label="Phone"><Input value={f.phone ?? ""} onChange={set("phone")} /></Field>
          <Field label="Email"><Input type="email" value={f.email ?? ""} onChange={set("email")} /></Field>
          <Field label="GST / Tax ID"><Input value={f.gstOrTaxId ?? ""} onChange={set("gstOrTaxId")} /></Field>
          <Field label="Address" className="sm:col-span-2"><Textarea value={f.address ?? ""} onChange={set("address")} /></Field>
          <Field label="Notes" className="sm:col-span-2"><Textarea value={f.notes ?? ""} onChange={set("notes")} /></Field>
        </div>
      </Modal>
    </>
  );
}

export function LocationButton() {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ code: "", name: "" });
  const { run, busy } = useAction();
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> New location</Button>
      <Modal size="sm" open={open} onClose={() => setOpen(false)} title="New storage location" footer={<><Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button loading={busy} onClick={async () => (await run("/api/inventory/locations", { body: f, success: "Location created" })) && setOpen(false)}>Create</Button></>}>
        <div className="grid gap-4">
          <Field label="Code" hint="Short code, e.g. WH2"><Input value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} /></Field>
          <Field label="Name"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        </div>
      </Modal>
    </>
  );
}
