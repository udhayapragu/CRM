"use client";
import { useState } from "react";
import { ArrowLeftRight, Pencil, Plus, ShieldCheck, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { Modal } from "@/components/ui/modal";
import { useAction } from "@/components/use-action";
import { useToast } from "@/components/ui/toast";
import { api } from "@/lib/client-api";

export interface ItemOption { id: string; name: string; sku: string; unit: string }
export interface Opt { id: string; name: string }

export const CATEGORY_OPTIONS = [
  ["PRODUCT", "Finished products"], ["BOTTLE", "Bottles"], ["LABEL", "Stickers & labels"], ["CAP", "Caps & lids"], ["BOX", "Boxes & cartons"], ["PACKAGING", "Packaging materials"], ["RAW_MATERIAL", "Raw materials"], ["OTHER", "Other"],
] as const;

const KINDS = [
  { v: "STOCK_IN", l: "Stock in (+)", hint: "Goods arrived without a purchase receipt" },
  { v: "STOCK_OUT", l: "Stock out / consumption (−)", hint: "Used in production, samples, internal use" },
  { v: "DAMAGE", l: "Damage / wastage (−)", hint: "Broken, expired or spoiled units" },
  { v: "RETURN", l: "Return to stock (+)", hint: "Non-order returns back to shelf" },
  { v: "ADJUSTMENT", l: "Count adjustment (±)", hint: "Correct the system after a physical count. Use negative numbers to reduce." },
];

export function StockMovementButton({ items, locations, presetItemId, label = "Stock movement", variant = "primary" }: { items: ItemOption[]; locations: Opt[]; presetItemId?: string; label?: string; variant?: "primary" | "secondary" }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ itemId: presetItemId ?? "", kind: "STOCK_IN", quantity: "", reason: "", locationId: "", reference: "" });
  const { run, busy } = useAction();
  const item = items.find((i) => i.id === f.itemId);
  const kind = KINDS.find((k) => k.v === f.kind)!;
  const submit = async () => {
    const res = await run("/api/inventory/movements", {
      body: { itemId: f.itemId, kind: f.kind, quantity: Number(f.quantity), reason: f.reason, locationId: f.locationId || undefined, reference: f.reference || undefined },
      success: "Stock movement recorded in the ledger",
    });
    if (res) {
      setOpen(false);
      setF({ ...f, quantity: "", reason: "", reference: "" });
    }
  };
  return (
    <>
      <Button variant={variant} onClick={() => setOpen(true)}><SlidersHorizontal className="h-4 w-4" /> {label}</Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Record stock movement" description="Every movement is permanent, timestamped and attributed to you. Mistakes are corrected with a new, opposite entry." footer={<><Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button loading={busy} disabled={!f.itemId || !f.quantity || f.reason.trim().length < 3} onClick={submit}>Record movement</Button></>}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Item" required className="sm:col-span-2">
            <Select value={f.itemId} onChange={(e) => setF({ ...f, itemId: e.target.value })} disabled={!!presetItemId}>
              <option value="">Select an item…</option>
              {items.map((i) => <option key={i.id} value={i.id}>{i.name} ({i.sku})</option>)}
            </Select>
          </Field>
          <Field label="Movement type" required hint={kind.hint} className="sm:col-span-2">
            <Select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>{KINDS.map((k) => <option key={k.v} value={k.v}>{k.l}</option>)}</Select>
          </Field>
          <Field label={`Quantity${item ? ` (${item.unit})` : ""}`} required><Input type="number" step={1} value={f.quantity} onChange={(e) => setF({ ...f, quantity: e.target.value })} placeholder={f.kind === "ADJUSTMENT" ? "e.g. -5 or 12" : "e.g. 200"} /></Field>
          {locations.length > 1 && (
            <Field label="Location"><Select value={f.locationId} onChange={(e) => setF({ ...f, locationId: e.target.value })}><option value="">Default location</option>{locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</Select></Field>
          )}
          <Field label="Reference" hint="Batch, document or ticket number"><Input value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} /></Field>
          <Field label="Reason" required className="sm:col-span-2"><Textarea value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} placeholder="Why is stock changing? (required for the audit trail)" /></Field>
        </div>
      </Modal>
    </>
  );
}

export function TransferButton({ items, locations, presetItemId }: { items: ItemOption[]; locations: Opt[]; presetItemId?: string }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ itemId: presetItemId ?? "", fromLocationId: locations[0]?.id ?? "", toLocationId: locations[1]?.id ?? "", quantity: "", reason: "" });
  const { run, busy } = useAction();
  if (locations.length < 2) return null;
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}><ArrowLeftRight className="h-4 w-4" /> Transfer</Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Transfer stock between locations" footer={<><Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button loading={busy} onClick={async () => (await run("/api/inventory/transfers", { body: { ...f, quantity: Number(f.quantity) }, success: "Transfer recorded" })) && setOpen(false)}>Transfer</Button></>}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Item" required className="sm:col-span-2"><Select value={f.itemId} disabled={!!presetItemId} onChange={(e) => setF({ ...f, itemId: e.target.value })}><option value="">Select…</option>{items.map((i) => <option key={i.id} value={i.id}>{i.name} ({i.sku})</option>)}</Select></Field>
          <Field label="From"><Select value={f.fromLocationId} onChange={(e) => setF({ ...f, fromLocationId: e.target.value })}>{locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</Select></Field>
          <Field label="To"><Select value={f.toLocationId} onChange={(e) => setF({ ...f, toLocationId: e.target.value })}>{locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</Select></Field>
          <Field label="Quantity" required><Input type="number" min={1} value={f.quantity} onChange={(e) => setF({ ...f, quantity: e.target.value })} /></Field>
          <Field label="Reason" required><Input value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></Field>
        </div>
      </Modal>
    </>
  );
}

