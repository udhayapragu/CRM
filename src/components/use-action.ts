"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/client-api";
import { useToast } from "@/components/ui/toast";

/** Run an API mutation, toast the outcome and refresh server components. */
export function useAction() {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const run = async <T,>(path: string, opts: { method?: string; body?: unknown; form?: FormData; success?: string; refresh?: boolean } = {}): Promise<T | null> => {
    setBusy(true);
    try {
      const res = await api<T>(path, { method: opts.method ?? "POST", body: opts.body, form: opts.form });
      if (opts.success) toast.success(opts.success);
      if (opts.refresh !== false) router.refresh();
      return res;
    } catch (e) {
      toast.error((e as Error).message);
      return null;
    } finally {
      setBusy(false);
    }
  };
  return { run, busy };
}
