"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, CircleDashed, Copy, Eye, KeyRound, Loader2, PlugZap, Power, RefreshCw, RotateCcw, ShieldCheck, Webhook, XCircle } from "lucide-react";
import { api } from "@/lib/client-api";
import { cn, formatDate, timeAgo } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Field, Input, Select } from "@/components/ui/form";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import type { PublicConnection } from "@/server/integrations/wordpress/connection-service";

interface Step { name: string; ok: boolean; message: string }
interface Job { id: string; type: string; trigger: string; status: string; attempts: number; maxAttempts: number; createdAt: string; startedAt: string | null; finishedAt: string | null; error: string | null; stats: Record<string, { created: number; updated: number; unchanged: number; failed: number; fetched: number }> | null; runAfter: string }
interface Log { id: string; level: string; message: string; createdAt: string }
interface WebhookEv { id: string; topic: string; status: string; resourceId: string | null; error: string | null; receivedAt: string }

export function IntegrationClient({ initial, canManage, demoPresent }: { initial: PublicConnection | null; canManage: boolean; demoPresent: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [conn, setConn] = useState(initial);
  const [f, setF] = useState({
    name: initial?.name ?? "My WordPress site",
    siteUrl: initial?.siteUrl ?? "",
    adapter: initial?.adapter ?? "WOOCOMMERCE",
    consumerKey: "",
    consumerSecret: "",
    wpUsername: initial?.wpUsername ?? "",
    appPassword: "",
    syncIntervalMinutes: String(initial?.syncIntervalMinutes ?? 15),
    perPage: String(initial?.perPage ?? 50),
    postType: initial?.adapterOptions.postType ?? "product",
    skuMetaKey: initial?.adapterOptions.skuMetaKey ?? "",
    priceMetaKey: initial?.adapterOptions.priceMetaKey ?? "",
    stockMetaKey: initial?.adapterOptions.stockMetaKey ?? "",
  });
  const [busy, setBusy] = useState<string | null>(null);
  const [steps, setSteps] = useState<Step[] | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [webhooks, setWebhooks] = useState<WebhookEv[]>([]);
  const [logJob, setLogJob] = useState<(Job & { logs: Log[] }) | null>(null);
  const [secret, setSecret] = useState<{ secret: string; deliveryUrl: string } | null>(null);
  const [whResults, setWhResults] = useState<{ topic: string; ok: boolean; message: string }[] | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });

  const loadJobs = async () => {
    try {
      const d = await api<{ jobs: Job[]; webhooks: WebhookEv[] }>("/api/integration/jobs");
      setJobs(d.jobs);
      setWebhooks(d.webhooks);
    } catch { /* not configured yet */ }
  };
  useEffect(() => {
    loadJobs();
    const active = jobs.some((j) => j.status === "RUNNING" || j.status === "QUEUED");
    const t = setInterval(() => { loadJobs(); if (active) router.refresh(); }, active ? 4000 : 20000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobs.some((j) => j.status === "RUNNING" || j.status === "QUEUED")]);

  const act = async <T,>(key: string, fn: () => Promise<T>, ok?: string) => {
    setBusy(key);
    try {
      const r = await fn();
      if (ok) toast.success(ok);
      router.refresh();
      return r;
    } catch (e) {
      toast.error((e as Error).message);
      return null;
    } finally {
      setBusy(null);
    }
  };

  const save = () =>
    act("save", async () => {
      const body: Record<string, unknown> = { name: f.name, siteUrl: f.siteUrl, adapter: f.adapter, syncIntervalMinutes: Number(f.syncIntervalMinutes), perPage: Number(f.perPage) };
      if (f.adapter === "WOOCOMMERCE") {
        if (f.consumerKey) body.consumerKey = f.consumerKey;
        if (f.consumerSecret) body.consumerSecret = f.consumerSecret;
      } else {
        body.wpUsername = f.wpUsername;
        if (f.appPassword) body.appPassword = f.appPassword;
        Object.assign(body, { postType: f.postType, skuMetaKey: f.skuMetaKey, priceMetaKey: f.priceMetaKey, stockMetaKey: f.stockMetaKey });
      }
      const r = await api<{ connection: PublicConnection }>("/api/integration", { method: "PUT", body });
      setConn(r.connection);
      setF((x) => ({ ...x, consumerKey: "", consumerSecret: "", appPassword: "" }));
      setSteps(null);
    }, "Settings saved securely. Now run Test Connection.");

  const test = () => act("test", async () => {
    const r = await api<{ result: { ok: boolean; steps: Step[] }; connection: PublicConnection }>("/api/integration/test", { method: "POST" });
    setSteps(r.result.steps);
    setConn(r.connection);
    if (r.result.ok) toast.success("Connection verified");
    else toast.error("Connection test failed — see details");
  });

  const enable = (enabled: boolean) => act("enable", async () => {
    const r = await api<{ connection: PublicConnection }>("/api/integration/enable", { body: { enabled } });
    setConn(r.connection);
    loadJobs();
  }, enabled ? "Synchronisation enabled — initial import queued" : "Synchronisation paused");

  const sync = (type: string, fullResync = false) => act(`sync-${type}-${fullResync}`, async () => {
    const r = await api<{ deduplicated: boolean }>("/api/integration/sync", { body: { type, fullResync } });
    toast.info(r.deduplicated ? "A sync is already queued" : "Sync queued — it will start in a moment");
    setTimeout(loadJobs, 800);
  });

  const openLogs = async (id: string) => {
    try { setLogJob(await api(`/api/integration/jobs/${id}`)); } catch (e) { toast.error((e as Error).message); }
  };

  const webhookAction = (action: "register" | "reveal" | "rotate") => act(`wh-${action}`, async () => {
    const r = await api<{ secret?: string; deliveryUrl: string; results?: { topic: string; ok: boolean; message: string }[] }>("/api/integration/webhooks", { body: { action } });
    if (r.secret) setSecret({ secret: r.secret, deliveryUrl: r.deliveryUrl });
    if (r.results) setWhResults(r.results);
  }, action === "register" ? "Webhook registration finished" : action === "rotate" ? "Secret rotated — update WooCommerce webhooks" : undefined);

  const copy = (t: string) => navigator.clipboard.writeText(t).then(() => toast.success("Copied"));
  const statusTone = conn?.status === "CONNECTED" ? "success" : conn?.status === "ERROR" ? "danger" : "neutral";

  return (
    <div className="grid gap-4 xl:grid-cols-5">
      <div className="space-y-4 xl:col-span-3">
        <div className="card p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 font-display text-2xl font-semibold"><KeyRound className="h-5 w-5 text-gold" /> Connection settings</h2>
            {conn && <Badge tone={statusTone} dot>{conn.status === "UNTESTED" ? "Not tested" : conn.status.toLowerCase()}</Badge>}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Website URL" required className="sm:col-span-2" hint="Your WordPress site address, e.g. https://www.yourstore.com"><Input value={f.siteUrl} onChange={set("siteUrl")} placeholder="https://" disabled={!canManage} /></Field>
            <Field label="Integration type" className="sm:col-span-2" hint="WooCommerce gives products + orders. Use the generic adapter only if WooCommerce is not installed (products only).">
              <Select value={f.adapter} onChange={set("adapter")} disabled={!canManage}><option value="WOOCOMMERCE">WooCommerce REST API (recommended)</option><option value="WP_POST_TYPE">WordPress REST API — custom post type (no WooCommerce)</option></Select>
            </Field>
            {f.adapter === "WOOCOMMERCE" ? (
              <>
                <Field label="Consumer key" hint={conn?.consumerKeyMasked ? `Stored: ${conn.consumerKeyMasked} — leave blank to keep` : "Starts with ck_"}><Input value={f.consumerKey} onChange={set("consumerKey")} placeholder="ck_…" autoComplete="off" disabled={!canManage} /></Field>
                <Field label="Consumer secret" hint={conn?.consumerSecretMasked ? `Stored: ${conn.consumerSecretMasked} — leave blank to keep` : "Starts with cs_"}><Input type="password" value={f.consumerSecret} onChange={set("consumerSecret")} placeholder="cs_…" autoComplete="new-password" disabled={!canManage} /></Field>
              </>
            ) : (
              <>
                <Field label="WordPress username"><Input value={f.wpUsername} onChange={set("wpUsername")} disabled={!canManage} /></Field>
                <Field label="Application password" hint={conn?.appPasswordMasked ? `Stored: ${conn.appPasswordMasked}` : "Users → Profile → Application Passwords"}><Input type="password" value={f.appPassword} onChange={set("appPassword")} autoComplete="new-password" disabled={!canManage} /></Field>
                <Field label="Post type"><Input value={f.postType} onChange={set("postType")} disabled={!canManage} /></Field>
                <Field label="SKU meta key"><Input value={f.skuMetaKey} onChange={set("skuMetaKey")} placeholder="_sku" disabled={!canManage} /></Field>
                <Field label="Price meta key"><Input value={f.priceMetaKey} onChange={set("priceMetaKey")} placeholder="price" disabled={!canManage} /></Field>
                <Field label="Stock meta key"><Input value={f.stockMetaKey} onChange={set("stockMetaKey")} placeholder="stock" disabled={!canManage} /></Field>
              </>
            )}
            <Field label="Sync every (minutes)"><Input type="number" min={5} max={1440} value={f.syncIntervalMinutes} onChange={set("syncIntervalMinutes")} disabled={!canManage} /></Field>
            <Field label="Records per API page" hint="Lower this if your host is slow or rate-limits"><Input type="number" min={10} max={100} value={f.perPage} onChange={set("perPage")} disabled={!canManage} /></Field>
          </div>
          <p className="mt-4 flex items-start gap-2 rounded-xl border border-line/50 bg-surface-2/60 p-3 text-[11px] text-muted"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-success" /><span>Credentials are encrypted (AES-256-GCM) on the server and never sent back to the browser. Use a <b>Read</b>-only WooCommerce key unless you want the CRM to register webhooks for you (Read/Write). The CRM never writes products, orders or stock to your website.</span></p>
          {canManage && (
            <div className="mt-4 flex flex-wrap gap-2">
              <Button loading={busy === "save"} onClick={save} disabled={!f.siteUrl}>Save settings</Button>
              <Button variant="gold" loading={busy === "test"} onClick={test} disabled={!conn}><PlugZap className="h-4 w-4" /> Test connection</Button>
            </div>
          )}
          {(steps || conn?.lastTestedAt) && (
            <div className="mt-5 rounded-xl border border-line/60 p-4">
              <div className="mb-2 flex items-center justify-between text-xs text-subtle"><span>Connection test</span><span>{conn?.lastTestedAt && `Last run ${timeAgo(conn.lastTestedAt)}`}</span></div>
              {steps ? (
                <ul className="space-y-2">{steps.map((s, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm">{s.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" /> : <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-danger" />}<span><b className="font-medium">{s.name}:</b> <span className="text-muted">{s.message}</span></span></li>
                ))}</ul>
              ) : (
                <p className="text-sm text-muted">{conn?.lastTestMessage}</p>
              )}
              {conn?.wpVersionInfo && <p className="mt-2 text-xs text-subtle">{conn.siteName} · {conn.wpVersionInfo}</p>}
            </div>
          )}
        </div>

        <div className="card overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line/50 px-5 py-4">
            <div><h3 className="text-sm font-semibold">Sync history & logs</h3><p className="text-xs text-muted">Jobs retry automatically with backoff after network errors, timeouts and rate limits.</p></div>
            <Button size="sm" variant="ghost" onClick={loadJobs}><RefreshCw className="h-3.5 w-3.5" /> Refresh</Button>
          </div>
          {jobs.length === 0 ? <p className="p-6 text-center text-sm text-muted">No sync jobs yet.</p> : (
            <div className="overflow-x-auto">
              <table className="table-base">
                <thead><tr><th>Started</th><th>Type</th><th>Trigger</th><th>Status</th><th>Result</th><th /></tr></thead>
                <tbody>
                  {jobs.map((j) => (
                    <tr key={j.id}>
                      <td className="whitespace-nowrap text-xs text-muted">{formatDate(j.startedAt ?? j.createdAt, true)}</td>
                      <td className="text-xs">{j.type.toLowerCase()}</td>
                      <td className="text-xs text-muted">{j.trigger.toLowerCase()}</td>
                      <td><Badge tone={j.status === "SUCCEEDED" ? "success" : j.status === "FAILED" ? "danger" : j.status === "PARTIAL" ? "warning" : j.status === "RUNNING" ? "brand" : "neutral"} dot>{j.status === "RUNNING" && <Loader2 className="h-3 w-3 animate-spin" />}{j.status.toLowerCase()}</Badge>{j.status === "QUEUED" && j.attempts > 0 && <div className="mt-0.5 text-[10px] text-subtle">retry {j.attempts}/{j.maxAttempts} at {new Date(j.runAfter).toLocaleTimeString()}</div>}</td>
                      <td className="min-w-[200px] text-[11px] text-muted">{j.stats ? Object.entries(j.stats).map(([k, s]) => `${k}: +${s.created} new, ${s.updated} updated${s.failed ? `, ${s.failed} failed` : ""}`).join(" · ") : j.error ?? "—"}</td>
                      <td className="whitespace-nowrap text-right">
                        <Button size="sm" variant="ghost" onClick={() => openLogs(j.id)}><Eye className="h-3.5 w-3.5" /> Logs</Button>
                        {canManage && (j.status === "FAILED" || j.status === "PARTIAL") && <Button size="sm" variant="ghost" loading={busy === `retry-${j.id}`} onClick={() => act(`retry-${j.id}`, () => api(`/api/integration/jobs/${j.id}/retry`, { method: "POST" }).then(loadJobs), "Retry queued")}><RotateCcw className="h-3.5 w-3.5" /> Retry</Button>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <div className="space-y-4 xl:col-span-2">
        <div className="card p-5">
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold"><Power className="h-4 w-4 text-gold" /> Synchronisation</h3>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between"><dt className="text-muted">Status</dt><dd>{conn?.enabled ? <Badge tone="success" dot>Enabled</Badge> : <Badge>Disabled</Badge>}</dd></div>
            <div className="flex justify-between"><dt className="text-muted">Last sync attempt</dt><dd>{conn?.lastSyncAt ? timeAgo(conn.lastSyncAt) : "never"}</dd></div>
            <div className="flex justify-between"><dt className="text-muted">Last successful sync</dt><dd className={cn(conn?.isStale && "text-warning")}>{conn?.lastSuccessfulSyncAt ? formatDate(conn.lastSuccessfulSyncAt, true) : "never"}</dd></div>
            <div className="flex justify-between"><dt className="text-muted">Schedule</dt><dd>every {conn?.syncIntervalMinutes ?? "—"} min</dd></div>
            <div className="flex justify-between"><dt className="text-muted">WooCommerce</dt><dd>{conn?.wooCommerceDetected === null || conn?.wooCommerceDetected === undefined ? "not checked" : conn.wooCommerceDetected ? "detected" : "not found"}</dd></div>
          </dl>
          {conn?.isStale && <p className="mt-3 rounded-xl border border-warning/30 bg-warning/10 p-2 text-xs text-warning">Website data is stale — the last successful sync is older than three sync intervals.</p>}
          {demoPresent && <p className="mt-3 rounded-xl border border-gold/30 bg-gold/10 p-2 text-xs text-gold">Demo data is loaded. Clear it in Settings → General before enabling sync, so demo and real data never mix.</p>}
          {canManage && conn && (
            <div className="mt-4 flex flex-wrap gap-2">
              {conn.enabled ? <Button variant="danger" size="sm" loading={busy === "enable"} onClick={() => enable(false)}>Pause sync</Button> : <Button size="sm" loading={busy === "enable"} disabled={conn.status !== "CONNECTED" || demoPresent} onClick={() => enable(true)}>Enable sync & import</Button>}
              <Button size="sm" variant="gold" disabled={!conn.enabled} loading={busy === "sync-FULL-false"} onClick={() => sync("FULL")}><RefreshCw className="h-3.5 w-3.5" /> Sync now</Button>
              <Button size="sm" variant="secondary" disabled={!conn.enabled} loading={busy === "sync-PRODUCTS-false"} onClick={() => sync("PRODUCTS")}>Products only</Button>
              <Button size="sm" variant="secondary" disabled={!conn.enabled || conn.adapter !== "WOOCOMMERCE"} loading={busy === "sync-ORDERS-false"} onClick={() => sync("ORDERS")}>Orders only</Button>
              <Button size="sm" variant="ghost" disabled={!conn.enabled} loading={busy === "sync-FULL-true"} onClick={() => confirm("Re-read every product and order from the website? Duplicates are prevented; local stock and fulfilment data are not overwritten.") && sync("FULL", true)}>Full re-import</Button>
            </div>
          )}
          {!conn && <p className="mt-3 text-sm text-muted">Save your website settings first.</p>}
        </div>

        {conn?.adapter === "WOOCOMMERCE" && (
          <div className="card p-5">
            <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold"><Webhook className="h-4 w-4 text-gold" /> Real-time webhooks</h3>
            <p className="mb-3 text-xs text-muted">Webhooks push order and product changes instantly. Scheduled sync remains as a safety net.</p>
            <div className="rounded-xl border border-line/50 bg-surface-2/60 p-3">
              <div className="text-[11px] uppercase tracking-wider text-subtle">Delivery URL</div>
              <div className="mt-1 flex items-center gap-2"><code className="min-w-0 flex-1 truncate text-xs">{conn.webhookUrl}</code><button onClick={() => copy(conn.webhookUrl)} aria-label="Copy URL" className="text-subtle hover:text-fg"><Copy className="h-3.5 w-3.5" /></button></div>
            </div>
            {canManage && (
              <div className="mt-3 flex flex-wrap gap-2">
                <Button size="sm" variant="secondary" loading={busy === "wh-register"} disabled={conn.status !== "CONNECTED"} onClick={() => webhookAction("register")}>Register automatically</Button>
                <Button size="sm" variant="ghost" loading={busy === "wh-reveal"} onClick={() => webhookAction("reveal")}><Eye className="h-3.5 w-3.5" /> Show secret</Button>
                <Button size="sm" variant="ghost" loading={busy === "wh-rotate"} onClick={() => confirm("Rotate the webhook secret? Existing WooCommerce webhooks must be updated with the new secret.") && webhookAction("rotate")}><RotateCcw className="h-3.5 w-3.5" /> Rotate</Button>
              </div>
            )}
            {whResults && <ul className="mt-3 space-y-1 text-xs">{whResults.map((r) => <li key={r.topic} className="flex items-center gap-2">{r.ok ? <CheckCircle2 className="h-3.5 w-3.5 text-success" /> : <XCircle className="h-3.5 w-3.5 text-danger" />}<b>{r.topic}</b> <span className="text-muted">{r.message}</span></li>)}</ul>}
            <div className="mt-4">
              <div className="mb-1 text-[11px] uppercase tracking-wider text-subtle">Recent deliveries</div>
              {webhooks.length === 0 ? <p className="text-xs text-muted">No webhook deliveries received yet.</p> : (
                <ul className="space-y-1">{webhooks.slice(0, 8).map((w) => (
                  <li key={w.id} className="flex items-center gap-2 text-xs">{w.status === "processed" ? <CheckCircle2 className="h-3.5 w-3.5 text-success" /> : w.status === "failed" ? <XCircle className="h-3.5 w-3.5 text-danger" /> : <CircleDashed className="h-3.5 w-3.5 text-subtle" />}<span className="font-mono">{w.topic}</span><span className="text-muted">#{w.resourceId ?? "—"}</span><span className="ml-auto text-subtle">{timeAgo(w.receivedAt)}</span></li>
                ))}</ul>
              )}
            </div>
          </div>
        )}
      </div>

      <Modal size="xl" open={!!logJob} onClose={() => setLogJob(null)} title="Sync job log" description={logJob ? `${logJob.type} · ${logJob.trigger} · ${logJob.status}` : ""}>
        <div className="max-h-[60vh] space-y-1 overflow-auto font-mono text-[11px]">
          {logJob?.logs.length === 0 && <p className="text-muted">No log lines.</p>}
          {logJob?.logs.map((l) => (
            <div key={l.id} className={cn("flex gap-3", l.level === "error" ? "text-danger" : l.level === "warn" ? "text-warning" : "text-muted")}><span className="shrink-0 text-subtle">{new Date(l.createdAt).toLocaleTimeString()}</span><span className="break-all">{l.message}</span></div>
          ))}
          {logJob?.error && <div className="mt-2 text-danger">Error: {logJob.error}</div>}
        </div>
      </Modal>
      <Modal open={!!secret} onClose={() => setSecret(null)} title="Webhook secret" description="Paste this into each WooCommerce webhook (WooCommerce → Settings → Advanced → Webhooks). Treat it like a password.">
        {secret && (
          <div className="space-y-3">
            <Field label="Delivery URL"><div className="flex gap-2"><Input readOnly value={secret.deliveryUrl} /><Button variant="secondary" onClick={() => copy(secret.deliveryUrl)}><Copy className="h-4 w-4" /></Button></div></Field>
            <Field label="Secret"><div className="flex gap-2"><Input readOnly value={secret.secret} className="font-mono" /><Button variant="secondary" onClick={() => copy(secret.secret)}><Copy className="h-4 w-4" /></Button></div></Field>
            <p className="text-xs text-muted">Topics: order.created, order.updated, order.deleted, product.created, product.updated, product.deleted · API version: WP REST API Integration v3.</p>
          </div>
        )}
      </Modal>
    </div>
  );
}
