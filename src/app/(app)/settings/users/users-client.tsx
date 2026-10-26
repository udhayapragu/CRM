"use client";
import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Field, Input, Select } from "@/components/ui/form";
import { Modal } from "@/components/ui/modal";
import { useAction } from "@/components/use-action";
import { formatDate, timeAgo } from "@/lib/utils";

interface U { id: string; name: string; email: string; role: string; active: boolean; lastLoginAt: string | null; lockedUntil: string | null; createdAt: string }

export function UsersClient({ users, roles, me }: { users: U[]; roles: { value: string; label: string; description: string }[]; me: string }) {
  const [create, setCreate] = useState(false);
  const [edit, setEdit] = useState<U | null>(null);
  const [f, setF] = useState({ name: "", email: "", role: "VIEWER", password: "" });
  const [e, setE] = useState({ name: "", role: "", active: true, password: "" });
  const { run, busy } = useAction();
  const label = (r: string) => roles.find((x) => x.value === r)?.label ?? r;
  return (
    <>
      <div className="mb-4 flex justify-end"><Button variant="gold" onClick={() => setCreate(true)}><Plus className="h-4 w-4" /> Add user</Button></div>
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="table-base">
            <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th>Last sign-in</th><th>Created</th><th /></tr></thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td className="font-medium">{u.name} {u.id === me && <Badge tone="brand">you</Badge>}</td>
                  <td className="text-sm text-muted">{u.email}</td>
                  <td><Badge tone={u.role === "SUPER_ADMIN" ? "gold" : "neutral"}>{label(u.role)}</Badge></td>
                  <td>{!u.active ? <Badge tone="danger">Deactivated</Badge> : u.lockedUntil && new Date(u.lockedUntil) > new Date() ? <Badge tone="warning">Locked</Badge> : <Badge tone="success">Active</Badge>}</td>
                  <td className="text-xs text-muted">{u.lastLoginAt ? timeAgo(u.lastLoginAt) : "never"}</td>
                  <td className="text-xs text-muted">{formatDate(u.createdAt)}</td>
                  <td className="text-right"><Button size="sm" variant="ghost" onClick={() => { setEdit(u); setE({ name: u.name, role: u.role, active: u.active, password: "" }); }}>Edit</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {roles.map((r) => <div key={r.value} className="rounded-xl border border-line/50 bg-surface p-3"><div className="text-sm font-medium text-gold">{r.label}</div><div className="mt-1 text-xs text-muted">{r.description}</div></div>)}
      </div>
      <Modal open={create} onClose={() => setCreate(false)} title="Add user" footer={<><Button variant="ghost" onClick={() => setCreate(false)}>Cancel</Button><Button loading={busy} onClick={async () => { if (await run("/api/users", { body: f, success: "User created" })) { setCreate(false); setF({ name: "", email: "", role: "VIEWER", password: "" }); } }}>Create user</Button></>}>
        <div className="grid gap-4">
          <Field label="Full name"><Input value={f.name} onChange={(ev) => setF({ ...f, name: ev.target.value })} /></Field>
          <Field label="Email"><Input type="email" value={f.email} onChange={(ev) => setF({ ...f, email: ev.target.value })} /></Field>
          <Field label="Role"><Select value={f.role} onChange={(ev) => setF({ ...f, role: ev.target.value })}>{roles.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}</Select></Field>
          <Field label="Temporary password" hint="10+ characters with letters and numbers. Share it securely; the user should change it."><Input type="password" autoComplete="new-password" value={f.password} onChange={(ev) => setF({ ...f, password: ev.target.value })} /></Field>
        </div>
      </Modal>
      <Modal open={!!edit} onClose={() => setEdit(null)} title={`Edit ${edit?.name ?? ""}`} description="Changing role, deactivating or resetting the password signs the user out everywhere." footer={<><Button variant="ghost" onClick={() => setEdit(null)}>Cancel</Button><Button loading={busy} onClick={async () => { if (edit && (await run(`/api/users/${edit.id}`, { method: "PATCH", body: { name: e.name !== edit.name ? e.name : undefined, role: e.role !== edit.role ? e.role : undefined, active: e.active !== edit.active ? e.active : undefined, password: e.password || undefined }, success: "User updated" }))) setEdit(null); }}>Save</Button></>}>
        <div className="grid gap-4">
          <Field label="Full name"><Input value={e.name} onChange={(ev) => setE({ ...e, name: ev.target.value })} /></Field>
          <Field label="Role"><Select value={e.role} onChange={(ev) => setE({ ...e, role: ev.target.value })}>{roles.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}</Select></Field>
          <Field label="Reset password" hint="Leave blank to keep the current password"><Input type="password" autoComplete="new-password" value={e.password} onChange={(ev) => setE({ ...e, password: ev.target.value })} /></Field>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={e.active} disabled={edit?.id === me} onChange={(ev) => setE({ ...e, active: ev.target.checked })} className="accent-[rgb(var(--brand))]" /> Account active</label>
        </div>
      </Modal>
    </>
  );
}
