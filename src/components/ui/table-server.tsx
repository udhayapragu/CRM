import Link from "next/link";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight } from "lucide-react";
import { hrefWith, type SP } from "@/lib/url";
import { cn } from "@/lib/utils";

export function SortHeader({ label, field, sp, path, defaultDir = "desc", className }: { label: string; field: string; sp: SP; path: string; defaultDir?: "asc" | "desc"; className?: string }) {
  const active = sp.sort === field;
  const dir = active ? (sp.dir === "asc" ? "asc" : "desc") : null;
  const next = active ? (dir === "asc" ? "desc" : "asc") : defaultDir;
  return (
    <th className={className}>
      <Link href={hrefWith(path, sp, { sort: field, dir: next, page: undefined })} scroll={false} className={cn("inline-flex items-center gap-1 hover:text-fg", active && "text-fg")}>
        {label}
        {dir === "asc" && <ArrowUp className="h-3 w-3" />}
        {dir === "desc" && <ArrowDown className="h-3 w-3" />}
      </Link>
    </th>
  );
}

export function Pagination({ page, pageSize, total, sp, path }: { page: number; pageSize: number; total: number; sp: SP; path: string }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line/40 px-4 py-3 text-xs text-muted">
      <span>
        Showing <b className="text-fg">{from}</b>–<b className="text-fg">{to}</b> of <b className="text-fg">{total}</b>
      </span>
      <div className="flex items-center gap-1">
        <PageLink disabled={page <= 1} href={hrefWith(path, sp, { page: page - 1 })} label="Previous page">
          <ChevronLeft className="h-4 w-4" />
        </PageLink>
        <span className="px-2 tabular-nums">
          Page {page} / {pages}
        </span>
        <PageLink disabled={page >= pages} href={hrefWith(path, sp, { page: page + 1 })} label="Next page">
          <ChevronRight className="h-4 w-4" />
        </PageLink>
      </div>
    </div>
  );
}

function PageLink({ disabled, href, children, label }: { disabled: boolean; href: string; children: React.ReactNode; label: string }) {
  if (disabled) return <span className="rounded-lg border border-line/40 p-1.5 opacity-40">{children}</span>;
  return (
    <Link href={href} scroll={false} aria-label={label} className="rounded-lg border border-line/60 p-1.5 hover:border-brand hover:text-fg">
      {children}
    </Link>
  );
}
