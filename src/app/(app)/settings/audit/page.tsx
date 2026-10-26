import { requirePageUser } from "@/lib/auth/session";
import { formatDate } from "@/lib/utils";
import { str, type SP } from "@/lib/url";
import { Card, PageHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { FilterBar, FilterSelect, SearchBox } from "@/components/ui/table-tools";
import { Pagination } from "@/components/ui/table-server";
import { listAudit } from "@/server/services/queries";

export const metadata = { title: "Audit log" };

const ENTITIES = ["InventoryItem", "Order", "Shipment", "Product", "PurchaseReceipt", "WordPressConnection", "SyncJob", "User", "OnboardingItem", "Commission", "CommissionRule", "Member", "Payout", "Report", "AppSetting", "System"];

export default async function AuditPage({ searchParams }: { searchParams: Promise<SP> }) {
  await requirePageUser("audit:view");
  const sp = await searchParams;
  const data = await listAudit({ q: str(sp, "q"), entityType: str(sp, "entityType"), page: Number(str(sp, "page")) || 1, pageSize: 50 });
  return (
    <>
      <PageHeader eyebrow="Administration" title="Audit log" subtitle="Who did what, and when — stock changes, order updates, credential changes, exports, approvals and sign-ins." />
      <FilterBar>
        <SearchBox placeholder="Search actions…" />
        <FilterSelect param="entityType" placeholder="All record types" options={ENTITIES.map((e) => ({ value: e, label: e }))} />
      </FilterBar>
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="table-base">
            <thead><tr><th>When</th><th>User</th><th>Action</th><th>Record</th><th>Summary</th><th>IP</th></tr></thead>
            <tbody>
              {data.rows.map((a) => (
                <tr key={a.id}>
                  <td className="whitespace-nowrap text-xs text-muted">{formatDate(a.createdAt, true)}</td>
                  <td className="whitespace-nowrap text-sm">{a.user?.name ?? "System"}</td>
                  <td><Badge tone={a.action.includes("fail") ? "danger" : a.action.startsWith("integration") ? "info" : a.action.startsWith("inventory") ? "gold" : "neutral"}>{a.action}</Badge></td>
                  <td className="text-xs text-muted">{a.entityType}</td>
                  <td className="min-w-[300px] text-sm">{a.summary}</td>
                  <td className="font-mono text-[11px] text-subtle">{a.ip ?? "—"}</td>
                </tr>
              ))}
              {data.rows.length === 0 && <tr><td colSpan={6} className="py-10 text-center text-sm text-muted">No audit entries.</td></tr>}
            </tbody>
          </table>
        </div>
        <Pagination page={data.page} pageSize={data.pageSize} total={data.total} sp={sp} path="/settings/audit" />
      </Card>
    </>
  );
}
