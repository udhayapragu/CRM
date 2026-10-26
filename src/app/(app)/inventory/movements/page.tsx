import { requirePageUser } from "@/lib/auth/session";
import { str, type SP } from "@/lib/url";
import { Card, PageHeader } from "@/components/ui/card";
import { DateRange, FilterBar, FilterSelect, SearchBox } from "@/components/ui/table-tools";
import { Pagination } from "@/components/ui/table-server";
import { LedgerTable } from "@/components/ledger-table";
import { listLedger } from "@/server/services/queries";

export const metadata = { title: "Stock ledger" };

export default async function MovementsPage({ searchParams }: { searchParams: Promise<SP> }) {
  await requirePageUser("inventory:view");
  const sp = await searchParams;
  const data = await listLedger({ q: str(sp, "q"), type: str(sp, "type"), from: str(sp, "from"), to: str(sp, "to"), page: Number(str(sp, "page")) || 1, pageSize: 50 });
  return (
    <>
      <PageHeader eyebrow="Warehouse" title="Stock ledger" subtitle="The append-only record of every stock movement. Entries can never be edited or deleted — corrections are new entries." />
      <FilterBar>
        <SearchBox placeholder="Search item, SKU or reason…" />
        <FilterSelect param="type" placeholder="All movement types" options={["OPENING", "RECEIPT", "CONSUMPTION", "DISPATCH", "RETURN", "DAMAGE", "ADJUSTMENT", "TRANSFER_IN", "TRANSFER_OUT"].map((t) => ({ value: t, label: t.replace("_", " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase()) }))} />
        <DateRange />
      </FilterBar>
      <Card className="overflow-hidden">
        <div className="p-2"><LedgerTable rows={data.rows} showItem /></div>
        <Pagination page={data.page} pageSize={data.pageSize} total={data.total} sp={sp} path="/inventory/movements" />
      </Card>
    </>
  );
}
