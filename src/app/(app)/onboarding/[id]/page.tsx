import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePageUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { prisma } from "@/lib/db";
import { formatDate, timeAgo } from "@/lib/utils";
import { Card, CardHeader, PageHeader } from "@/components/ui/card";
import { Badge, DemoBadge } from "@/components/ui/badge";
import { KeyValue } from "@/components/ui/misc";
import { CommentBox, Documents, EditOnboarding, StageSelect, TaskList } from "@/components/onboarding/detail-actions";

export default async function OnboardingDetail({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePageUser("onboarding:view");
  const { id } = await params;
  const item = await prisma.onboardingItem.findUnique({
    where: { id },
    include: { stage: true, owner: { select: { id: true, name: true } }, product: { select: { id: true, name: true } }, tasks: { orderBy: { createdAt: "asc" }, include: { assignee: { select: { id: true, name: true } } } }, comments: { orderBy: { createdAt: "desc" }, include: { user: { select: { name: true } } } }, documents: { orderBy: { createdAt: "desc" } } },
  });
  if (!item) notFound();
  const manage = can(user.role, "onboarding:manage");
  const [stages, users, products] = await Promise.all([
    prisma.onboardingStage.findMany({ orderBy: { position: "asc" }, select: { id: true, name: true, key: true, color: true } }),
    prisma.user.findMany({ where: { active: true }, select: { id: true, name: true } }),
    manage ? prisma.product.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" }, take: 1000 }) : Promise.resolve([]),
  ]);
  const done = item.tasks.filter((t) => t.done).length;
  return (
    <>
      <PageHeader
        eyebrow={<Link href="/onboarding" className="hover:underline">Onboarding</Link>}
        title={item.title}
        subtitle={<span className="flex flex-wrap items-center gap-2"><span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: item.stage.color }} />{item.stage.name}</span><Badge>{item.priority.toLowerCase()} priority</Badge>{item.isDemo && <DemoBadge />}<span className="text-subtle">in stage {timeAgo(item.stageEnteredAt).replace(" ago", "")}</span></span>}
        actions={manage && <><StageSelect itemId={item.id} stageId={item.stageId} stages={stages} /><EditOnboarding item={{ ...item, dueDate: item.dueDate?.toISOString() ?? null }} stages={stages} users={users} products={products} /></>}
      />
      {item.holdReason && item.stage.key === "REJECTED_ON_HOLD" && <div className="mb-4 rounded-xl border border-danger/30 bg-danger/10 px-4 py-2 text-sm text-danger">Reason: {item.holdReason}</div>}
      <div className="grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <Card>
            <CardHeader title="Tasks" subtitle={`${done} of ${item.tasks.length} complete`} />
            <div className="p-5">
              {item.tasks.length > 0 && <div className="mb-4 h-1.5 overflow-hidden rounded-full bg-surface-3"><div className="h-full rounded-full bg-gradient-to-r from-brand to-gold" style={{ width: `${(done / item.tasks.length) * 100}%` }} /></div>}
              <TaskList itemId={item.id} tasks={item.tasks.map((t) => ({ ...t, dueDate: t.dueDate?.toISOString() ?? null }))} users={users} canManage={manage} />
            </div>
          </Card>
          <Card>
            <CardHeader title="Notes & history" />
            <div className="p-5">
              {manage && <CommentBox itemId={item.id} />}
              <ul className="mt-4 space-y-3">
                {item.comments.map((c) => (
                  <li key={c.id} className="rounded-xl bg-surface-2/60 px-3 py-2"><div className="text-sm">{c.body}</div><div className="mt-0.5 text-[11px] text-subtle">{c.user?.name ?? "System"} · {formatDate(c.createdAt, true)}</div></li>
                ))}
                {item.comments.length === 0 && <li className="text-sm text-muted">No notes yet.</li>}
              </ul>
            </div>
          </Card>
        </div>
        <div className="space-y-4">
          <Card>
            <CardHeader title="Details" />
            <div className="p-5">
              <KeyValue items={[{ label: "SKU", value: item.sku }, { label: "Category", value: item.category }, { label: "Owner", value: item.owner?.name ?? "Unassigned" }, { label: "Deadline", value: <span className={item.dueDate && item.dueDate < new Date() ? "text-danger" : ""}>{formatDate(item.dueDate)}</span> }, { label: "Website product", value: item.product ? <Link href={`/products/${item.product.id}`} className="text-brand-strong hover:underline">{item.product.name}</Link> : "—" }, { label: "Created", value: formatDate(item.createdAt) }]} />
              {item.description && <p className="mt-4 whitespace-pre-line text-sm text-muted">{item.description}</p>}
            </div>
          </Card>
          <Card>
            <CardHeader title="Documents" subtitle="Specs, compliance, artwork" />
            <div className="p-5"><Documents itemId={item.id} docs={item.documents.map((d) => ({ ...d, createdAt: d.createdAt.toISOString() }))} canManage={manage} /></div>
          </Card>
        </div>
      </div>
    </>
  );
}
