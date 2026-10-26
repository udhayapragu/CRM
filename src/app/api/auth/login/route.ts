import { NextResponse, type NextRequest } from "next/server";
import { checkCsrf, clientIp, errorResponse } from "@/lib/api";
import { AppError } from "@/lib/errors";
import { rateLimit } from "@/lib/rate-limit";
import { loginSchema } from "@/lib/validation";
import { createSession } from "@/lib/auth/session";
import { authenticate } from "@/server/services/users";

export async function POST(req: NextRequest) {
  try {
    checkCsrf(req);
    const ip = clientIp(req) ?? "unknown";
    const rl = rateLimit(`login:${ip}`, 10, 15 * 60_000);
    if (!rl.ok) throw new AppError(`Too many login attempts. Try again in ${Math.ceil(rl.retryAfterSec / 60)} minute(s).`, 429, "RATE_LIMITED");
    const body = loginSchema.parse(await req.json().catch(() => ({})));
    const user = await authenticate(body.email, body.password, ip);
    await createSession(user.id, { ip, userAgent: req.headers.get("user-agent") });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
