/**
 * Minimal, defensive HTTP client for the WordPress / WooCommerce REST APIs.
 * - Timeouts, retries with exponential backoff, Retry-After support for HTTP 429.
 * - Classifies failures so the UI can show actionable messages.
 * - Credentials are only ever sent over HTTPS (unless explicitly allowed for local development).
 */
import { env } from "@/lib/env";

export type WpErrorKind =
  | "INVALID_URL"
  | "INSECURE_URL"
  | "NETWORK"
  | "TIMEOUT"
  | "AUTH"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "RATE_LIMIT"
  | "SERVER"
  | "INVALID_RESPONSE";

export class WordPressError extends Error {
  constructor(
    public kind: WpErrorKind,
    message: string,
    public status?: number,
    public retryable = false,
  ) {
    super(message);
    this.name = "WordPressError";
  }
}

export interface ClientAuth {
  type: "basic" | "query" | "none";
  username?: string;
  password?: string;
}

export interface ClientOptions {
  baseUrl: string;
  auth?: ClientAuth;
  timeoutMs?: number;
  maxRetries?: number;
  /** Use ?rest_route= instead of /wp-json/ (sites without pretty permalinks). */
  restRouteMode?: boolean;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

const PRIVATE_HOST = /^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.|\[?::1\]?$|172\.(1[6-9]|2\d|3[01])\.)/i;

export function normalizeSiteUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new WordPressError("INVALID_URL", "Enter a valid website URL, e.g. https://www.example.com");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new WordPressError("INVALID_URL", "Website URL must start with https://");
  }
  if (url.protocol === "http:" && !env.allowInsecureWordPressHttp) {
    throw new WordPressError(
      "INSECURE_URL",
      "For security, the website must use https:// so API credentials are encrypted in transit.",
    );
  }
  if (env.isProduction && PRIVATE_HOST.test(url.hostname) && !env.allowInsecureWordPressHttp) {
    throw new WordPressError("INVALID_URL", "Private/internal network addresses are not allowed for the website URL.");
  }
  url.hash = "";
  url.search = "";
  return url.toString().replace(/\/+$/, "");
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export interface WpResponse<T> {
  data: T;
  status: number;
  headers: Headers;
}

export class WordPressClient {
  private base: string;
  private fetchImpl: typeof fetch;
  private sleep: (ms: number) => Promise<void>;

  constructor(private opts: ClientOptions) {
    this.base = normalizeSiteUrl(opts.baseUrl);
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.sleep = opts.sleep ?? defaultSleep;
  }

  withOptions(patch: Partial<ClientOptions>) {
    return new WordPressClient({ ...this.opts, ...patch });
  }

  buildUrl(route: string, query: Record<string, string | number | boolean | undefined | null> = {}) {
    const clean = route.replace(/^\/+/, "");
    const url = this.opts.restRouteMode
      ? new URL(`${this.base}/`)
      : new URL(`${this.base}/wp-json/${clean}`);
    if (this.opts.restRouteMode) url.searchParams.set("rest_route", `/${clean}`);
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
    }
    const auth = this.opts.auth;
    if (auth?.type === "query" && auth.username && auth.password) {
      url.searchParams.set("consumer_key", auth.username);
      url.searchParams.set("consumer_secret", auth.password);
    }
    return url;
  }

  async request<T>(
    route: string,
    init: { method?: string; query?: Record<string, string | number | boolean | undefined | null>; body?: unknown; authenticated?: boolean } = {},
  ): Promise<WpResponse<T>> {
    const url = this.buildUrl(route, init.query);
    const headers: Record<string, string> = { Accept: "application/json", "User-Agent": "LuxeCRM/1.0 (+sync)" };
    const auth = this.opts.auth;
    if (init.authenticated !== false && auth?.type === "basic" && auth.username && auth.password) {
      headers.Authorization = "Basic " + Buffer.from(`${auth.username}:${auth.password}`).toString("base64");
    }
    if (init.body !== undefined) headers["Content-Type"] = "application/json";
    if (init.authenticated === false && auth?.type === "query") {
      url.searchParams.delete("consumer_key");
      url.searchParams.delete("consumer_secret");
    }

    const maxRetries = this.opts.maxRetries ?? 3;
    let attempt = 0;
    let lastErr: WordPressError | null = null;
    while (attempt <= maxRetries) {
      attempt++;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.opts.timeoutMs ?? 20_000);
      try {
        const res = await this.fetchImpl(url, {
          method: init.method ?? "GET",
          headers,
          body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
          signal: controller.signal,
          redirect: "follow",
          cache: "no-store",
        });
        clearTimeout(timer);
        if (res.ok) {
          const text = await res.text();
          try {
            return { data: (text ? JSON.parse(text) : null) as T, status: res.status, headers: res.headers };
          } catch {
            throw new WordPressError(
              "INVALID_RESPONSE",
              "The website returned a non-JSON response. A security/caching plugin or firewall may be blocking the REST API.",
              res.status,
            );
          }
        }
        const err = await this.classify(res);
        if (err.retryable && attempt <= maxRetries) {
          lastErr = err;
          const retryAfter = Number(res.headers.get("retry-after"));
          const wait = Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter, 60) * 1000 : 500 * 2 ** (attempt - 1);
          await this.sleep(wait);
          continue;
        }
        throw err;
      } catch (e) {
        clearTimeout(timer);
        if (e instanceof WordPressError) {
          if (e.retryable && attempt <= maxRetries) {
            lastErr = e;
            await this.sleep(500 * 2 ** (attempt - 1));
            continue;
          }
          throw e;
        }
        const aborted = e instanceof Error && e.name === "AbortError";
        lastErr = new WordPressError(
          aborted ? "TIMEOUT" : "NETWORK",
          aborted
            ? "The website did not respond in time."
            : `Could not reach the website (${e instanceof Error ? e.message : "network error"}).`,
          undefined,
          true,
        );
        if (attempt <= maxRetries) {
          await this.sleep(500 * 2 ** (attempt - 1));
          continue;
        }
        throw lastErr;
      }
    }
    throw lastErr ?? new WordPressError("NETWORK", "Request failed");
  }

  private async classify(res: Response): Promise<WordPressError> {
    let detail = "";
    try {
      const body = (await res.json()) as { message?: string; code?: string };
      detail = body?.message ? ` (${body.code ?? ""}: ${String(body.message).replace(/<[^>]+>/g, "").slice(0, 200)})` : "";
    } catch {
      /* body not JSON */
    }
    if (res.status === 401) return new WordPressError("AUTH", `Authentication failed — check the API credentials${detail}`, 401);
    if (res.status === 403) return new WordPressError("FORBIDDEN", `Access denied — the API key lacks permission or a firewall blocked the request${detail}`, 403);
    if (res.status === 404) return new WordPressError("NOT_FOUND", `Endpoint not found${detail}`, 404);
    if (res.status === 429) return new WordPressError("RATE_LIMIT", "The website is rate limiting requests", 429, true);
    if (res.status >= 500) return new WordPressError("SERVER", `The website returned a server error (${res.status})${detail}`, res.status, true);
    return new WordPressError("INVALID_RESPONSE", `Unexpected response (${res.status})${detail}`, res.status);
  }
}

export function pageInfo(headers: Headers) {
  const totalPages = Number(headers.get("x-wp-totalpages"));
  const total = Number(headers.get("x-wp-total"));
  return {
    totalPages: Number.isFinite(totalPages) && totalPages > 0 ? totalPages : 1,
    total: Number.isFinite(total) ? total : null,
  };
}
