import { apiRoute } from "@/lib/api";
import { clearDemoData, loadDemoData } from "@/server/services/demo";

export const maxDuration = 300;

export const POST = apiRoute({ permission: "settings:manage" }, async ({ user }) => {
  await loadDemoData(user.id);
  return { ok: true };
});

export const DELETE = apiRoute({ permission: "settings:manage" }, async ({ user }) => ({ ok: true, removed: await clearDemoData(user.id) }));
