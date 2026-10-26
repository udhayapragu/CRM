"use client";
import { useState } from "react";
import Link from "next/link";
import { CalendarDays, FileText, ListChecks, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { Modal } from "@/components/ui/modal";
import { Badge } from "@/components/ui/badge";
import { useAction } from "@/components/use-action";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

export interface Stage { id: string; key: string; name: string; color: string }
export interface Item {
  id: string; title: string; sku: string | null; category: string | null; stageId: string; priority: string; dueDate: string | null;
  owner: { name: string } | null; tasksDone: number; tasksTotal: number; documents: number; isDemo: boolean;
}

const PRIORITY_TONE = { LOW: "neutral", MEDIUM: "info", HIGH: "warning", URGENT: "danger" } as const;

export function KanbanBoard({ stages, items, canManage }: { stages: Stage[]; items: Item[]; canManage: boolean }) {
  const [local, setLocal] = useState(items);
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const { run } = useAction();
  const toast = useToast();

  const move = async (itemId: string, stageId: string) => {
    const item = local.find((i) => i.id === itemId);
    if (!item || item.stageId === stageId) return;
    const stage = stages.find((s) => s.id === stageId)!;
    let holdReason: string | undefined;
    if (stage.key === "REJECTED_ON_HOLD") {
      holdReason = prompt("Reason for rejecting / putting on hold:") ?? undefined;
      if (!holdReason) return toast.info("Move cancelled — a reason is required.");
    }
    const prev = local;
    setLocal(local.map((i) => (i.id === itemId ? { ...i, stageId } : i)));
    const res = await run(`/api/onboarding/${itemId}`, { method: "PATCH", body: { stageId, ...(holdReason ? { holdReason } : {}) }, success: `Moved to ${stage.name}` });
    if (!res) setLocal(prev);
  };

  return (
    <div className="-mx-4 overflow-x-auto px-4 pb-4 sm:-mx-6 sm:px-6">
      <div className="flex min-w-max gap-3">
        {stages.map((s) => {
          const col = local.filter((i) => i.stageId === s.id);
          return (
            <div
              key={s.id}
              onDragOver={(e) => { if (canManage) { e.preventDefault(); setOver(s.id); } }}
              onDragLeave={() => setOver((o) => (o === s.id ? null : o))}
              onDrop={(e) => { e.preventDefault(); setOver(null); if (dragId) move(dragId, s.id); setDragId(null); }}
              className={cn("flex w-72 shrink-0 flex-col rounded-2xl border bg-surface/60 transition", over === s.id ? "border-gold/60 bg-gold/5" : "border-line/50")}
            >
              <div className="flex items-center justify-between px-3 py-3">
                <span className="flex items-center gap-2 text-sm font-semibold"><span className="h-2.5 w-2.5 rounded-full" style={{ background: s.color }} />{s.name}</span>
                <span className="rounded-full bg-surface-3 px-2 text-xs tabular-nums text-muted">{col.length}</span>
              </div>
              <div className="flex min-h-[120px] flex-1 flex-col gap-2 px-2 pb-3">
                {col.map((i) => (
                  <div
                    key={i.id}
                    draggable={canManage}
                    onDragStart={() => setDragId(i.id)}
                    onDragEnd={() => setDragId(null)}
                    className={cn("group rounded-xl border border-line/60 bg-surface p-3 shadow-sm transition hover:border-brand/50", canManage && "cursor-grab active:cursor-grabbing", dragId === i.id && "opacity-50")}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <Link href={`/onboarding/${i.id}`} className="text-sm font-medium leading-snug hover:text-brand-strong">{i.title}</Link>
                      <Badge tone={PRIORITY_TONE[i.priority as keyof typeof PRIORITY_TONE] ?? "neutral"}>{i.priority.toLowerCase()}</Badge>
                    </div>
                    {(i.sku || i.category) && <div className="mt-1 text-[11px] text-subtle">{[i.sku, i.category].filter(Boolean).join(" · ")}</div>}
                    <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-muted">
                      {i.tasksTotal > 0 && <span className="inline-flex items-center gap-1"><ListChecks className="h-3 w-3" />{i.tasksDone}/{i.tasksTotal}</span>}
                      {i.documents > 0 && <span className="inline-flex items-center gap-1"><FileText className="h-3 w-3" />{i.documents}</span>}
                      {i.dueDate && <span className={cn("inline-flex items-center gap-1", new Date(i.dueDate) < new Date() && "text-danger")}><CalendarDays className="h-3 w-3" />{new Date(i.dueDate).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}</span>}
                      {i.owner && <span className="ml-auto truncate">{i.owner.name}</span>}
                    </div>
                    {i.tasksTotal > 0 && <div className="mt-2 h-1 overflow-hidden rounded-full bg-surface-3"><div className="h-full rounded-full bg-gradient-to-r from-brand to-gold" style={{ width: `${(i.tasksDone / i.tasksTotal) * 100}%` }} /></div>}
                    {canManage && (
                      <select aria-label="Move to stage" value={i.stageId} onChange={(e) => move(i.id, e.target.value)} className="mt-2 w-full rounded-lg border border-line/50 bg-surface-2 px-2 py-1 text-[11px] text-muted sm:hidden">
                        {stages.map((st) => <option key={st.id} value={st.id}>{st.name}</option>)}
                      </select>
                    )}
                    {i.isDemo && <div className="mt-1 text-[9px] uppercase tracking-wider text-gold">demo</div>}
                  </div>
                ))}
                {col.length === 0 && <div className="grid flex-1 place-items-center rounded-xl border border-dashed border-line/50 text-xs text-subtle">Drop here</div>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function NewOnboardingButton({ stages, users }: { stages: Stage[]; users: { id: string; name: string }[] }) {
  const [open, setOpen] = useState(false);
  const init = { title: "", sku: "", category: "", description: "", stageId: stages[0]?.id ?? "", priority: "MEDIUM", ownerId: "", dueDate: "" };
  const [f, setF] = useState(init);
  const { run, busy } = useAction();
  const set = (k: keyof typeof init) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <>
      <Button variant="gold" onClick={() => setOpen(true)}><Plus className="h-4 w-4" /> New product</Button>
      <Modal size="lg" open={open} onClose={() => setOpen(false)} title="Add product to onboarding" footer={<><Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button loading={busy} disabled={f.title.length < 2} onClick={async () => { const r = await run("/api/onboarding", { body: { ...f, ownerId: f.ownerId || null, dueDate: f.dueDate ? new Date(f.dueDate + "T18:00:00").toISOString() : null, sku: f.sku || null, category: f.category || null, description: f.description || null }, success: "Added to onboarding" }); if (r) { setOpen(false); setF(init); } }}>Add</Button></>}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Product name" required className="sm:col-span-2"><Input value={f.title} onChange={set("title")} /></Field>
          <Field label="Proposed SKU"><Input value={f.sku} onChange={set("sku")} /></Field>
          <Field label="Category"><Input value={f.category} onChange={set("category")} /></Field>
          <Field label="Stage"><Select value={f.stageId} onChange={set("stageId")}>{stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>
          <Field label="Priority"><Select value={f.priority} onChange={set("priority")}>{["LOW", "MEDIUM", "HIGH", "URGENT"].map((p) => <option key={p}>{p}</option>)}</Select></Field>
          <Field label="Owner"><Select value={f.ownerId} onChange={set("ownerId")}><option value="">Unassigned</option>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select></Field>
          <Field label="Deadline"><Input type="date" value={f.dueDate} onChange={set("dueDate")} /></Field>
          <Field label="Description" className="sm:col-span-2"><Textarea value={f.description} onChange={set("description")} /></Field>
        </div>
      </Modal>
    </>
  );
}
