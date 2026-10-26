/** Centralised, validated access to server-side environment variables. */
function bool(v: string | undefined, def = false) {
  if (v === undefined || v === "") return def;
  return ["1", "true", "yes", "on"].includes(v.toLowerCase());
}

export const env = {
  get appUrl() {
    return (process.env.APP_URL || "http://localhost:3000").replace(/\/+$/, "");
  },
  get encryptionKey() {
    return process.env.APP_ENCRYPTION_KEY || "";
  },
  get setupToken() {
    return process.env.SETUP_TOKEN || "";
  },
  get cronSecret() {
    return process.env.CRON_SECRET || "";
  },
  get sessionTtlHours() {
    const n = Number(process.env.SESSION_TTL_HOURS || 12);
    return Number.isFinite(n) && n > 0 ? n : 12;
  },
  get allowInsecureWordPressHttp() {
    return bool(process.env.ALLOW_INSECURE_WORDPRESS_HTTP, false);
  },
  get uploadDir() {
    return process.env.UPLOAD_DIR || "./uploads";
  },
  get uploadMaxBytes() {
    return Math.max(1, Number(process.env.UPLOAD_MAX_MB || 15)) * 1024 * 1024;
  },
  get isProduction() {
    return process.env.NODE_ENV === "production";
  },
};
