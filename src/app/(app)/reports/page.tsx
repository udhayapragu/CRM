import { requirePageUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { PageHeader } from "@/components/ui/card";
import { listReports } from "@/server/services/reports";
import { getSettings } from "@/server/services/settings";
import { ReportsClient } from "./reports-client";

export const metadata = { title: "Reports" };

export default async function ReportsPage() {
  const user = await requirePageUser("reports:view");
  const settings = await getSettings();
  const reports = listReports(user).filter((r) => r.key !== "mlm-commissions" || settings.mlmEnabled);
  return (
    <>
      <PageHeader eyebrow="Insights" title="Reports & exports" subtitle={`Preview any report, filter by date range and search, then export to Excel or CSV.${can(user.role, "reports:export_sensitive") ? "" : " Customer contact details are excluded for your role."}`} />
      <ReportsClient reports={reports} canExport={can(user.role, "reports:export")} />
    </>
  );
}
