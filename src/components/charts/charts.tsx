"use client";
import { useState } from "react";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipProps,
} from "recharts";
import { Table2, LineChart as LineIcon } from "lucide-react";
import { useChartTheme } from "./use-chart-theme";
import { formatMoney, formatNumber } from "@/lib/utils";

type Row = Record<string, string | number | null>;

function TooltipBox({ active, payload, label, money }: TooltipProps<number, string> & { money?: boolean }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-line/70 bg-surface px-3 py-2 text-xs shadow-xl">
      <div className="mb-1 font-medium text-fg">{label}</div>
      {payload.map((p) => (
        <div key={String(p.dataKey)} className="flex items-center gap-2 text-muted">
          <span className="h-2 w-2 rounded-full" style={{ background: p.color }} />
          <span>{p.name}</span>
          <span className="ml-auto pl-3 font-semibold tabular-nums text-fg">{money ? formatMoney(p.value) : formatNumber(p.value)}</span>
        </div>
      ))}
    </div>
  );
}

/** Wrapper adding a chart ⇄ table toggle so data is never conveyed by colour alone. */
function ChartFrame({ rows, columns, height, children, empty }: { rows: Row[]; columns: { key: string; label: string; money?: boolean }[]; height: number; children: React.ReactNode; empty: string }) {
  const [table, setTable] = useState(false);
  const hasData = rows.some((r) => columns.slice(1).some((c) => Number(r[c.key]) > 0));
  return (
    <div className="relative">
      <button onClick={() => setTable((t) => !t)} className="absolute -top-10 right-0 rounded-lg p-1.5 text-subtle hover:bg-surface-2 hover:text-fg" aria-label={table ? "Show chart" : "Show data table"} title={table ? "Show chart" : "Show data table"}>
        {table ? <LineIcon className="h-4 w-4" /> : <Table2 className="h-4 w-4" />}
      </button>
      {!hasData ? (
        <div className="grid place-items-center text-sm text-muted" style={{ height }}>{empty}</div>
      ) : table ? (
        <div className="overflow-auto" style={{ maxHeight: height }}>
          <table className="table-base">
            <thead><tr>{columns.map((c) => <th key={c.key}>{c.label}</th>)}</tr></thead>
            <tbody>{rows.map((r, i) => <tr key={i}>{columns.map((c) => <td key={c.key} className="tabular-nums">{c.money ? formatMoney(r[c.key]) : typeof r[c.key] === "number" ? formatNumber(r[c.key]) : r[c.key]}</td>)}</tr>)}</tbody>
          </table>
        </div>
      ) : (
        <div style={{ height }}>{children}</div>
      )}
    </div>
  );
}

function Legend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <div className="mb-2 flex flex-wrap gap-4 text-xs text-muted">
      {items.map((i) => (
        <span key={i.label} className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: i.color }} />{i.label}</span>
      ))}
    </div>
  );
}

