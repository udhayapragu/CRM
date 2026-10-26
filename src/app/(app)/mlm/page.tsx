import Link from "next/link";
import { Network } from "lucide-react";
import { requirePageUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { prisma } from "@/lib/db";
import { formatDate, formatMoney, toNumber } from "@/lib/utils";
import { hrefWith, str, type SP } from "@/lib/url";
import { Card, CardHeader, PageHeader, Stat } from "@/components/ui/card";
import { Badge, DemoBadge } from "@/components/ui/badge";
import { EmptyState, TabLinks } from "@/components/ui/misc";
import { getSettings } from "@/server/services/settings";
import { memberTree } from "@/server/services/mlm";
import { CommissionTable, ComplianceNotice, MemberStatusSelect, NewMemberButton, PayoutButton, RecalculateButton, RuleEditor } from "./mlm-client";

export const metadata = { title: "Direct selling" };

type TreeNode = { id: string; name: string; referralCode: string; status: string; children: TreeNode[] };
function Tree({ node }: { node: TreeNode }) {
  return (
    <li className="ml-4 border-l border-line/60 pl-4 pt-2">
      <Link href={`/mlm?tab=members&member=${node.id}`} className="inline-flex items-center gap-2 rounded-lg border border-line/50 bg-surface-2/60 px-2 py-1 text-sm hover:border-brand/50">{node.name} <span className="font-mono text-[10px] text-subtle">{node.referralCode}</span><Badge tone={node.status === "ACTIVE" ? "success" : "neutral"}>{node.status.toLowerCase()}</Badge></Link>
      {node.children.length > 0 && <ul>{node.children.map((c) => <Tree key={c.id} node={c} />)}</ul>}
    </li>
  );
}

export default async function MlmPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requirePageUser("mlm:view");
  const sp = await searchParams;
  const settings = await getSettings();
  if (!settings.mlmEnabled) {
    return (
      <>
        <PageHeader eyebrow="Growth" title="Direct selling (MLM)" />
        <Card><EmptyState icon={<Network className="h-5 w-5" />} title="Module disabled" message="The optional MLM / direct-selling module is off. It is not required to run the CRM and is kept separate from inventory and WordPress synchronisation." action={can(user.role, "settings:manage") ? <Link href="/settings/general" className="text-sm text-brand-strong hover:underline">Enable in Settings →</Link> : undefined} /></Card>
      </>
    );
  }
  const tab = str(sp, "tab") ?? "overview";
  const path = "/mlm";
  const [members, commissions, rules, payouts] = await Promise.all([
    prisma.member.findMany({ orderBy: { joinedAt: "desc" }, include: { sponsor: { select: { name: true } }, _count: { select: { downline: true, sales: true } }, sales: { include: { order: { select: { total: true, status: true } } } }, commissions: { select: { amount: true, status: true } } } }),
    prisma.commission.findMany({ orderBy: { createdAt: "desc" }, take: 300, include: { member: { select: { name: true, referralCode: true } }, order: { select: { id: true, number: true } }, rule: { select: { name: true } } } }),
    prisma.commissionRule.findMany({ orderBy: [{ level: "asc" }, { createdAt: "asc" }] }),
    prisma.payout.findMany({ orderBy: { paidAt: "desc" }, take: 100, include: { member: { select: { name: true, referralCode: true } }, _count: { select: { commissions: true } } } }),
  ]);
  const sum = (s: string[]) => commissions.filter((c) => s.includes(c.status)).reduce((a, c) => a + toNumber(c.amount), 0);
  const perf = members.map((m) => ({
    ...m,
    salesTotal: m.sales.filter((s) => s.order.status !== "CANCELLED").reduce((a, s) => a + toNumber(s.order.total), 0),
    approved: m.commissions.filter((c) => c.status === "APPROVED").reduce((a, c) => a + toNumber(c.amount), 0),
    earned: m.commissions.filter((c) => c.status !== "VOID").reduce((a, c) => a + toNumber(c.amount), 0),
  }));
  const selected = str(sp, "member");
  const tree = selected ? await memberTree(selected, 4) : null;
  const manage = can(user.role, "mlm:manage");

  return (
    <>
      <PageHeader eyebrow="Growth" title="Direct selling" subtitle="Members, sponsor network and sales-based commissions." actions={<>{manage && <RecalculateButton />}{manage && tab === "members" && <NewMemberButton />}{manage && tab === "rules" && <RuleEditor />}</>} />
      <ComplianceNotice />
      <TabLinks active={tab} tabs={[["overview", "Performance"], ["members", "Members"], ["commissions", "Commissions"], ["rules", "Commission rules"], ["payouts", "Payouts"]].map(([k, l]) => ({ key: k, label: l, href: hrefWith(path, {}, { tab: k }) }))} />

      {tab === "overview" && (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5">
            <Stat label="Members" value={members.length} hint={`${members.filter((m) => m.status === "ACTIVE").length} active`} />
            <Stat label="Pending commissions" value={formatMoney(sum(["PENDING"]))} tone="warning" />
            <Stat label="Approved (unpaid)" value={formatMoney(sum(["APPROVED"]))} tone="gold" />
            <Stat label="Paid out" value={formatMoney(sum(["PAID"]))} tone="success" />
            <Stat label="Active rules" value={rules.filter((r) => r.active && r.legallyReviewed).length} hint={`${rules.length} total`} />
          </div>
          <Card className="overflow-hidden">
            <CardHeader title="Member performance" subtitle="Attributed sales and commissions" />
            <div className="overflow-x-auto p-2">
              <table className="table-base">
                <thead><tr><th>Member</th><th>Status</th><th className="text-right">Orders</th><th className="text-right">Sales</th><th className="text-right">Earned</th><th className="text-right">Approved balance</th><th /></tr></thead>
                <tbody>
                  {perf.sort((a, b) => b.salesTotal - a.salesTotal).map((m) => (
                    <tr key={m.id}>
                      <td>{m.name} <span className="font-mono text-[10px] text-subtle">{m.referralCode}</span> {m.isDemo && <DemoBadge />}</td>
                      <td><Badge tone={m.status === "ACTIVE" ? "success" : "neutral"}>{m.status.toLowerCase()}</Badge></td>
                      <td className="text-right tabular-nums">{m._count.sales}</td>
                      <td className="text-right tabular-nums">{formatMoney(m.salesTotal)}</td>
                      <td className="text-right tabular-nums">{formatMoney(m.earned)}</td>
                      <td className="text-right tabular-nums">{formatMoney(m.approved)}</td>
                      <td className="text-right">{can(user.role, "mlm:pay") && m.approved > 0 && <PayoutButton memberId={m.id} amount={m.approved} />}</td>
                    </tr>
                  ))}
                  {perf.length === 0 && <tr><td colSpan={7} className="py-8 text-center text-sm text-muted">No members yet.</td></tr>}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}

      {tab === "members" && (
        <div className="grid gap-4 xl:grid-cols-3">
          <Card className="overflow-hidden xl:col-span-2">
            <div className="overflow-x-auto">
              <table className="table-base">
                <thead><tr><th>Member</th><th>Referral code</th><th>Sponsor</th><th className="text-right">Direct downline</th><th>Joined</th><th>Status</th></tr></thead>
                <tbody>
                  {members.map((m) => (
                    <tr key={m.id}>
                      <td><Link href={hrefWith(path, sp, { member: m.id })} className="font-medium hover:text-brand-strong">{m.name}</Link> {m.isDemo && <DemoBadge />}<div className="text-[11px] text-subtle">{m.email ?? m.phone ?? ""}</div></td>
                      <td className="font-mono text-xs text-gold">{m.referralCode}</td>
                      <td className="text-sm text-muted">{m.sponsor?.name ?? "—"}</td>
                      <td className="text-right tabular-nums">{m._count.downline}</td>
                      <td className="text-xs text-muted">{formatDate(m.joinedAt)}</td>
                      <td>{manage ? <MemberStatusSelect id={m.id} status={m.status} /> : <Badge>{m.status}</Badge>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
          <Card>
            <CardHeader title="Network hierarchy" subtitle={tree ? `Downline of ${tree.name}` : "Select a member to view their downline"} />
            <div className="p-4">{tree ? <ul className="-ml-4"><Tree node={tree as TreeNode} /></ul> : <p className="text-sm text-muted">Click a member name.</p>}</div>
          </Card>
        </div>
      )}

      {tab === "commissions" && (
        <Card className="p-4">
          <CommissionTable canApprove={can(user.role, "mlm:approve")} rows={commissions.map((c) => ({ id: c.id, createdAt: c.createdAt.toISOString(), member: c.member.name, code: c.member.referralCode, order: c.order.number, orderId: c.order.id, rule: c.rule.name, level: c.level, base: toNumber(c.baseAmount), rate: toNumber(c.ratePercent), amount: toNumber(c.amount), status: c.status, note: c.note }))} />
        </Card>
      )}

      {tab === "rules" && (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead><tr><th>Rule</th><th>Level</th><th className="text-right">Rate</th><th>Legal review</th><th>Status</th><th /></tr></thead>
              <tbody>
                {rules.map((r) => (
                  <tr key={r.id}>
                    <td className="font-medium">{r.name}<div className="text-[11px] text-subtle">{r.notes}</div></td>
                    <td>L{r.level} {r.level === 1 ? "(seller)" : `(sponsor ${r.level - 1} up)`}</td>
                    <td className="text-right tabular-nums">{toNumber(r.ratePercent)}%</td>
                    <td>{r.legallyReviewed ? <Badge tone="success">Reviewed {r.reviewedBy ? `· ${r.reviewedBy}` : ""}</Badge> : <Badge tone="warning">Not reviewed</Badge>}</td>
                    <td>{r.active ? <Badge tone="success" dot>active</Badge> : <Badge>inactive</Badge>}</td>
                    <td className="text-right">{manage && <RuleEditor rule={{ ...r, ratePercent: toNumber(r.ratePercent) }} />}</td>
                  </tr>
                ))}
                {rules.length === 0 && <tr><td colSpan={6} className="py-10 text-center text-sm text-muted">No rules configured. No commissions will be generated until a legally reviewed rule is activated.</td></tr>}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {tab === "payouts" && (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead><tr><th>Paid on</th><th>Member</th><th className="text-right">Amount</th><th className="text-right">Commissions</th><th>Reference</th></tr></thead>
              <tbody>
                {payouts.map((p) => (
                  <tr key={p.id}><td className="text-xs text-muted">{formatDate(p.paidAt, true)}</td><td>{p.member.name} <span className="font-mono text-[10px] text-subtle">{p.member.referralCode}</span></td><td className="text-right font-medium tabular-nums">{formatMoney(p.amount)}</td><td className="text-right tabular-nums">{p._count.commissions}</td><td className="font-mono text-xs text-muted">{p.reference ?? "—"}</td></tr>
                ))}
                {payouts.length === 0 && <tr><td colSpan={5} className="py-10 text-center text-sm text-muted">No payouts recorded.</td></tr>}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  );
}
