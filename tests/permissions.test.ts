import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { Role } from "@prisma/client";
import { can, PERMISSIONS, ROLE_PERMISSIONS } from "@/lib/auth/permissions";

const session = vi.hoisted(() => ({ user: null as null | { id: string; email: string; name: string; role: Role } }));
vi.mock("@/lib/auth/session", () => ({ getSessionUser: async () => session.user }));

import { POST as movementPOST } from "@/app/api/inventory/movements/route";
import { PUT as integrationPUT, GET as integrationGET } from "@/app/api/integration/route";
import { GET as reportGET } from "@/app/api/reports/[key]/route";
import { POST as commissionPOST } from "@/app/api/mlm/commissions/route";
import { resetDb } from "./helpers";

const as = (role: Role | null) => (session.user = role ? { id: "u1", email: "u@test", name: "U", role } : null);
const req = (url: string, method = "GET", body?: unknown, headers: Record<string, string> = { "x-luxe-csrf": "1", host: "crm.example.test" }) =>
  new NextRequest(`https://crm.example.test${url}`, { method, headers: { ...headers, ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
const ctx = <P extends Record<string, string>>(params: P = {} as P) => ({ params: Promise.resolve(params) });

describe("role permission matrix", () => {
  it("Super Admin has every permission", () => {
    for (const p of PERMISSIONS) expect(can("SUPER_ADMIN", p)).toBe(true);
  });

  it.each([
    ["inventory:adjust", ["SUPER_ADMIN", "INVENTORY_MANAGER"]],
    ["orders:edit", ["SUPER_ADMIN", "ORDER_MANAGER"]],
    ["integration:manage", ["SUPER_ADMIN"]],
    ["users:manage", ["SUPER_ADMIN"]],
    ["mlm:approve", ["SUPER_ADMIN", "ACCOUNTANT"]],
    ["dispatch:manage", ["SUPER_ADMIN", "DISPATCH_MANAGER"]],
    ["onboarding:manage", ["SUPER_ADMIN", "ONBOARDING_MANAGER"]],
    ["reports:export_sensitive", ["SUPER_ADMIN", "ORDER_MANAGER", "ACCOUNTANT"]],
  ] as const)("%s is limited to %j", (perm, roles) => {
    const holders = (Object.keys(ROLE_PERMISSIONS) as Role[]).filter((r) => can(r, perm));
    expect(holders.sort()).toEqual([...roles].sort());
  });

  it("Read-Only Viewer cannot change anything or see PII", () => {
    const writes = PERMISSIONS.filter((p) => /:(edit|adjust|manage|approve|pay|export|view_pii)/.test(p));
    for (const p of writes) expect(can("VIEWER", p)).toBe(false);
  });
});

describe("API authorization & CSRF", () => {
  beforeEach(resetDb);

  it("rejects unauthenticated requests", async () => {
    as(null);
    const res = await integrationGET(req("/api/integration"), ctx());
    expect(res.status).toBe(401);
  });

  it("rejects mutations without the CSRF header or from another origin", async () => {
    as("SUPER_ADMIN");
    const noHeader = await movementPOST(req("/api/inventory/movements", "POST", {}, { host: "crm.example.test" }), ctx());
    expect(noHeader.status).toBe(403);
    const crossOrigin = await movementPOST(req("/api/inventory/movements", "POST", {}, { "x-luxe-csrf": "1", host: "crm.example.test", origin: "https://evil.example" }), ctx());
    expect(crossOrigin.status).toBe(403);
  });

  it.each(["VIEWER", "ORDER_MANAGER", "DISPATCH_MANAGER", "ACCOUNTANT"] as Role[])("%s cannot change stock", async (role) => {
    as(role);
    const res = await movementPOST(req("/api/inventory/movements", "POST", { itemId: "x", kind: "STOCK_IN", quantity: 1, reason: "test" }), ctx());
    expect(res.status).toBe(403);
  });

  it("only Super Admin can manage API credentials", async () => {
    for (const role of ["INVENTORY_MANAGER", "ACCOUNTANT", "VIEWER"] as Role[]) {
      as(role);
      const res = await integrationPUT(req("/api/integration", "PUT", { siteUrl: "https://x.test", adapter: "WOOCOMMERCE" }), ctx());
      expect(res.status).toBe(403);
    }
  });

  it("only authorised roles can approve commissions", async () => {
    as("INVENTORY_MANAGER");
    const res = await commissionPOST(req("/api/mlm/commissions", "POST", { ids: ["a"], to: "APPROVED" }), ctx());
    expect(res.status).toBe(403);
  });

  it("viewers can preview reports but not export them", async () => {
    as("VIEWER");
    expect((await reportGET(req("/api/reports/low-stock?format=json"), ctx({ key: "low-stock" }))).status).toBe(200);
    expect((await reportGET(req("/api/reports/low-stock?format=csv"), ctx({ key: "low-stock" }))).status).toBe(403);
  });

  it("validates input and never leaks internals", async () => {
    as("SUPER_ADMIN");
    const res = await movementPOST(req("/api/inventory/movements", "POST", { itemId: "x", kind: "STOCK_IN", quantity: "abc", reason: "" }), ctx());
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("VALIDATION");
    expect(JSON.stringify(body)).not.toMatch(/prisma|stack/i);
  });
});
