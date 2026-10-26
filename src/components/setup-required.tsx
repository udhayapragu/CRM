import { AlertTriangle, CheckCircle2, Database, KeyRound } from "lucide-react";
import type { SystemProblem } from "@/lib/system-check";

/** Shown instead of a crash when the deployment is missing configuration. Never reveals secret values. */
export function SetupRequired({ problems }: { problems: SystemProblem[] }) {
  const blocking = problems.filter((p) => p.blocking);
  const warnings = problems.filter((p) => !p.blocking);
  return (
    <div className="grid min-h-screen place-items-center px-4 py-10">
      <div className="w-full max-w-2xl">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl border border-gold/40 bg-gradient-to-br from-brand-soft to-surface shadow-gold">
            <span className="font-display text-3xl font-bold gold-text">L</span>
          </div>
          <h1 className="font-display text-4xl font-semibold">Almost there</h1>
          <p className="mt-2 text-sm text-muted">Luxe CRM is deployed, but the server needs a little configuration before it can start.</p>
        </div>
        <div className="card space-y-4 p-6">
          {[...blocking, ...warnings].map((p) => (
            <div key={p.key} className={`flex gap-3 rounded-xl border p-4 ${p.blocking ? "border-danger/40 bg-danger/10" : "border-warning/40 bg-warning/10"}`}>
              {p.key.startsWith("DATABASE") || p.key === "MIGRATIONS" ? <Database className={`mt-0.5 h-5 w-5 shrink-0 ${p.blocking ? "text-danger" : "text-warning"}`} /> : p.blocking ? <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-danger" /> : <KeyRound className="mt-0.5 h-5 w-5 shrink-0 text-warning" />}
              <div>
                <div className="text-sm font-semibold text-fg">{p.title}</div>
                <p className="mt-1 text-sm text-muted">{p.fix}</p>
                {p.suggestion && (
                  <div className="mt-2">
                    <span className="text-[11px] uppercase tracking-wider text-subtle">Name</span>
                    <code className="mb-1 block select-all rounded-lg bg-surface-2 px-2 py-1 font-mono text-xs text-fg">{p.key}</code>
                    <span className="text-[11px] uppercase tracking-wider text-subtle">Value</span>
                    <code className="block select-all break-all rounded-lg bg-surface-2 px-2 py-1 font-mono text-xs text-gold">{p.suggestion}</code>
                  </div>
                )}
              </div>
            </div>
          ))}
          {problems.length === 0 && <p className="flex items-center gap-2 text-sm text-success"><CheckCircle2 className="h-4 w-4" /> Everything looks configured. Reload the page.</p>}
          <div className="rounded-xl border border-line/60 bg-surface-2/60 p-4 text-xs text-muted">
            <b className="text-fg">On Vercel:</b> Project → Settings → Environment Variables → add the missing values → Deployments → ⋯ → <b>Redeploy</b>. The redeploy also creates the database tables automatically. Full guide: <code>docs/DEPLOYMENT.md</code> in your repository.
          </div>
        </div>
      </div>
    </div>
  );
}
