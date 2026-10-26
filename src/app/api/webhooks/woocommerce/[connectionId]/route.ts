import { NextResponse, type NextRequest } from "next/server";
import { rateLimit } from "@/lib/rate-limit";
import { handleWooWebhook } from "@/server/integrations/wordpress/webhooks";

export const maxDuration = 60;

export const dynamic = "force-dynamic";

/** Public endpoint for WooCommerce webhooks — authenticated by HMAC signature, not by session. */
export async function POST(req: NextRequest, ctx: { params: Promise<{ connectionId: string }> }) {
  const { connectionId } = await ctx.params;
  if (!/^[a-z0-9]{10,40}$/i.test(connectionId)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!rateLimit(`webhook:${connectionId}`, 600, 60_000).ok) return NextResponse.json({ error: "Rate limited" }, { status: 429 });
  const raw = await req.text();
  if (raw.length > 5_000_000) return NextResponse.json({ error: "Payload too large" }, { status: 413 });
  try {
    const res = await handleWooWebhook(connectionId, raw, {
      signature: req.headers.get("x-wc-webhook-signature"),
      topic: req.headers.get("x-wc-webhook-topic"),
      deliveryId: req.headers.get("x-wc-webhook-delivery-id"),
      resource: req.headers.get("x-wc-webhook-resource"),
      event: req.headers.get("x-wc-webhook-event"),
    });
    return NextResponse.json(res.body, { status: res.status });
  } catch (e) {
    console.error("[webhook] error", e);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
