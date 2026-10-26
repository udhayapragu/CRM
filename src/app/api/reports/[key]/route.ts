import { NextResponse } from "next/server";
import { apiRoute, parseQuery } from "@/lib/api";
import { can } from "@/lib/auth/permissions";
import { forbidden } from "@/lib/errors";
import { reportQuerySchema } from "@/lib/validation";
import { audit } from "@/server/audit";
import { runReport, toCsv, toXlsx } from "@/server/services/reports";
import { hasDemoData } from "@/server/services/settings";

export const GET = apiRoute<{ key: string }>({ permission: "reports:view" }, async ({ req, params, user, ip }) => {
  const query = parseQuery(req, reportQuerySchema);
  if (query.format !== "json" && !can(user.role, "reports:export")) throw forbidden("You do not have permission to export reports");
  const report = await runReport(params.key, query, user);
  if (query.format === "json") return { ...report, rows: report.rows.slice(0, 500), totalRows: report.rows.length };
  await audit({ userId: user.id, action: "report.export", entityType: "Report", entityId: params.key, summary: `Exported ${report.title} (${query.format.toUpperCase()}, ${report.rows.length} rows)`, ip });
  const stamp = new Date().toISOString().slice(0, 10);
  const base = `${params.key}-${stamp}`;
  if (query.format === "csv") {
    return new NextResponse(toCsv(report), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${base}.csv"`, "Cache-Control": "no-store" } });
  }
  const buf = await toXlsx(report, { generatedBy: user.email, isDemo: await hasDemoData() });
  return new NextResponse(new Uint8Array(buf), {
    headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="${base}.xlsx"`, "Cache-Control": "no-store" },
  });
});