export function NewItemButton({ suppliers }: { suppliers: Opt[] }) {
  const [open, setOpen] = useState(false);
  const init = { name: "", sku: "", category: "BOTTLE", customCategory: "", unit: "pcs", reorderLevel: "0", supplierId: "", openingStock: "0", notes: "" };
  const [f, setF] = useState(init);
  const { run, busy } = useAction();
  const set = (k: keyof typeof init) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  const submit = async () => {
    const res = await run("/api/inventory/items", {
      body: { ...f, reorderLevel: Number(f.reorderLevel), openingStock: Number(f.openingStock), supplierId: f.supplierId || null, customCategory: f.customCategory || null },
      success: "Inventory item created",
    });
    if (res) {
      setOpen(false);
      setF(init);
    }
  };
  return (
    <>
      <Button variant="gold" onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> New item</Button>
      <Modal size="lg" open={open} onClose={() => setOpen(false)} title="New inventory item" description="For finished products synced from the website, use “Track physical stock” on the product page instead." footer={<><Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button loading={busy} onClick={submit} disabled={!f.name || !f.sku}>Create item</Button></>}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Item name" required className="sm:col-span-2"><Input value={f.name} onChange={set("name")} placeholder="e.g. Glass bottle 100ml" /></Field>
          <Field label="SKU / identifier" required><Input value={f.sku} onChange={set("sku")} placeholder="PK-BTL-100" /></Field>
          <Field label="Category" required><Select value={f.category} onChange={set("category")}>{CATEGORY_OPTIONS.filter(([v]) => v !== "PRODUCT").map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Field>
          {f.category === "OTHER" && <Field label="Custom category"><Input value={f.customCategory} onChange={set("customCategory")} /></Field>}
          <Field label="Unit" hint="Whole units only — use ml / g for liquids & powders"><Input value={f.unit} onChange={set("unit")} /></Field>
          <Field label="Opening stock" hint="Recorded as the first ledger entry"><Input type="number" min={0} value={f.openingStock} onChange={set("openingStock")} /></Field>
          <Field label="Reorder level"><Input type="number" min={0} value={f.reorderLevel} onChange={set("reorderLevel")} /></Field>
          <Field label="Supplier"><Select value={f.supplierId} onChange={set("supplierId")}><option value="">—</option>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>
          <Field label="Notes" className="sm:col-span-2"><Textarea value={f.notes} onChange={set("notes")} /></Field>
        </div>
      </Modal>
    </>
  );
}

export function EditItemButton({ item, suppliers }: { item: { id: string; name: string; reorderLevel: number; supplierId: string | null; unit: string; notes: string | null; active: boolean }; suppliers: Opt[] }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ name: item.name, reorderLevel: String(item.reorderLevel), supplierId: item.supplierId ?? "", unit: item.unit, notes: item.notes ?? "", active: item.active });
  const { run, busy } = useAction();
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}><Pencil className="h-4 w-4" /> Edit</Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Edit item details" description="Quantities cannot be edited here — use a stock movement." footer={<><Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button loading={busy} onClick={async () => (await run(`/api/inventory/items/${item.id}`, { method: "PATCH", body: { ...f, reorderLevel: Number(f.reorderLevel), supplierId: f.supplierId || null }, success: "Item updated" })) && setOpen(false)}>Save</Button></>}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" className="sm:col-span-2"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="Reorder level"><Input type="number" min={0} value={f.reorderLevel} onChange={(e) => setF({ ...f, reorderLevel: e.target.value })} /></Field>
          <Field label="Unit"><Input value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })} /></Field>
          <Field label="Supplier" className="sm:col-span-2"><Select value={f.supplierId} onChange={(e) => setF({ ...f, supplierId: e.target.value })}><option value="">—</option>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>
          <Field label="Notes" className="sm:col-span-2"><Textarea value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
          <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} className="accent-[rgb(var(--brand))]" /> Active (uncheck to archive)</label>
        </div>
      </Modal>
    </>
  );
}

export function VerifyLedgerButton({ itemId, canRepair }: { itemId: string; canRepair: boolean }) {
  const toast = useToast();
  const { run, busy } = useAction();
  const [checking, setChecking] = useState(false);
  const check = async () => {
    setChecking(true);
    try {
      const r = await api<{ ok: boolean }>(`/api/inventory/items/${itemId}/verify`);
      if (r.ok) toast.success("Verified: cached totals exactly match the ledger");
      else if (canRepair && confirm("Cached totals differ from the ledger. Rebuild them from the ledger now? (The ledger itself is never changed.)")) await run(`/api/inventory/items/${itemId}/verify`, { success: "Totals rebuilt from ledger" });
      else toast.error("Cached totals differ from the ledger — ask an inventory manager to rebuild.");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setChecking(false);
    }
  };
  return <Button variant="ghost" loading={checking || busy} onClick={check}><ShieldCheck className="h-4 w-4" /> Verify against ledger</Button>;
}
