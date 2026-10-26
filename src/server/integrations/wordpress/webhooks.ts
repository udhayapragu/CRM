/**
 * WooCommerce webhook processing.
 * Signature: base64(HMAC-SHA256(rawBody, secret)) in the `X-WC-Webhook-Signature` header.
 * Deliveries are de-duplicated by `X-WC-Webhook-Delivery-ID`.
 */
import { createHmac } from "crypto";
import { prisma } from "@/lib/db";
import { decryptSecret, safeEqual } from "@/lib/crypto";
import { hasDemoData } from "@/server/services/settings";
import { mapWcOrder, mapWcProduct } from "./mappers";
import { buildAdapter } from "./connection-service";
import { enqueueSync } from "./job-runner";
import { flagOrderDeletedAtSource, markProductDeletedAtSource, upsertOrder, upsertProduct } from "./sync-service";

export function computeSignature(rawBody: string, secret: string) {
  return createHmac("sha256", secret).update(rawBody, "utf8").digest("base64");
}

export interface WebhookHeaders {
  signature: string | null;
  topic: string | null;
  deliveryId: string | null;
  resource: string | null;
  event: string | null;
}

export type WebhookResult = { status: number; body: Record<string, unknown> };

export async function handleWooWebhook(connectionId: string, rawBody: string, h: WebhookHeaders): Promise<WebhookResult> {
  const connection = await prisma.wordPressConnection.findUnique({ where: { id: connectionId } });
  if (!connection || !connection.webhookSecretEnc) return { status: 404, body: { error: "Unknown endpoint" } };

  // WooCommerce sends an unsigned form-encoded ping when a webhook is created/saved.
  if (!h.signature && /^webhook_id=\d+$/.test(rawBody.trim())) return { status: 200, body: { ok: true, ping: true } };

  const expected = computeSignature(rawBody, decryptSecret(connection.webhookSecretEnc));
  if (!h.signature || !safeEqual(expected, h.signature)) return { status: 401, body: { error: "Invalid signature" } };

  const deliveryId = h.deliveryId || `${h.topic}:${expected.slice(0, 24)}`;
  const topic = h.topic || `${h.resource}.${h.event}`;

  // Dedupe: the unique (connectionId, deliveryId) constraint makes replays a no-op.
  try {
    await prisma.webhookEvent.create({ data: { connectionId, deliveryId, topic, status: "received" } });
  } catch {
    return { status: 200, body: { ok: true, duplicate: true } };
  }

  const finish = (status: string, resourceId?: string, error?: string) =>
    prisma.webhookEvent.update({
      where: { connectionId_deliveryId: { connectionId, deliveryId } },
      data: { status, resourceId: resourceId ?? null, error: error ?? null, processedAt: new Date() },
    });

  if (!connection.enabled) {
    await finish("ignored", undefined, "Synchronisation disabled");
    return { status: 200, body: { ok: true, ignored: "sync disabled" } };
  }
  if (await hasDemoData()) {
    await finish("ignored", undefined, "Demo data present");
    return { status: 200, body: { ok: true, ignored: "demo data present" } };
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    await finish("failed", undefined, "Body is not JSON");
    return { status: 400, body: { error: "Invalid JSON" } };
  }
  const resourceId = payload?.id !== undefined ? String(payload.id) : undefined;

  try {
    switch (topic) {
      case "order.created":
      case "order.updated":
      case "order.restored": {
        await upsertOrder(connection, mapWcOrder(payload), "WEBHOOK", { notifyNew: true });
        break;
      }
      case "order.deleted":
        if (resourceId) await flagOrderDeletedAtSource(connectionId, resourceId);
        break;
      case "product.created":
      case "product.updated":
      case "product.restored": {
        const p = mapWcProduct(payload);
        const variants = p.hasVariations ? await buildAdapter(connection).listVariations(p.externalId, p.name).catch(() => null) : null;
        await upsertProduct(connection, p, variants);
        break;
      }
      case "product.deleted":
        if (resourceId) await markProductDeletedAtSource(connectionId, resourceId);
        break;
      default:
        await finish("ignored", resourceId, `Unhandled topic ${topic}`);
        return { status: 200, body: { ok: true, ignored: topic } };
    }
    await finish("processed", resourceId);
    return { status: 200, body: { ok: true } };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await finish("failed", resourceId, msg.slice(0, 500));
    // Fall back to a scheduled incremental sync so the change is not lost.
    await enqueueSync(connectionId, topic.startsWith("product") ? "PRODUCTS" : "ORDERS", "WEBHOOK").catch(() => {});
    // 200 so WooCommerce does not disable the webhook after repeated failures; the job will catch up.
    return { status: 200, body: { ok: false, queued: true } };
  }
}
