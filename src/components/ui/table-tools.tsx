"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search, X } from "lucide-react";
import { cn } from "@/lib/utils";

function useParamSetter() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, start] = useTransition();
  const set = (patch: Record<string, string | undefined>) => {
    const p = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (!v) p.delete(k);
      else p.set(k, v);
    }
    if (!("page" in patch)) p.delete("page");
    start(() => router.replace(`${pathname}${p.toString() ? `?${p}` : ""}`, { scroll: false }));
  };
  return { set, params, pending };
}

export function SearchBox({ placeholder = "Search…", param = "q", className }: { placeholder?: string; param?: string; className?: string }) {
  const { set, params, pending } = useParamSetter();
  const [value, setValue] = useState(params.get(param) ?? "");
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const t = setTimeout(() => set({ [param]: value.trim() || undefined }), 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <div className={cn("relative w-full sm:w-72", className)}>
      <Search className={cn("pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle", pending && "animate-pulse text-brand-strong")} />
      <input value={value} onChange={(e) => setValue(e.target.value)} placeholder={placeholder} className="input pl-9 pr-8" aria-label={placeholder} />
      {value && (
        <button onClick={() => setValue("")} className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-subtle hover:text-fg" aria-label="Clear search">
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

export function FilterSelect({ param, options, placeholder, className }: { param: string; options: { value: string; label: string }[]; placeholder: string; className?: string }) {
  const { set, params } = useParamSetter();
  return (
    <select
      value={params.get(param) ?? ""}
      onChange={(e) => set({ [param]: e.target.value || undefined })}
      className={cn("input w-full sm:w-auto sm:min-w-[160px]", className)}
      aria-label={placeholder}
    >
      <option value="">{placeholder}</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function DateRange({ fromParam = "from", toParam = "to" }: { fromParam?: string; toParam?: string }) {
  const { set, params } = useParamSetter();
  return (
    <div className="flex w-full items-center gap-2 sm:w-auto">
      <input type="date" className="input w-full sm:w-[150px]" value={params.get(fromParam) ?? ""} onChange={(e) => set({ [fromParam]: e.target.value || undefined })} aria-label="From date" />
      <span className="text-xs text-subtle">to</span>
      <input type="date" className="input w-full sm:w-[150px]" value={params.get(toParam) ?? ""} onChange={(e) => set({ [toParam]: e.target.value || undefined })} aria-label="To date" />
    </div>
  );
}

export function FilterBar({ children }: { children: React.ReactNode }) {
  return <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">{children}</div>;
}
