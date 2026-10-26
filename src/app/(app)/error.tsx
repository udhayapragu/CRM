"use client";
import { AlertOctagon } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="card mx-auto mt-10 max-w-lg p-8 text-center">
      <AlertOctagon className="mx-auto h-10 w-10 text-danger" />
      <h2 className="mt-3 font-display text-2xl font-semibold">Something went wrong</h2>
      <p className="mt-2 text-sm text-muted">The page could not be loaded. No data was changed. {error.digest && <span className="block text-[11px] text-subtle">Reference: {error.digest}</span>}</p>
      <Button className="mt-5" onClick={reset}>Try again</Button>
    </div>
  );
}
