import "server-only";
import { randomBytes } from "crypto";
import { prisma } from "./db";
import { env } from "./env";

export interface SystemProblem {
  key: "DATABASE_URL" | "DATABASE_UNREACHABLE" | "MIGRATIONS" | "APP_ENCRYPTION_KEY" | "SETUP_TOKEN" | "APP_URL";
  title: string;
  fix: string;
  blocking: boolean;
  /** A freshly generated value the owner can copy (random per request; never a stored secret). */
  suggestion?: string;
}

let cachedOkAt = 0;

/**
 * Checks that the deployment is configured well enough to run. Used to show a helpful
 * "setup required" screen instead of a generic server error on a fresh deployment.
 * A healthy result is cached for 60 s so normal page loads pay no extra cost.
 */
export async function systemReadiness(opts: { force?: boolean } = {}): Promise<{ ok: boolean; problems: SystemProblem[] }> {
  if (!opts.force && Date.now() - cachedOkAt < 60_000) return { ok: true, problems: [] };
  const problems: SystemProblem[] = [];
  const url = process.env.DATABASE_URL ?? "";

  if (!url) {
    problems.push({
      key: "DATABASE_URL",
      title: "DATABASE_URL is not set",
      fix: process.env.POSTGRES_PRISMA_URL || process.env.POSTGRES_URL
        ? "A Vercel database is connected but DATABASE_URL is missing. Add an environment variable named DATABASE_URL and paste the value of POSTGRES_PRISMA_URL (or POSTGRES_URL), then redeploy."
        : "Create a free PostgreSQL database (in Vercel: Storage → Create Database → Neon) and connect it to this project. Make sure an environment variable named DATABASE_URL holds its connection string, then redeploy.",
      blocking: true,
    });
  } else {
    try {
      await prisma.$queryRaw`SELECT 1`;
      const rows = await prisma.$queryRaw<{ t: string | null }[]>`SELECT to_regclass('public."User"')::text AS t`;
      if (!rows[0]?.t) {
        problems.push({
          key: "MIGRATIONS",
          title: "The database is empty — tables have not been created",
          fix: "Redeploy: the build runs `prisma migrate deploy` automatically when DATABASE_URL is set. Or run `npx prisma migrate deploy` once from your computer with the same DATABASE_URL.",
          blocking: true,
        });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const local = /localhost|127\.0\.0\.1/.test(url) && !!process.env.VERCEL;
      problems.push({
        key: "DATABASE_UNREACHABLE",
        title: "Cannot connect to the database",
        fix: local
          ? "DATABASE_URL points to localhost, which does not exist on Vercel. Use a hosted PostgreSQL database (Neon, Supabase, Vercel Postgres…) and paste its connection string."
          : `Check that DATABASE_URL is correct, the database is running and accepts connections from your host (most hosted databases need "?sslmode=require"). Details: ${msg.split("\n").filter(Boolean).slice(-1)[0]?.slice(0, 200) ?? "unknown error"}`,
        blocking: true,
      });
    }
  }

  const key = env.encryptionKey;
  if (!key || Buffer.from(key, "base64").length !== 32) {
    problems.push({
      key: "APP_ENCRYPTION_KEY",
      title: key ? "APP_ENCRYPTION_KEY is invalid" : "APP_ENCRYPTION_KEY is not set",
      fix: "Add the value below as the APP_ENCRYPTION_KEY environment variable (it is a freshly generated random key). It is required to store WordPress credentials securely. Keep a copy somewhere safe.",
      blocking: false,
      suggestion: randomBytes(32).toString("base64"),
    });
  }
  if (env.isProduction && !env.setupToken) {
    problems.push({
      key: "SETUP_TOKEN",
      title: "SETUP_TOKEN is not set",
      fix: "Add the value below as the SETUP_TOKEN environment variable. You will type it once on the setup screen to create the first Super Admin.",
      blocking: false,
      suggestion: randomBytes(18).toString("base64url"),
    });
  }
  if (env.isProduction && (!process.env.APP_URL || !process.env.APP_URL.startsWith("https://"))) {
    problems.push({
      key: "APP_URL",
      title: "APP_URL is not set to your public https address",
      fix: "Set APP_URL to your site address, e.g. https://crmudhaya.vercel.app — it is used for webhook URLs and request origin checks.",
      blocking: false,
    });
  }

  const ok = !problems.some((p) => p.blocking);
  if (ok && problems.length === 0) cachedOkAt = Date.now();
  return { ok, problems };
}
