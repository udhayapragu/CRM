"use client";
import { useCallback, useEffect, useState } from "react";
import { Download, FileSpreadsheet, Loader2, Search } from "lucide-react";
import { api } from "@/lib/client-api";
import { cn, formatMoney, formatNumber } from "@/lib/utils";
import { Button } from "@/components/ui/button";

interface Def { key: string; title: string; description: string; dateRange: boolean; defaultDays: number | null }
interface Col { key: string; header: string; type?: string }
interface Result { title: string; columns: Col[]; rows: Record<string, string | number | null>[]; totalRows: number }

const iso = (d: Date) => d.toISOString().slice(0, 10);

export function ReportsClient({ reports, canExport }: { reports: Def[]; canExport: boolean }) {
  const [active, setActive] = useState(reports[0]?.key ?? "");
  const def = reports.find((r) => r.key === active);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState(iso(new Date()));
  const [q, setQ] = useState("");
  const [data, setData] = useState<Result | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!def) return;
    const d = new Date();
    d.setDate(d.getDate() - ((def.defaultDays ?? 30) - 1));
    setFrom(iso(d));
    setTo(iso(new Date()));
    setQ("");
  }, [def]);

  const params = useCallback(
    (format: string) => {
      const p = new URLSearchParams({ format });
      if (def?.dateRange && from) p.set("from", from);
      if (def?.dateRange && to) p.set("to", to);
      if (q) p.set("q", q);
      return p.toString();
    },
    [def, from, to, q],
  );

  useEffect(() => {
    if (!active || !from) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    const t = setTimeout(() => {
      api<Result>(`/api/reports/${active}?${params("json")}`)
        .then((d) => !cancelled && setData(d))
        .catch((e) => !cancelled && (setError(e.message), setData(null)))
        .finally(() => !cancelled && setLoading(false));
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [active, params, from]);

  return (
    <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
      <nav className="card h-fit p-2" aria-label="Reports">
        {reports.map((r) => (
          <button key={r.key} onClick={() => setActive(r.key)} className={cn("w-full rounded-xl px-3 py-2.5 text-left transition", active === r.key ? "bg-brand/15 text-fg" : "text-muted hover:bg-surface-2 hover:text-fg")}>
            <div className="flex items-center gap-2 text-sm font-medium"><FileSpreadsheet className={cn("h-4 w-4", active === r.key ? "text-gold" : "text-subtle")} />{r.title}</div>
            <div className="mt-0.5 pl-6 text-[11px] text-subtle">{r.description}</div>
          </button>
        ))}
      </nav>
      <div className="card min-w-0 overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-line/50 p-4 lg:flex-row lg:items-end">
          <div className="min-w-0 flex-1">
            <h2 className="font-display text-2xl font-semibold">{def?.title}</h2>
            <p className="text-xs text-muted">{loading ? "Loading…" : data ? `${formatNumber(data.totalRows)} rows${data.totalRows > data.rows.length ? ` (previewing ${data.rows.length})` : ""}` : ""}</p>
          </div>
          {def?.dateRange && (
            <div className="flex items-center gap-2">
              <input type="date" className="input w-[150px]" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From" />
              <span className="text-xs text-subtle">to</span>
              <input type="date" className="input w-[150px]" value={to} onChange={(e) => setTo(e.target.value)} aria-label="To" />
            </div>
          )}
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" />
            <input className="input w-full pl-9 lg:w-52" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search report" />
          </div>
          {canExport && (
            <div className="flex gap-2">
              <a href={`/api/reports/${active}?${params("xlsx")}`}><Button variant="gold"><Download className="h-4 w-4" /> Excel</Button></a>
              <a href={`/api/reports/${active}?${params("csv")}`}><Button variant="secondary">CSV</Button></a>
            </div>
          )}
        </div>
        <div className="max-h-[65vh] overflow-auto">
          {loading && !data && <div className="grid h-60 place-items-center"><Loader2 className="h-6 w-6 animate-spin text-brand-strong" /></div>}
          {error && <p className="p-6 text-sm text-danger">{error}</p>}
          {data && data.rows.length === 0 && <p className="p-10 text-center text-sm text-muted">No rows for these filters.</p>}
          {data && data.rows.length > 0 && (
            <table className={cn("table-base", loading && "opacity-60")}>
              <thead className="sticky top-0 bg-surface"><tr>{data.columns.map((c) => <th key={c.key} className={c.type === "number" || c.type === "money" ? "text-right" : ""}>{c.header}</th>)}</tr></thead>
              <tbody>
                {data.rows.map((r, i) => (
                  <tr key={i}>{data.columns.map((c) => <td key={c.key} className={cn("whitespace-nowrap text-xs", (c.type === "number" || c.type === "money") && "text-right tabular-nums")}>{r[c.key] === null || r[c.key] === undefined ? <span className="text-subtle">—</span> : c.type === "money" ? formatMoney(r[c.key]) : c.type === "number" ? formatNumber(r[c.key]) : String(r[c.key])}</td>)}</tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
