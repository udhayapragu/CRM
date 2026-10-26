"use client";
import { useRef, useState } from "react";
import { Download, Paperclip, Pencil, Plus, Send, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { Modal } from "@/components/ui/modal";
import { useAction } from "@/components/use-action";
import { cn, formatDate } from "@/lib/utils";

interface Opt { id: string; name: string }

export function EditOnboarding({ item, stages, users, products }: { item: { id: string; title: string; sku: string | null; category: string | null; description: string | null; stageId: string; priority: string; ownerId: string | null; dueDate: string | null; productId: string | null; holdReason: string | null }; stages: (Opt & { key: string })[]; users: Opt[]; products: Opt[] }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ ...item, sku: item.sku ?? "", category: item.category ?? "", description: item.description ?? "", ownerId: item.ownerId ?? "", dueDate: item.dueDate?.slice(0, 10) ?? "", productId: item.productId ?? "", holdReason: item.holdReason ?? "" });
  const { run, busy } = useAction();
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  const rejecting = stages.find((s) => s.id === f.stageId)?.key === "REJECTED_ON_HOLD";
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}><Pencil className="h-4 w-4" /> Edit</Button>
      <Modal size="lg" open={open} onClose={() => setOpen(false)} title="Edit onboarding item" footer={<><Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button loading={busy} onClick={async () => (await run(`/api/onboarding/${item.id}`, { method: "PATCH", body: { title: f.title, sku: f.sku || null, category: f.category || null, description: f.description || null, stageId: f.stageId, priority: f.priority, ownerId: f.ownerId || null, dueDate: f.dueDate ? new Date(f.dueDate + "T18:00:00").toISOString() : null, productId: f.productId || null, holdReason: f.holdReason || null }, success: "Saved" })) && setOpen(false)}>Save</Button></>}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Product name" className="sm:col-span-2"><Input value={f.title} onChange={set("title")} /></Field>
          <Field label="SKU"><Input value={f.sku} onChange={set("sku")} /></Field>
          <Field label="Category"><Input value={f.category} onChange={set("category")} /></Field>
          <Field label="Stage"><Select value={f.stageId} onChange={set("stageId")}>{stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>
          <Field label="Priority"><Select value={f.priority} onChange={set("priority")}>{["LOW", "MEDIUM", "HIGH", "URGENT"].map((p) => <option key={p}>{p}</option>)}</Select></Field>
          {rejecting && <Field label="Rejection / hold reason" required className="sm:col-span-2"><Input value={f.holdReason} onChange={set("holdReason")} /></Field>}
          <Field label="Owner"><Select value={f.ownerId} onChange={set("ownerId")}><option value="">Unassigned</option>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select></Field>
          <Field label="Deadline"><Input type="date" value={f.dueDate} onChange={set("dueDate")} /></Field>
          <Field label="Linked website product" hint="Link once the product is live and synced" className="sm:col-span-2"><Select value={f.productId} onChange={set("productId")}><option value="">—</option>{products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>
          <Field label="Description" className="sm:col-span-2"><Textarea value={f.description} onChange={set("description")} /></Field>
        </div>
      </Modal>
    </>
  );
}

