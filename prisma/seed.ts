/**
 * Seeds reference data only (onboarding stages, default warehouse location).
 * It does NOT create users or business data: the first Super Admin is created at /setup,
 * and demo data is loaded explicitly from Settings → General.
 */
import { prisma } from "../src/lib/db";
import { ensureDefaultStages } from "../src/server/services/onboarding";
import { getDefaultLocationId } from "../src/server/services/inventory-ledger";

async function main() {
  await ensureDefaultStages();
  await getDefaultLocationId();
  console.log("Reference data ready (onboarding stages, default location).");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
