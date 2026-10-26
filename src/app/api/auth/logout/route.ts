import { NextResponse, type NextRequest } from "next/server";
import { checkCsrf, errorResponse } from "@/lib/api";
import { destroySession } from "@/lib/auth/session";

export async function POST(req: NextRequest) {
  try {
    checkCsrf(req);
    await destroySession();
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
