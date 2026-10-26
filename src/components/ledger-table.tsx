import Link from "next/link";
import type { LedgerType } from "@prisma/client";
import { formatDate, humanize } from "@/lib/utils";
import { Badge, type Tone } from "@/components/ui/badge";

const TONE: Record<LedgerType, Tone> = {
  OPENING: "neutral", RECEIPT: "success", RETURN: "info", TRANSFER_IN: "brand", CONSUMPTION: "warning", DISPATCH: "gold", DAMAGE: "danger", TRANSFER_OUT: "brand", ADJUSTMENT: "neutral",
};

export interface LedgerRow {
  id: string;
  createdAt: Date;
  type: LedgerType;
  quantity: number;
  balanceAfter: number;
  reason: string;
  referenceType: string | null;
  referenceId: string | null;
  isDemo: boolean;
  user: { name: string } | null;
  location: { code: string };
  item?: { id: string; name: string; sku: string; unit: string };
}

export function LedgerTable({ rows, showItem }: { rows: LedgerRow[]; showItem?: boolean }) {
  if (!rows.length) return <p className="px-5 py-10 text-center text-sm text-muted">No stock movements recorded yet.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="table-base">
        <thead>
          <tr>
            <th>Date &amp; time</th>
            {showItem && <th>Item</th>}
            <th>Movement</th>
            <th className="text-right">Qty</th>
            <th className="text-right">Balance</th>
            <th>Location</th>
            <th>Reason</th>
            <th>By</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td className="whitespace-nowrap text-xs text-muted">{formatDate(r.createdAt, true)}</td>
              {showItem && r.item && (
                <td className="min-w-[180px]"><Link href={`/inventory/${r.item.id}`} className="font-medium hover:text-brand-strong">{r.item.name}</Link><div className="font-mono text-[10px] text-subtle">{r.item.sku}</div></td>
              )}
              <td><Badge tone={TONE[r.type]}>{humanize(r.type)}</Badge> {r.isDemo && <span className="text-[9px] uppercase text-gold">demo</span>}</td>
              <td className={`text-right font-semibold tabular-nums ${r.quantity > 0 ? "text-success" : "text-danger"}`}>{r.quantity > 0 ? "+" : ""}{r.quantity}</td>
              <td className="text-right tabular-nums">{r.balanceAfter}</td>
              <td className="font-mono text-xs text-muted">{r.location.code}</td>
              <td className="min-w-[220px] text-xs text-muted">{r.reason}</td>
              <td className="whitespace-nowrap text-xs text-muted">{r.user?.name ?? "System"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
