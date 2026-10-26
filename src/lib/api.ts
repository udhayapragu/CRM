import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { ZodError, type ZodTypeAny, type z } from "zod";
import { Prisma } from "@prisma/client";
import { AppError, forbidden, unauthorized } from "./errors";
import { getSessionUser, type SessionUser } from "./auth/session";
import { can, type Permission } from "./auth/permissions";
import { env } from "./env";

export const CSRF_HEADER = "x-luxe-csrf";

type RouteCtx<P> = { params: Promise<P> };

export interface HandlerContext<P> {
  req: NextRequest;
  user: SessionUser;
  params: P;
  ip: string | null;
}

interface Options {
  /** Permission(s) required; user needs ALL of them. */
  permission?: Permission | Permission[];
}

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * CSRF defence for cookie-authenticated requests:
 *  1. Session cookie is SameSite=Lax (blocks most cross-site POSTs).
 *  2. Mutations must send the custom `x-luxe-csrf` header — cross-origin pages cannot add custom
 *     headers without a CORS preflight, which this app never approves.
 *  3. If an Origin header is present it must match the app host.
 */
export function checkCsrf(req: NextRequest) {
  if (!MUTATING.has(req.method)) return;
  if (req.headers.get(CSRF_HEADER) !== "1") {
    throw new AppError("Missing CSRF header", 403, "CSRF");
  }
  const origin = req.headers.get("origin");
  if (origin) {
    const host = req.headers.get("x-forwarded-host") || req.headers.get("host");
    let originHost: string;
    try {
      originHost = new URL(origin).host;
    } catch {
      throw new AppError("Invalid Origin header", 403, "CSRF");
    }
    const appHost = (() => {
      try {
        return new URL(env.appUrl).host;
      } catch {
        return null;
      }
    })();
    if (originHost !== host && originHost !== appHost) {
      throw new AppError("Cross-origin request rejected", 403, "CSRF");
    }
  }
}

export function errorResponse(err: unknown) {
  if (err instanceof AppError) {
    return NextResponse.json({ error: err.message, code: err.code, details: err.details }, { status: err.status });
  }
  if (err instanceof ZodError) {
    return NextResponse.json(
      { error: "Validation failed", code: "VALIDATION", details: err.flatten() },
      { status: 400 },
    );
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2002") {
      return NextResponse.json({ error: "A record with these unique values already exists", code: "DUPLICATE" }, { status: 409 });
    }
    if (err.code === "P2025") {
      return NextResponse.json({ error: "Record not found", code: "NOT_FOUND" }, { status: 404 });
    }
  }
  // Never leak internals to the client.
  console.error("[api] unhandled error", err);
  return NextResponse.json({ error: "Internal server error", code: "INTERNAL" }, { status: 500 });
}

export function clientIp(req: NextRequest) {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || null;
}

/** Wrap an authenticated route handler with auth, RBAC, CSRF and error handling. */
export function apiRoute<P = Record<string, string>>(
  options: Options,
  handler: (ctx: HandlerContext<P>) => Promise<unknown>,
) {
  return async (req: NextRequest, ctx: RouteCtx<P>) => {
    try {
      checkCsrf(req);
      const user = await getSessionUser();
      if (!user) throw unauthorized();
      const perms = options.permission ? (Array.isArray(options.permission) ? options.permission : [options.permission]) : [];
      for (const p of perms) if (!can(user.role, p)) throw forbidden();
      const params = (await ctx?.params) ?? ({} as P);
      const result = await handler({ req, user, params, ip: clientIp(req) });
      if (result instanceof Response) return result;
      return NextResponse.json(result ?? { ok: true });
    } catch (err) {
      return errorResponse(err);
    }
  };
}

export async function parseBody<S extends ZodTypeAny>(req: NextRequest, schema: S): Promise<z.infer<S>> {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    throw new AppError("Request body must be valid JSON", 400, "BAD_JSON");
  }
  return schema.parse(json);
}

export function parseQuery<S extends ZodTypeAny>(req: NextRequest, schema: S): z.infer<S> {
  const obj: Record<string, string> = {};
  req.nextUrl.searchParams.forEach((v, k) => {
    obj[k] = v;
  });
  return schema.parse(obj);
}
