import Link from "next/link";
import { Columns3, Table2 } from "lucide-react";
import { requirePageUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { prisma } from "@/lib/db";
import { formatDate } from "@/lib/utils";
import { str, type SP } from "@/lib/url";
import { PageHeader, Card } from "@/components/ui/card";
import { Badge, DemoBadge } from "@/components/ui/badge";
import { KanbanBoard, NewOnboardingButton } from "@/components/onboarding/board";
import { ensureDefaultStages } from "@/server/services/onboarding";

export const metadata = { title: "Product onboarding" };

export default async function OnboardingPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requirePageUser("onboarding:view");
  const sp = await searchParams;
  const view = str(sp, "view") === "table" ? "table" : "board";
  await ensureDefaultStages();
  const [stages, rawItems, users] = await Promise.all([
    prisma.onboardingStage.findMany({ orderBy: { position: "asc" } }),
    prisma.onboardingItem.findMany({ orderBy: { updatedAt: "desc" }, include: { owner: { select: { name: true } }, tasks: { select: { done: true } }, _count: { select: { documents: true } }, stage: true } }),
    prisma.user.findMany({ where: { active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  const rank: Record<string, number> = { URGENT: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
  const items = [...rawItems].sort((a, b) => (rank[a.priority] ?? 9) - (rank[b.priority] ?? 9));
  const manage = can(user.role, "onboarding:manage");
  const mapped = items.map((i) => ({ id: i.id, title: i.title, sku: i.sku, category: i.category, stageId: i.stageId, priority: i.priority, dueDate: i.dueDate?.toISOString() ?? null, owner: i.owner, tasksDone: i.tasks.filter((t) => t.done).length, tasksTotal: i.tasks.length, documents: i._count.documents, isDemo: i.isDemo }));
  const toggle = (v: "board" | "table", Icon: typeof Columns3, label: string) => (
    <Link href={v === "board" ? "/onboarding" : "/onboarding?view=table"} className={`inline-flex h-10 items-center gap-2 rounded-xl border px-3 text-sm ${view === v ? "border-brand/50 bg-brand/15 text-fg" : "border-line text-muted hover:text-fg"}`}><Icon className="h-4 w-4" />{label}</Link>
  );
  return (
    <>
      <PageHeader eyebrow="Growth" title="Product onboarding" subtitle="Track new products from idea to live on your website." actions={<>{toggle("board", Columns3, "Board")}{toggle("table", Table2, "Table")}{manage && <NewOnboardingButton stages={stages} users={users} />}</>} />
      <div className="mb-5 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6 2xl:grid-cols-11">
        {stages.map((s) => (
          <div key={s.id} className="rounded-xl border border-line/50 bg-surface px-3 py-2">
            <div className="flex items-center gap-1.5 truncate text-[10px] uppercase tracking-wider text-subtle"><span className="h-2 w-2 shrink-0 rounded-full" style={{ background: s.color }} />{s.name}</div>
            <div className="text-xl font-semibold tabular-nums">{items.filter((i) => i.stageId === s.id).length}</div>
          </div>
        ))}
      </div>
      {view === "board" ? (
        <KanbanBoard stages={stages} items={mapped} canManage={manage} />
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead><tr><th>Product</th><th>Stage</th><th>Priority</th><th>Owner</th><th>Tasks</th><th>Docs</th><th>Deadline</th><th>Updated</th></tr></thead>
              <tbody>
                {items.map((i) => (
                  <tr key={i.id}>
                    <td><Link href={`/onboarding/${i.id}`} className="font-medium hover:text-brand-strong">{i.title}</Link> {i.isDemo && <DemoBadge />}<div className="text-[11px] text-subtle">{[i.sku, i.category].filter(Boolean).join(" · ")}</div></td>
                    <td><span className="inline-flex items-center gap-1.5 text-sm"><span className="h-2 w-2 rounded-full" style={{ background: i.stage.color }} />{i.stage.name}</span></td>
                    <td><Badge tone={i.priority === "URGENT" ? "danger" : i.priority === "HIGH" ? "warning" : "neutral"}>{i.priority.toLowerCase()}</Badge></td>
                    <td className="text-sm text-muted">{i.owner?.name ?? "—"}</td>
                    <td className="tabular-nums text-sm">{i.tasks.filter((t) => t.done).length}/{i.tasks.length}</td>
                    <td className="tabular-nums text-sm">{i._count.documents}</td>
                    <td className={`text-xs ${i.dueDate && i.dueDate < new Date() ? "text-danger" : "text-muted"}`}>{formatDate(i.dueDate)}</td>
                    <td className="text-xs text-muted">{formatDate(i.updatedAt)}</td>
                  </tr>
                ))}
                {items.length === 0 && <tr><td colSpan={8} className="py-10 text-center text-sm text-muted">No products in onboarding yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  );
}
