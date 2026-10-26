import type { WordPressConnection } from "@prisma/client";
import { prisma } from "@/lib/db";
import { decryptSecret, encryptSecret, maskSecret, randomToken } from "@/lib/crypto";
import { env } from "@/lib/env";
import { AppError, notFound } from "@/lib/errors";
import { audit } from "@/server/audit";
import { hasDemoData } from "@/server/services/settings";
import { normalizeSiteUrl, WordPressError } from "./client";
import type { SourceAdapter, TestResult } from "./types";
import { WooCommerceAdapter } from "./woocommerce";
import { WordPressPostTypeAdapter } from "./wp-post-type";

export interface AdapterOptions {
  authMethod?: "basic" | "query";
  restRouteMode?: boolean;
  postType?: string;
  skuMetaKey?: string;
  priceMetaKey?: string;
  stockMetaKey?: string;
}

export interface AdapterDeps {
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

/** Safe, browser-facing view of a connection (no ciphertext, masked secrets). */
export function publicConnection(c: WordPressConnection) {
  const dec = (v: string | null) => {
    if (!v) return null;
    try {
      return maskSecret(decryptSecret(v));
    } catch {
      return "(unreadable — re-enter)";
    }
  };
  const staleAfterMs = c.syncIntervalMinutes * 3 * 60_000;
  return {
    id: c.id,
    name: c.name,
    siteUrl: c.siteUrl,
    adapter: c.adapter,
    adapterOptions: (c.adapterOptions ?? {}) as AdapterOptions,
    consumerKeyMasked: dec(c.consumerKeyEnc),
    consumerSecretMasked: dec(c.consumerSecretEnc),
    wpUsername: c.wpUsername,
    appPasswordMasked: dec(c.appPasswordEnc),
    hasWebhookSecret: !!c.webhookSecretEnc,
    webhookUrl: `${env.appUrl}/api/webhooks/woocommerce/${c.id}`,
    wooCommerceDetected: c.wooCommerceDetected,
    wpVersionInfo: c.wpVersionInfo,
    siteName: c.siteName,
    status: c.status,
    lastTestedAt: c.lastTestedAt,
    lastTestMessage: c.lastTestMessage,
    enabled: c.enabled,
    syncIntervalMinutes: c.syncIntervalMinutes,
    perPage: c.perPage,
    lastSyncAt: c.lastSyncAt,
    lastSuccessfulSyncAt: c.lastSuccessfulSyncAt,
    isStale: c.enabled && (!c.lastSuccessfulSyncAt || Date.now() - c.lastSuccessfulSyncAt.getTime() > staleAfterMs),
  };
}
export type PublicConnection = ReturnType<typeof publicConnection>;

export async function getPrimaryConnection() {
  return prisma.wordPressConnection.findFirst({ orderBy: { createdAt: "asc" } });
}

export function buildAdapter(c: WordPressConnection, deps: AdapterDeps = {}): SourceAdapter {
  const opts = (c.adapterOptions ?? {}) as AdapterOptions;
  if (c.adapter === "WOOCOMMERCE") {
    if (!c.consumerKeyEnc || !c.consumerSecretEnc) {
      throw new AppError("WooCommerce consumer key and secret are required", 400, "MISSING_CREDENTIALS");
    }
    return new WooCommerceAdapter({
      siteUrl: c.siteUrl,
      consumerKey: decryptSecret(c.consumerKeyEnc),
      consumerSecret: decryptSecret(c.consumerSecretEnc),
      authMethod: opts.authMethod,
      restRouteMode: opts.restRouteMode,
      ...deps,
    });
  }
  return new WordPressPostTypeAdapter({
    siteUrl: c.siteUrl,
    username: c.wpUsername ?? undefined,
    appPassword: c.appPasswordEnc ? decryptSecret(c.appPasswordEnc) : undefined,
    postType: opts.postType || "product",
    skuMetaKey: opts.skuMetaKey,
    priceMetaKey: opts.priceMetaKey,
    stockMetaKey: opts.stockMetaKey,
    restRouteMode: opts.restRouteMode,
    ...deps,
  });
}

export interface SaveConnectionInput {
  name?: string;
  siteUrl: string;
  adapter: "WOOCOMMERCE" | "WP_POST_TYPE";
  consumerKey?: string;
  consumerSecret?: string;
  wpUsername?: string;
  appPassword?: string;
  syncIntervalMinutes?: number;
  perPage?: number;
  postType?: string;
  skuMetaKey?: string;
  priceMetaKey?: string;
  stockMetaKey?: string;
}

export async function saveConnection(input: SaveConnectionInput, actor: { userId: string; ip?: string | null }) {
  let siteUrl: string;
  try {
    siteUrl = normalizeSiteUrl(input.siteUrl);
  } catch (e) {
    throw new AppError((e as Error).message, 400, "INVALID_URL");
  }
  if (input.consumerKey && !/^ck_[A-Za-z0-9]+$/.test(input.consumerKey.trim())) {
    throw new AppError('WooCommerce consumer keys start with "ck_"', 400, "INVALID_KEY");
  }
  if (input.consumerSecret && !/^cs_[A-Za-z0-9]+$/.test(input.consumerSecret.trim())) {
    throw new AppError('WooCommerce consumer secrets start with "cs_"', 400, "INVALID_SECRET");
  }
  const existing = await getPrimaryConnection();
  const prevOpts = (existing?.adapterOptions ?? {}) as AdapterOptions;
  const adapterOptions: AdapterOptions = {
    ...prevOpts,
    postType: input.postType ?? prevOpts.postType,
    skuMetaKey: input.skuMetaKey ?? prevOpts.skuMetaKey,
    priceMetaKey: input.priceMetaKey ?? prevOpts.priceMetaKey,
    stockMetaKey: input.stockMetaKey ?? prevOpts.stockMetaKey,
  };
  const credsChanged =
    !existing ||
    existing.siteUrl !== siteUrl ||
    existing.adapter !== input.adapter ||
    !!input.consumerKey ||
    !!input.consumerSecret ||
    !!input.appPassword ||
    (input.wpUsername ?? existing.wpUsername) !== existing.wpUsername;
  if (existing && existing.siteUrl !== siteUrl) {
    const synced = await prisma.order.count({ where: { connectionId: existing.id } });
    if (synced > 0) {
      throw new AppError(
        "This connection already has synchronised orders. Changing the website URL would mix data from two sites. Contact support/reset data first.",
        409,
        "URL_LOCKED",
      );
    }
  }

  const data = {
    name: input.name?.trim() || existing?.name || "My WordPress site",
    siteUrl,
    adapter: input.adapter,
    adapterOptions: adapterOptions as object,
    ...(input.consumerKey ? { consumerKeyEnc: encryptSecret(input.consumerKey.trim()) } : {}),
    ...(input.consumerSecret ? { consumerSecretEnc: encryptSecret(input.consumerSecret.trim()) } : {}),
    ...(input.wpUsername !== undefined ? { wpUsername: input.wpUsername.trim() || null } : {}),
    ...(input.appPassword ? { appPasswordEnc: encryptSecret(input.appPassword.trim()) } : {}),
    ...(input.syncIntervalMinutes ? { syncIntervalMinutes: input.syncIntervalMinutes } : {}),
    ...(input.perPage ? { perPage: input.perPage } : {}),
    ...(credsChanged ? { status: "UNTESTED" as const, enabled: false } : {}),
  };
  const saved = existing
    ? await prisma.wordPressConnection.update({ where: { id: existing.id }, data })
    : await prisma.wordPressConnection.create({ data: { ...data, webhookSecretEnc: encryptSecret(randomToken(24)) } });
  if (!saved.webhookSecretEnc) {
    await prisma.wordPressConnection.update({ where: { id: saved.id }, data: { webhookSecretEnc: encryptSecret(randomToken(24)) } });
  }
  await audit({
    userId: actor.userId,
    action: existing ? "integration.update" : "integration.create",
    entityType: "WordPressConnection",
    entityId: saved.id,
    summary: `WordPress connection ${existing ? "updated" : "created"} for ${siteUrl}${credsChanged ? " (credentials changed — re-test required)" : ""}`,
    metadata: { adapter: input.adapter, credentialsChanged: credsChanged },
    ip: actor.ip,
  });
  return prisma.wordPressConnection.findUniqueOrThrow({ where: { id: saved.id } });
}

export async function testConnection(id: string, actor: { userId: string; ip?: string | null } | null, deps: AdapterDeps = {}): Promise<TestResult> {
  const c = await prisma.wordPressConnection.findUnique({ where: { id } });
  if (!c) throw notFound("Connection");
  let result: TestResult;
  try {
    result = await buildAdapter(c, deps).test();
  } catch (e) {
    const msg = e instanceof WordPressError || e instanceof AppError ? e.message : "Unexpected error while testing the connection";
    result = { ok: false, wooCommerceDetected: false, siteName: null, namespaces: [], versionInfo: null, steps: [{ name: "Configuration", ok: false, message: msg }] };
  }
  const failed = result.steps.find((s) => !s.ok);
  const opts = { ...((c.adapterOptions ?? {}) as AdapterOptions), ...(result.discovered ?? {}) };
  await prisma.wordPressConnection.update({
    where: { id },
    data: {
      status: result.ok ? "CONNECTED" : "ERROR",
      lastTestedAt: new Date(),
      lastTestMessage: result.ok ? "Connection verified" : failed?.message ?? "Connection failed",
      wooCommerceDetected: result.wooCommerceDetected,
      siteName: result.siteName,
      namespaces: result.namespaces.slice(0, 100),
      wpVersionInfo: result.versionInfo,
      adapterOptions: opts as object,
      ...(result.ok ? {} : { enabled: false }),
    },
  });
  if (actor) {
    await audit({
      userId: actor.userId,
      action: "integration.test",
      entityType: "WordPressConnection",
      entityId: id,
      summary: `Connection test ${result.ok ? "succeeded" : "failed"}${failed ? `: ${failed.message}` : ""}`,
      ip: actor.ip,
    });
  }
  return result;
}

export async function setConnectionEnabled(id: string, enabled: boolean, actor: { userId: string; ip?: string | null }) {
  const c = await prisma.wordPressConnection.findUnique({ where: { id } });
  if (!c) throw notFound("Connection");
  if (enabled) {
    if (c.status !== "CONNECTED") throw new AppError("Run a successful Test Connection before enabling synchronisation.", 409, "NOT_TESTED");
    if (await hasDemoData()) {
      throw new AppError("Demo data is still loaded. Clear demo data (Settings → General) before syncing real data, so the two can never be mixed.", 409, "DEMO_DATA_PRESENT");
    }
  }
  const updated = await prisma.wordPressConnection.update({ where: { id }, data: { enabled } });
  await audit({ userId: actor.userId, action: enabled ? "integration.enable" : "integration.disable", entityType: "WordPressConnection", entityId: id, summary: `Synchronisation ${enabled ? "enabled" : "disabled"}`, ip: actor.ip });
  return updated;
}

export async function revealWebhookSecret(id: string, actor: { userId: string; ip?: string | null }) {
  const c = await prisma.wordPressConnection.findUnique({ where: { id } });
  if (!c?.webhookSecretEnc) throw notFound("Webhook secret");
  await audit({ userId: actor.userId, action: "integration.reveal_webhook_secret", entityType: "WordPressConnection", entityId: id, summary: "Webhook secret revealed", ip: actor.ip });
  return decryptSecret(c.webhookSecretEnc);
}

export async function rotateWebhookSecret(id: string, actor: { userId: string; ip?: string | null }) {
  const secret = randomToken(24);
  await prisma.wordPressConnection.update({ where: { id }, data: { webhookSecretEnc: encryptSecret(secret) } });
  await audit({ userId: actor.userId, action: "integration.rotate_webhook_secret", entityType: "WordPressConnection", entityId: id, summary: "Webhook secret rotated", ip: actor.ip });
  return secret;
}
