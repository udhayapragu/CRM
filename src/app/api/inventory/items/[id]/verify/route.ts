import { apiRoute } from "@/lib/api";
import { audit } from "@/server/audit";
import { rebuildItemCache, verifyItem } from "@/server/services/inventory-ledger";

/** GET: compare cached totals with a recomputation from the ledger. POST: repair the cache. */
export const GET = apiRoute<{ id: string }>({ permission: "inventory:view" }, async ({ params }) => verifyItem(params.id));

export const POST = apiRoute<{ id: string }>({ permission: "inventory:manage" }, async ({ params, user, ip }) => {
  const result = await rebuildItemCache(params.id);
  await audit({ userId: user.id, action: "inventory.rebuild_cache", entityType: "InventoryItem", entityId: params.id, summary: result.ok ? "Verified: cached totals match ledger" : "Cached totals rebuilt from ledger", metadata: result as never, ip });
  return result;
});
