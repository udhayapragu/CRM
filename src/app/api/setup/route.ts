import { NextResponse, type NextRequest } from "next/server";
import { checkCsrf, clientIp, errorResponse } from "@/lib/api";
import { AppError } from "@/lib/errors";
import { rateLimit } from "@/lib/rate-limit";
import { setupSchema } from "@/lib/validation";
import { createSession } from "@/lib/auth/session";
import { performSetup } from "@/server/services/users";

export async function POST(req: NextRequest) {
  try {
    checkCsrf(req);
    const ip = clientIp(req);
    if (!rateLimit(`setup:${ip}`, 10, 15 * 60_000).ok) throw new AppError("Too many attempts", 429, "RATE_LIMITED");
    const body = setupSchema.parse(await req.json().catch(() => ({})));
    const user = await performSetup(body, ip);
    await createSession(user.id, { ip, userAgent: req.headers.get("user-agent") });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
