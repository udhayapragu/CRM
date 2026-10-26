/**
 * Build entry point used by Vercel (`vercel-build` script).
 *  1. prisma generate
 *  2. prisma migrate deploy — only when DATABASE_URL is set (creates/updates tables automatically)
 *  3. next build
 * When DATABASE_URL is missing the build still succeeds, and the app shows a
 * "setup required" screen explaining what to configure.
 */
import { execSync } from "node:child_process";

const run = (cmd, extraEnv = {}) => execSync(cmd, { stdio: "inherit", env: { ...process.env, ...extraEnv } });

run("npx prisma generate");

// Vercel's Postgres/Neon integrations may only define POSTGRES_PRISMA_URL / POSTGRES_URL.
if (!process.env.DATABASE_URL && (process.env.POSTGRES_PRISMA_URL || process.env.POSTGRES_URL)) {
  console.warn("⚠ DATABASE_URL is not set but a POSTGRES_* variable exists — add DATABASE_URL (copy the POSTGRES_PRISMA_URL value) so the app can connect at runtime.");
}

if (process.env.DATABASE_URL) {
  console.log("▶ Applying database migrations (prisma migrate deploy)…");
  try {
    // Migrations need a direct (non-pooled) connection. Vercel's Neon/Postgres integrations provide one
    // as DATABASE_URL_UNPOOLED / POSTGRES_URL_NON_POOLING; DIRECT_URL can be set manually.
    const direct = process.env.DIRECT_URL || process.env.DATABASE_URL_UNPOOLED || process.env.POSTGRES_URL_NON_POOLING;
    run("npx prisma migrate deploy", direct ? { DATABASE_URL: direct } : {});
  } catch {
    console.error(
      "\n✖ Database migration failed. Check that DATABASE_URL is correct and reachable from Vercel " +
        "(hosted databases usually need ?sslmode=require). If you use a connection pooler, set DIRECT_URL " +
        "to the direct (non-pooled) connection string.\n",
    );
    process.exit(1);
  }
} else {
  console.warn("⚠ DATABASE_URL is not set — skipping migrations. The app will show setup instructions until it is configured.");
}

run("npx next build");
