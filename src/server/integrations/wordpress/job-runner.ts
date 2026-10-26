/**
 * Background synchronisation jobs.
 *
 * - Jobs live in the SyncJob table (durable, visible in the UI, retryable).
 * - Workers claim jobs with `FOR UPDATE SKIP LOCKED`, so several worker processes can run safely,
 *   and at most one job per connection runs at a time.
 * - Retryable failures (network, timeouts, 429, 5xx) are re-queued with exponential backoff.
 * - `tick()` is called by `npm run worker` (long-running) or by POST /api/cron/tick (external cron).
 */
import { hostname } from "os";
import { after } from "next/server";
import { Prisma, type SyncJob, type SyncJobType, type SyncTrigger } from "@prisma/client";
import { prisma } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { notify } from "@/server/services/notifications";
import { runPeriodicChecks } from "@/server/services/periodic-checks";
import { WordPressError } from "./client";
import { buildAdapter, type AdapterDeps } from "./connection-service";
import { SyncPaused, syncOrders, syncProducts, type SyncStats } from "./sync-service";

/**
 * Time budget per invocation. On serverless hosts (Vercel) each request may only run ~60 s, so a
 * long import is processed in slices: it pauses at a page boundary and the next invocation resumes.
 * Set SYNC_TIME_BUDGET_SECONDS to override; 0 = unlimited (long-running worker).
 */
export function syncTimeBudgetMs() {
  const raw = process.env.SYNC_TIME_BUDGET_SECONDS;
  if (raw !== undefined && raw !== "") return Math.max(0, Number(raw) || 0) * 1000;
  return process.env.VERCEL ? 40_000 : 0;
}

interface JobProgress {
  phase: "products" | "orders";
  page: number;
  startedAt: string;
  stats: Record<string, SyncStats>;
}

const WORKER_ID = `${hostname()}:${process.pid}`;
const STALE_LOCK_MS = 30 * 60_000;
/** Overlap applied to incremental cursors so records modified during a run are never missed. */
const CURSOR_OVERLAP_MS = 5 * 60_000;

export async function enqueueSync(
  connectionId: string,
  type: SyncJobType,
  trigger: SyncTrigger,
  opts: { fullResync?: boolean; requestedBy?: string; retryOfId?: string } = {},
): Promise<{ job: SyncJob; deduplicated: boolean }> {
  // Do not stack identical jobs: reuse an already-queued job of the same type.
  const queued = await prisma.syncJob.findFirst({ where: { connectionId, status: "QUEUED", type: { in: [type, "FULL"] } } });
  if (queued && !(opts.fullResync && !queued.fullResync)) return { job: queued, deduplicated: true };
  const job = await prisma.syncJob.create({
    data: {
      connectionId,
      type,
      trigger,
      fullResync: opts.fullResync ?? false,
      requestedBy: opts.requestedBy ?? null,
      retryOfId: opts.retryOfId ?? null,
    },
  });
  return { job, deduplicated: false };
}

export async function retryJob(jobId: string, userId: string) {
  const job = await prisma.syncJob.findUnique({ where: { id: jobId } });
  if (!job) throw new AppError("Job not found", 404, "NOT_FOUND");
  if (job.status !== "FAILED" && job.status !== "PARTIAL") throw new AppError("Only failed or partial jobs can be retried", 409, "INVALID_STATE");
  return enqueueSync(job.connectionId, job.type, "RETRY", { fullResync: job.fullResync, requestedBy: userId, retryOfId: job.id });
}

