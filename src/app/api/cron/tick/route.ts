import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";
import { safeEqual } from "@/lib/crypto";
import { tick } from "@/server/integrations/wordpress/job-runner";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** External scheduler entry point: `curl -X POST -H "Authorization: Bearer $CRON_SECRET" $APP_URL/api/cron/tick` */
/** Vercel Cron calls this with GET and `Authorization: Bearer $CRON_SECRET`. */
export async function GET(req: NextRequest) {
  return POST(req);
}

export async function POST(req: NextRequest) {
  const secret = env.cronSecret;
  const auth = req.headers.get("authorization") ?? "";
  if (!secret || !safeEqual(auth, `Bearer ${secret}`)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    return NextResponse.json(await tick({ maxJobs: 3 }));
  } catch (e) {
    console.error("[cron] tick failed", e);
    return NextResponse.json({ error: "Tick failed" }, { status: 500 });
  }
}