export function OrdersDispatchChart({ data }: { data: { label: string; orders: number; dispatches: number }[] }) {
  const t = useChartTheme();
  return (
    <>
      <Legend items={[{ label: "Orders placed", color: t.c1 }, { label: "Orders dispatched", color: t.c2 }]} />
      <ChartFrame rows={data} height={240} empty="No orders in the last 14 days" columns={[{ key: "label", label: "Day" }, { key: "orders", label: "Orders" }, { key: "dispatches", label: "Dispatched" }]}>
        <ResponsiveContainer>
          <BarChart data={data} barGap={2} margin={{ top: 8, right: 4, left: -18, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke={t.grid} />
            <XAxis dataKey="label" tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={14} />
            <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={40} />
            <Tooltip content={<TooltipBox />} cursor={{ fill: t.grid }} />
            <Bar dataKey="orders" name="Orders placed" fill={t.c1} radius={[4, 4, 0, 0]} maxBarSize={18} />
            <Bar dataKey="dispatches" name="Orders dispatched" fill={t.c2} radius={[4, 4, 0, 0]} maxBarSize={18} />
          </BarChart>
        </ResponsiveContainer>
      </ChartFrame>
    </>
  );
}

export function SalesChart({ weekly, monthly, currency }: { weekly: { label: string; total: number; orders: number }[]; monthly: { label: string; total: number; orders: number }[]; currency: string }) {
  const t = useChartTheme();
  const [mode, setMode] = useState<"weekly" | "monthly">("weekly");
  const data = mode === "weekly" ? weekly : monthly;
  return (
    <>
      <div className="mb-2 inline-flex rounded-lg border border-line/60 p-0.5 text-xs">
        {(["weekly", "monthly"] as const).map((m) => (
          <button key={m} onClick={() => setMode(m)} className={`rounded-md px-2.5 py-1 capitalize ${mode === m ? "bg-brand/20 text-fg" : "text-muted hover:text-fg"}`}>{m}</button>
        ))}
      </div>
      <ChartFrame rows={data} height={228} empty="No paid sales in this period" columns={[{ key: "label", label: mode === "weekly" ? "Week of" : "Month" }, { key: "total", label: `Net sales (${currency})`, money: true }, { key: "orders", label: "Paid orders" }]}>
        <ResponsiveContainer>
          <AreaChart data={data} margin={{ top: 8, right: 4, left: 4, bottom: 0 }}>
            <defs>
              <linearGradient id="salesFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={t.c1} stopOpacity={0.35} />
                <stop offset="100%" stopColor={t.c1} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} stroke={t.grid} />
            <XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={14} />
            <YAxis tickLine={false} axisLine={false} width={56} tickFormatter={(v) => (v >= 100000 ? `${Math.round(v / 1000)}k` : formatNumber(v))} />
            <Tooltip content={<TooltipBox money />} cursor={{ stroke: t.axis, strokeDasharray: 3 }} />
            <Area type="monotone" dataKey="total" name="Net sales" stroke={t.c1} strokeWidth={2} fill="url(#salesFill)" activeDot={{ r: 5, stroke: t.surface, strokeWidth: 2 }} />
          </AreaChart>
        </ResponsiveContainer>
      </ChartFrame>
    </>
  );
}

export function HorizontalBars({ data, valueKey, labelKey, name, height = 260, colorKey, empty }: { data: Row[]; valueKey: string; labelKey: string; name: string; height?: number; colorKey?: "c1" | "c2"; empty: string }) {
  const t = useChartTheme();
  const color = t[colorKey ?? "c1"];
  return (
    <ChartFrame rows={data} height={height} empty={empty} columns={[{ key: labelKey, label: "Item" }, { key: valueKey, label: name }]}>
      <ResponsiveContainer>
        <BarChart data={data} layout="vertical" margin={{ top: 0, right: 28, left: 0, bottom: 0 }} barCategoryGap={6}>
          <XAxis type="number" hide allowDecimals={false} />
          <YAxis type="category" dataKey={labelKey} width={150} tickLine={false} axisLine={false} />
          <Tooltip content={<TooltipBox />} cursor={{ fill: t.grid }} />
          <Bar dataKey={valueKey} name={name} fill={color} radius={[0, 4, 4, 0]} maxBarSize={16} label={{ position: "right", fill: t.muted, fontSize: 11 }} />
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

export function StockLevelsChart({ data }: { data: { name: string; available: number; reorder: number }[] }) {
  const t = useChartTheme();
  return (
    <>
      <div className="mb-2 flex flex-wrap gap-4 text-xs text-muted">
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: t.c1 }} />Available</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: t.danger }} />⚠ At/below reorder level</span>
      </div>
      <ChartFrame rows={data} height={300} empty="No inventory items yet" columns={[{ key: "name", label: "Item" }, { key: "available", label: "Available" }, { key: "reorder", label: "Reorder level" }]}>
        <ResponsiveContainer>
          <BarChart data={data} layout="vertical" margin={{ top: 0, right: 36, left: 0, bottom: 0 }} barCategoryGap={5}>
            <XAxis type="number" hide />
            <YAxis type="category" dataKey="name" width={160} tickLine={false} axisLine={false} />
            <Tooltip content={<TooltipBox />} cursor={{ fill: t.grid }} />
            <Bar dataKey="available" name="Available" radius={[0, 4, 4, 0]} maxBarSize={14} label={{ position: "right", fill: t.muted, fontSize: 11 }}>
              {data.map((d, i) => <Cell key={i} fill={d.available <= d.reorder ? t.danger : t.c1} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </ChartFrame>
    </>
  );
}

export function LowStockTrendChart({ data }: { data: { label: string; low: number }[] }) {
  const t = useChartTheme();
  return (
    <ChartFrame rows={data} height={200} empty="No inventory history yet" columns={[{ key: "label", label: "Day" }, { key: "low", label: "Items at/below reorder level" }]}>
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke={t.grid} />
          <XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={20} />
          <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={40} />
          <Tooltip content={<TooltipBox />} cursor={{ stroke: t.axis, strokeDasharray: 3 }} />
          <Line type="stepAfter" dataKey="low" name="Low-stock items" stroke={t.c2} strokeWidth={2} dot={false} activeDot={{ r: 5, stroke: t.surface, strokeWidth: 2 }} />
        </LineChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}
