/**
 * Background worker: scheduled WordPress synchronisation, job retries and periodic checks.
 *   npm run worker
 * Run exactly one long-lived instance alongside the web server (multiple instances are safe —
 * jobs are claimed with SKIP LOCKED — but unnecessary). Alternatively call POST /api/cron/tick
 * from an external scheduler.
 */
import { prisma } from "../src/lib/db";
import { tick } from "../src/server/integrations/wordpress/job-runner";

const interval = Math.max(10, Number(process.env.WORKER_POLL_SECONDS || 30)) * 1000;
let stopping = false;

async function loop() {
  console.log(`[worker] started, polling every ${interval / 1000}s`);
  while (!stopping) {
    try {
      const r = await tick({ maxJobs: 5 });
      if (r.processed || r.scheduled || r.recovered) console.log(`[worker] ${new Date().toISOString()} scheduled=${r.scheduled} processed=${r.processed} recovered=${r.recovered}`);
    } catch (e) {
      console.error("[worker] tick failed:", e instanceof Error ? e.message : e);
    }
    await new Promise((r) => setTimeout(r, interval));
  }
  await prisma.$disconnect();
  console.log("[worker] stopped");
}

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    console.log(`[worker] ${sig} received, finishing current tick…`);
    stopping = true;
  });
}

loop();
