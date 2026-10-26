import { z } from "zod";
import { apiRoute, parseBody } from "@/lib/api";
import { AppError } from "@/lib/errors";
import { decryptSecret } from "@/lib/crypto";
import { env } from "@/lib/env";
import { audit } from "@/server/audit";
import { buildAdapter, getPrimaryConnection, revealWebhookSecret, rotateWebhookSecret } from "@/server/integrations/wordpress/connection-service";

/**
 * action=register — create/update WooCommerce webhooks via the API (needs a Read/Write key).
 * action=reveal   — show the webhook secret (to paste into WooCommerce manually).
 * action=rotate   — generate a new secret (existing webhooks must be updated).
 */
export const POST = apiRoute({ permission: "integration:manage" }, async ({ req, user, ip }) => {
  const { action } = await parseBody(req, z.object({ action: z.enum(["register", "reveal", "rotate"]) }));
  const c = await getPrimaryConnection();
  if (!c) throw new AppError("No connection configured", 400, "NO_CONNECTION");
  const deliveryUrl = `${env.appUrl}/api/webhooks/woocommerce/${c.id}`;
  if (action === "reveal") return { secret: await revealWebhookSecret(c.id, { userId: user.id, ip }), deliveryUrl };
  if (action === "rotate") return { secret: await rotateWebhookSecret(c.id, { userId: user.id, ip }), deliveryUrl };
  if (c.status !== "CONNECTED") throw new AppError("Test the connection successfully first", 409, "NOT_TESTED");
  if (!deliveryUrl.startsWith("https://")) throw new AppError("APP_URL must be a public https:// address for WooCommerce to deliver webhooks", 409, "APP_URL_NOT_PUBLIC");
  const adapter = buildAdapter(c);
  if (!adapter.registerWebhooks || !c.webhookSecretEnc) throw new AppError("This connection type does not support webhooks", 400, "UNSUPPORTED");
  const results = await adapter.registerWebhooks(deliveryUrl, decryptSecret(c.webhookSecretEnc));
  await audit({ userId: user.id, action: "integration.register_webhooks", entityType: "WordPressConnection", entityId: c.id, summary: `Webhook registration: ${results.filter((r) => r.ok).length}/${results.length} succeeded`, metadata: results as never, ip });
  return { results, deliveryUrl };
});
