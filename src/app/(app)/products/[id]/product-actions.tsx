"use client";
import { useState } from "react";
import { PackagePlus, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/form";
import { Modal } from "@/components/ui/modal";
import { useAction } from "@/components/use-action";

export function TrackProductButton({ productId, defaultSku, variants, threshold }: { productId: string; defaultSku: string; variants: { id: string; name: string; tracked: boolean }[]; threshold: number }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ variantId: "", openingStock: "0", sku: defaultSku, reorderLevel: String(threshold) });
  const { run, busy } = useAction();
  const submit = async () => {
    const res = await run(`/api/products/${productId}/track`, {
      body: { variantId: f.variantId || null, openingStock: Number(f.openingStock) || 0, sku: f.sku || undefined, reorderLevel: Number(f.reorderLevel) || 0 },
      success: "Physical stock tracking started",
    });
    if (res) setOpen(false);
  };
  return (
    <>
      <Button variant="gold" onClick={() => setOpen(true)}><PackagePlus className="h-4 w-4" /> Track physical stock</Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Track physical stock" description="Creates a finished-goods inventory item linked to this product. The opening count is recorded in the ledger." footer={<><Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button loading={busy} onClick={submit}>Start tracking</Button></>}>
        <div className="grid gap-4 sm:grid-cols-2">
          {variants.length > 0 && (
            <Field label="Variant" className="sm:col-span-2" hint="Track the parent product, or one variant at a time.">
              <Select value={f.variantId} onChange={(e) => setF({ ...f, variantId: e.target.value })}>
                <option value="">Whole product</option>
                {variants.map((v) => <option key={v.id} value={v.id} disabled={v.tracked}>{v.name}{v.tracked ? " (tracked)" : ""}</option>)}
              </Select>
            </Field>
          )}
          <Field label="Inventory SKU"><Input value={f.sku} onChange={(e) => setF({ ...f, sku: e.target.value })} /></Field>
          <Field label="Opening physical count" hint="Count what is on the shelf now."><Input type="number" min={0} value={f.openingStock} onChange={(e) => setF({ ...f, openingStock: e.target.value })} /></Field>
          <Field label="Reorder level"><Input type="number" min={0} value={f.reorderLevel} onChange={(e) => setF({ ...f, reorderLevel: e.target.value })} /></Field>
        </div>
      </Modal>
    </>
  );
}

export function ThresholdEditor({ productId, value }: { productId: string; value: number }) {
  const [open, setOpen] = useState(false);
  const [v, setV] = useState(String(value));
  const { run, busy } = useAction();
  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}><SlidersHorizontal className="h-3.5 w-3.5" /> Low-stock threshold</Button>
      <Modal size="sm" open={open} onClose={() => setOpen(false)} title="Low-stock threshold" description="Stored in the CRM only — never overwritten by WordPress sync." footer={<><Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button loading={busy} onClick={async () => (await run(`/api/products/${productId}`, { method: "PATCH", body: { lowStockThreshold: Number(v) }, success: "Threshold updated" })) && setOpen(false)}>Save</Button></>}>
        <Field label="Alert when available stock is at or below"><Input type="number" min={0} value={v} onChange={(e) => setV(e.target.value)} /></Field>
      </Modal>
    </>
  );
}