/** Atomically claim the next runnable job. */
export async function claimNextJob(): Promise<SyncJob | null> {
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    UPDATE "SyncJob" SET status = 'RUNNING', "lockedAt" = now(), "lockedBy" = ${WORKER_ID},
           "startedAt" = now(), attempts = attempts + 1
    WHERE id = (
      SELECT j.id FROM "SyncJob" j
      JOIN "WordPressConnection" c ON c.id = j."connectionId"
      WHERE j.status = 'QUEUED' AND j."runAfter" <= now()
        AND NOT EXISTS (SELECT 1 FROM "SyncJob" r WHERE r."connectionId" = j."connectionId" AND r.status = 'RUNNING')
      ORDER BY j."runAfter" ASC
      FOR UPDATE OF j SKIP LOCKED
      LIMIT 1
    )
    RETURNING id`;
  if (!rows.length) return null;
  return prisma.syncJob.findUnique({ where: { id: rows[0].id } });
}

function isRetryable(e: unknown) {
  return e instanceof WordPressError ? e.retryable : !(e instanceof AppError);
}

export async function runJob(job: SyncJob, deps: AdapterDeps & { pageDelayMs?: number; deadline?: number } = {}) {
  const connection = await prisma.wordPressConnection.findUnique({ where: { id: job.connectionId } });
  const log = async (level: "info" | "warn" | "error", message: string, context?: Prisma.InputJsonValue) => {
    await prisma.syncLog.create({ data: { jobId: job.id, level, message: message.slice(0, 2000), context } });
  };
  if (!connection) {
    await prisma.syncJob.update({ where: { id: job.id }, data: { status: "CANCELLED", finishedAt: new Date(), error: "Connection removed" } });
    return;
  }
  if (!connection.enabled && job.trigger !== "MANUAL" && job.trigger !== "INITIAL") {
    await log("warn", "Synchronisation is disabled for this connection; job cancelled");
    await prisma.syncJob.update({ where: { id: job.id }, data: { status: "CANCELLED", finishedAt: new Date(), lockedAt: null } });
    return;
  }

  const progress = (job.progress ?? null) as JobProgress | null;
  const startedAt = progress ? new Date(progress.startedAt) : new Date();
  const stats: Record<string, SyncStats> = progress?.stats ?? {};
  const budget = syncTimeBudgetMs();
  const deadline = deps.deadline ?? (budget ? Date.now() + budget : undefined);
  try {
    const adapter = buildAdapter(connection, deps);
    const ctx = { connection, adapter, log, pageDelayMs: deps.pageDelayMs ?? 250, sleep: deps.sleep, trigger: job.trigger };
    const full = job.fullResync || job.trigger === "INITIAL";
    const wantProducts = job.type === "PRODUCTS" || job.type === "FULL";
    const wantOrders = job.type === "ORDERS" || job.type === "FULL";
    const productsDone = progress?.phase === "orders";
    if (wantProducts && !productsDone) {
      stats.products = await syncProducts(ctx, {
        full: full || !connection.productsCursor,
        startPage: progress?.phase === "products" ? progress.page : 1,
        stats: progress?.phase === "products" ? stats.products : undefined,
        runStartedAt: startedAt,
        deadline,
      });
    }
    if (wantOrders) {
      stats.orders = await syncOrders(ctx, {
        full: full || !connection.ordersCursor,
        startPage: progress?.phase === "orders" ? progress.page : 1,
        stats: progress?.phase === "orders" ? stats.orders : undefined,
        runStartedAt: startedAt,
        deadline,
      });
    }

    const failed = Object.values(stats).reduce((s, x) => s + x.failed, 0);
    const cursor = new Date(startedAt.getTime() - CURSOR_OVERLAP_MS);
    await prisma.$transaction([
      prisma.syncJob.update({
        where: { id: job.id },
        data: { status: failed ? "PARTIAL" : "SUCCEEDED", finishedAt: new Date(), stats: stats as unknown as Prisma.InputJsonValue, progress: Prisma.DbNull, lockedAt: null, error: failed ? `${failed} record(s) failed — see logs` : null },
      }),
      prisma.wordPressConnection.update({
        where: { id: connection.id },
        data: {
          lastSyncAt: new Date(),
          status: "CONNECTED",
          // Only advance cursors when every record succeeded, so failures are re-fetched next run.
          ...(failed === 0
            ? {
                lastSuccessfulSyncAt: new Date(),
                ...(stats.products ? { productsCursor: cursor } : {}),
                ...(stats.orders ? { ordersCursor: cursor } : {}),
              }
            : {}),
        },
      }),
    ]);
    if (failed) {
      await notify({
        type: "SYNC_FAILED",
        severity: "warning",
        title: "Synchronisation partially failed",
        message: `${failed} record(s) could not be imported. Open Integration → Sync logs.`,
        link: "/settings/integration",
        dedupeKey: `syncpartial:${job.id}`,
      });
    }
  } catch (e) {
    if (e instanceof SyncPaused) {
      const saved: JobProgress = { phase: e.phase, page: e.nextPage, startedAt: startedAt.toISOString(), stats: { ...stats, [e.phase]: e.stats } };
      await log("info", `Time budget reached — paused before ${e.phase} page ${e.nextPage}; the next run continues from there`);
      await prisma.syncJob.update({
        where: { id: job.id },
        // A pause is not a failed attempt.
        data: { status: "QUEUED", runAfter: new Date(), lockedAt: null, lockedBy: null, attempts: { decrement: 1 }, progress: saved as unknown as Prisma.InputJsonValue, stats: saved.stats as unknown as Prisma.InputJsonValue },
      });
      return { paused: true };
    }
    const message = e instanceof Error ? e.message : String(e);
    await log("error", `Sync failed: ${message}`);
    const retry = isRetryable(e) && job.attempts < job.maxAttempts;
    const backoffMin = Math.min(60, 2 ** job.attempts);
    await prisma.syncJob.update({
      where: { id: job.id },
      data: retry
        ? { status: "QUEUED", runAfter: new Date(Date.now() + backoffMin * 60_000), error: message, lockedAt: null, stats: stats as unknown as Prisma.InputJsonValue }
        : { status: "FAILED", finishedAt: new Date(), error: message, lockedAt: null, stats: stats as unknown as Prisma.InputJsonValue },
    });
    await prisma.wordPressConnection.update({
      where: { id: connection.id },
      data: { lastSyncAt: new Date(), ...(e instanceof WordPressError && (e.kind === "AUTH" || e.kind === "FORBIDDEN") ? { status: "ERROR", lastTestMessage: message } : {}) },
    });
    if (retry) {
      await log("warn", `Will retry in ${backoffMin} minute(s) (attempt ${job.attempts}/${job.maxAttempts})`);
    } else {
      await notify({
        type: "SYNC_FAILED",
        severity: "critical",
        title: "WordPress synchronisation failed",
        message: message.slice(0, 300),
        link: "/settings/integration",
        dedupeKey: `syncfail:${job.id}`,
      });
    }
  }
}

/** Requeue jobs whose worker died mid-run. */
export async function recoverStaleJobs() {
  const res = await prisma.syncJob.updateMany({
    where: { status: "RUNNING", lockedAt: { lt: new Date(Date.now() - STALE_LOCK_MS) } },
    data: { status: "QUEUED", lockedAt: null, lockedBy: null, error: "Recovered after worker timeout" },
  });
  return res.count;
}

/** Enqueue incremental syncs for connections whose interval has elapsed. */
export async function scheduleDueSyncs() {
  const conns = await prisma.wordPressConnection.findMany({ where: { enabled: true, status: { in: ["CONNECTED", "ERROR"] } } });
  let queued = 0;
  for (const c of conns) {
    const due = !c.lastSyncAt || Date.now() - c.lastSyncAt.getTime() >= c.syncIntervalMinutes * 60_000;
    if (!due) continue;
    const active = await prisma.syncJob.count({ where: { connectionId: c.id, status: { in: ["QUEUED", "RUNNING"] } } });
    if (active) continue;
    await enqueueSync(c.id, "FULL", "SCHEDULED");
    queued++;
  }
  return queued;
}

export async function processQueue(maxJobs = 5, deps: AdapterDeps & { pageDelayMs?: number } = {}) {
  const budget = syncTimeBudgetMs();
  const deadline = budget ? Date.now() + budget : undefined;
  let processed = 0;
  while (processed < maxJobs) {
    // Never start (or resume) a job without a useful slice of time left.
    if (deadline && deadline - Date.now() < 8_000) break;
    const job = await claimNextJob();
    if (!job) break;
    await runJob(job, { ...deps, deadline });
    processed++;
  }
  return processed;
}

let lastChecks = 0;
export async function tick(opts: { maxJobs?: number } = {}) {
  const recovered = await recoverStaleJobs();
  const scheduled = await scheduleDueSyncs();
  const processed = await processQueue(opts.maxJobs ?? 5);
  let checks = false;
  if (Date.now() - lastChecks > 10 * 60_000) {
    await runPeriodicChecks();
    lastChecks = Date.now();
    checks = true;
  }
  return { recovered, scheduled, processed, checks };
}

/**
 * Process queued jobs after the response has been sent. Uses Next.js `after()` so serverless hosts
 * keep the function alive for the work; falls back to a timer outside a request (worker, tests).
 */
export function kickQueue() {
  const work = () => processQueue(3).then(() => undefined, (e) => console.error("[sync] background processing failed", e));
  try {
    after(work);
  } catch {
    setTimeout(work, 10);
  }
}

/** True when a job is waiting to run now (used to continue paused imports while the page is open). */
export async function hasRunnableJob() {
  return (await prisma.syncJob.count({ where: { status: "QUEUED", runAfter: { lte: new Date() } } })) > 0;
}
