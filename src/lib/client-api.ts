"use client";

export class ApiError extends Error {
  constructor(message: string, public status: number, public code?: string, public details?: unknown) {
    super(message);
  }
}

/** Fetch wrapper for the CRM API: adds the CSRF header, parses JSON, throws ApiError on failure. */
export async function api<T = unknown>(path: string, opts: { method?: string; body?: unknown; form?: FormData } = {}): Promise<T> {
  const headers: Record<string, string> = { "x-luxe-csrf": "1" };
  let body: BodyInit | undefined;
  if (opts.form) body = opts.form;
  else if (opts.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(opts.body);
  }
  const res = await fetch(path, { method: opts.method ?? (body ? "POST" : "GET"), headers, body, credentials: "same-origin" });
  if (res.status === 401 && typeof window !== "undefined" && !path.startsWith("/api/auth")) {
    window.location.href = "/login";
  }
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    const d = (data ?? {}) as { error?: string; code?: string; details?: { fieldErrors?: Record<string, string[]> } };
    let message = d.error || `Request failed (${res.status})`;
    const fe = d.details?.fieldErrors;
    if (fe && Object.keys(fe).length) message += ": " + Object.entries(fe).map(([k, v]) => `${k} — ${v.join(", ")}`).join("; ");
    throw new ApiError(message, res.status, d.code, d.details);
  }
  return data as T;
}
