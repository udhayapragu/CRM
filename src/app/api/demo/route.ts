import { z } from "zod";
import { apiRoute, parseBody } from "@/lib/api";
import { clearDemoData, finishDemo, loadDemoBase, loadDemoOrders } from "@/server/services/demo";

export const maxDuration = 60;

const body = z.object({ phase: z.enum(["base", "orders", "finish"]).default("base"), offset: z.coerce.number().int().min(0).default(0) });

/**
 * Demo loading runs in short phases (driven by the browser) so each request stays well within
 * serverless time limits: base → orders (batches of 4, retried safely) → finish.
 */
export const POST = apiRoute({ permission: "settings:manage" }, async ({ req, user }) => {
  const { phase, offset } = await parseBody(req, body);
  if (phase === "base") return loadDemoBase(user.id);
  if (phase === "orders") return loadDemoOrders(user.id, offset);
  await finishDemo(user.id);
  return { done: true };
});

export const DELETE = apiRoute({ permission: "settings:manage" }, async ({ user }) => ({ ok: true, removed: await clearDemoData(user.id) }));
