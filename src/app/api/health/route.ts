import { NextResponse } from "next/server";
import { systemReadiness } from "@/lib/system-check";

export const dynamic = "force-dynamic";

/** Public health check. Reports which configuration checks pass — never any values. */
export async function GET() {
  const { ok, problems } = await systemReadiness({ force: true });
  const keys = ["DATABASE_URL", "DATABASE_UNREACHABLE", "MIGRATIONS", "APP_ENCRYPTION_KEY", "SETUP_TOKEN", "APP_URL"];
  return NextResponse.json(
    {
      ok,
      checks: Object.fromEntries(keys.map((k) => [k, !problems.some((p) => p.key === k)])),
      problems: problems.map((p) => ({ key: p.key, title: p.title, blocking: p.blocking })),
    },
    { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
