import { defineConfig } from "vitest/config";
import path from "path";

const TEST_DB = process.env.TEST_DATABASE_URL ?? "postgresql://luxe:luxe_password@localhost:5432/luxe_crm_test?schema=public";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      "server-only": path.resolve(__dirname, "tests/stubs/server-only.ts"),
    },
  },
  test: {
    environment: "node",
    globalSetup: ["./tests/global-setup.ts"],
    fileParallelism: false,
    testTimeout: 60000,
    hookTimeout: 120000,
    env: {
      DATABASE_URL: TEST_DB,
      TEST_DATABASE_URL: TEST_DB,
      APP_ENCRYPTION_KEY: "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=",
      APP_URL: "https://crm.example.test",
      CRON_SECRET: "test-cron-secret",
    },
  },
});