export function StageSelect({ itemId, stageId, stages }: { itemId: string; stageId: string; stages: (Opt & { key: string; color: string })[] }) {
  const { run, busy } = useAction();
  return (
    <select disabled={busy} value={stageId} aria-label="Stage" className="input w-auto" onChange={(e) => {
      const st = stages.find((s) => s.id === e.target.value)!;
      let holdReason: string | undefined;
      if (st.key === "REJECTED_ON_HOLD") { holdReason = prompt("Reason for rejecting / putting on hold:") ?? undefined; if (!holdReason) return; }
      run(`/api/onboarding/${itemId}`, { method: "PATCH", body: { stageId: st.id, ...(holdReason ? { holdReason } : {}) }, success: `Moved to ${st.name}` });
    }}>
      {stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
    </select>
  );
}

export function TaskList({ itemId, tasks, users, canManage }: { itemId: string; tasks: { id: string; title: string; done: boolean; dueDate: string | null; assignee: Opt | null }[]; users: Opt[]; canManage: boolean }) {
  const [f, setF] = useState({ title: "", assigneeId: "", dueDate: "" });
  const { run, busy } = useAction();
  return (
    <div>
      <ul className="space-y-2">
        {tasks.map((t) => (
          <li key={t.id} className="flex items-center gap-3 rounded-xl border border-line/50 px-3 py-2">
            <input type="checkbox" checked={t.done} disabled={!canManage} onChange={(e) => run(`/api/onboarding/tasks/${t.id}`, { method: "PATCH", body: { done: e.target.checked } })} className="h-4 w-4 accent-[rgb(var(--gold))]" aria-label={`Mark ${t.title} done`} />
            <div className="min-w-0 flex-1">
              <div className={cn("text-sm", t.done && "text-subtle line-through")}>{t.title}</div>
              <div className="text-[11px] text-subtle">{t.assignee?.name ?? "Unassigned"}{t.dueDate && ` · due ${formatDate(t.dueDate)}`}</div>
            </div>
            {canManage && <button onClick={() => confirm("Delete this task?") && run(`/api/onboarding/tasks/${t.id}`, { method: "DELETE" })} className="text-subtle hover:text-danger" aria-label="Delete task"><Trash2 className="h-3.5 w-3.5" /></button>}
          </li>
        ))}
        {tasks.length === 0 && <li className="text-sm text-muted">No tasks yet.</li>}
      </ul>
      {canManage && (
        <form className="mt-3 grid gap-2 sm:grid-cols-12" onSubmit={async (e) => { e.preventDefault(); if (await run(`/api/onboarding/${itemId}/tasks`, { body: { title: f.title, assigneeId: f.assigneeId || null, dueDate: f.dueDate ? new Date(f.dueDate + "T18:00:00").toISOString() : null }, success: "Task added" })) setF({ title: "", assigneeId: "", dueDate: "" }); }}>
          <Input className="sm:col-span-6" placeholder="New task…" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
          <Select className="sm:col-span-3" value={f.assigneeId} onChange={(e) => setF({ ...f, assigneeId: e.target.value })}><option value="">Assign to…</option>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select>
          <Input className="sm:col-span-2" type="date" value={f.dueDate} onChange={(e) => setF({ ...f, dueDate: e.target.value })} aria-label="Due date" />
          <Button type="submit" className="justify-center sm:col-span-1" loading={busy} disabled={f.title.length < 2} aria-label="Add task"><Plus className="h-4 w-4" /></Button>
        </form>
      )}
    </div>
  );
}

export function CommentBox({ itemId }: { itemId: string }) {
  const [body, setBody] = useState("");
  const { run, busy } = useAction();
  return (
    <form className="flex gap-2" onSubmit={async (e) => { e.preventDefault(); if (body.trim() && (await run(`/api/onboarding/${itemId}/comments`, { body: { body } }))) setBody(""); }}>
      <Input value={body} onChange={(e) => setBody(e.target.value)} placeholder="Add a note…" aria-label="Note" />
      <Button type="submit" variant="secondary" loading={busy} disabled={!body.trim()} aria-label="Post note"><Send className="h-4 w-4" /></Button>
    </form>
  );
}

export function Documents({ itemId, docs, canManage }: { itemId: string; docs: { id: string; fileName: string; sizeBytes: number; createdAt: string }[]; canManage: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  const { run, busy } = useAction();
  const upload = async (file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    await run(`/api/onboarding/${itemId}/documents`, { form: fd, success: `Uploaded ${file.name}` });
    if (ref.current) ref.current.value = "";
  };
  return (
    <div>
      <ul className="space-y-2">
        {docs.map((d) => (
          <li key={d.id} className="flex items-center gap-3 rounded-xl border border-line/50 px-3 py-2 text-sm">
            <Paperclip className="h-4 w-4 text-gold" />
            <span className="min-w-0 flex-1 truncate">{d.fileName}<span className="ml-2 text-[11px] text-subtle">{(d.sizeBytes / 1024).toFixed(0)} KB · {formatDate(d.createdAt)}</span></span>
            <a href={`/api/onboarding/documents/${d.id}`} className="text-subtle hover:text-fg" aria-label={`Download ${d.fileName}`}><Download className="h-4 w-4" /></a>
            {canManage && <button onClick={() => confirm(`Delete ${d.fileName}?`) && run(`/api/onboarding/documents/${d.id}`, { method: "DELETE", success: "Document deleted" })} className="text-subtle hover:text-danger" aria-label="Delete document"><Trash2 className="h-4 w-4" /></button>}
          </li>
        ))}
        {docs.length === 0 && <li className="text-sm text-muted">No documents uploaded.</li>}
      </ul>
      {canManage && (
        <>
          <input ref={ref} type="file" className="hidden" accept=".pdf,.png,.jpg,.jpeg,.webp,.txt,.csv,.doc,.docx,.xls,.xlsx" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
          <Button variant="secondary" size="sm" className="mt-3" loading={busy} onClick={() => ref.current?.click()}><Paperclip className="h-3.5 w-3.5" /> Upload document</Button>
        </>
      )}
    </div>
  );
}
