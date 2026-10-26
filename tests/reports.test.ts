import { beforeEach, describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { runReport, safeCell, toCsv, toXlsx, listReports } from "@/server/services/reports";
import { makeItem, makeUser, resetDb } from "./helpers";

const user = (role: "SUPER_ADMIN" | "VIEWER" | "DISPATCH_MANAGER") => ({ id: "u", email: "u@test", name: "U", role });

describe("reports & exports", () => {
  beforeEach(resetDb);

  it("CSV escapes quotes/commas/newlines and neutralises formula injection", () => {
    const csv = toCsv({ title: "t", columns: [{ key: "a", header: "A" }, { key: "b", header: "B" }], rows: [{ a: 'Say "hi", ok', b: "=HYPERLINK(\"http://evil\")" }, { a: "line1\nline2", b: -5 }] });
    const lines = csv.replace(/^﻿/, "").split("\r\n");
    expect(lines[0]).toBe("A,B");
    expect(lines[1]).toBe('"Say ""hi"", ok","\'=HYPERLINK(""http://evil"")"');
    expect(csv).toContain('"line1\nline2",-5');
    expect(safeCell("+cmd")).toBe("'+cmd");
    expect(safeCell("-12.5")).toBe("-12.5");
  });

  it("generates a valid Excel workbook that round-trips", async () => {
    const buf = await toXlsx({ title: "Low stock", columns: [{ key: "sku", header: "SKU" }, { key: "qty", header: "Qty", type: "number" }], rows: [{ sku: "A1", qty: 3 }, { sku: "@SUM(A1)", qty: 4 }] }, { generatedBy: "t@test", isDemo: true });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ExcelJS.Buffer);
    const ws = wb.getWorksheet("Low stock")!;
    expect(ws.getRow(1).getCell(1).value).toBe("SKU");
    expect(ws.getRow(2).getCell(2).value).toBe(3);
    expect(ws.getRow(3).getCell(1).value).toBe("'@SUM(A1)");
    expect(wb.getWorksheet("About")!.getRow(5).getCell(2).value).toMatch(/DEMO/);
  });

  it("daily sales counts only paid orders, net of refunds, within the date range", async () => {
    const today = new Date();
    await prisma.order.createMany({
      data: [
        { number: "1", customerName: "a", orderDate: today, paymentStatus: "PAID", total: new Prisma.Decimal(1000) },
        { number: "2", customerName: "b", orderDate: today, paymentStatus: "PARTIALLY_REFUNDED", total: new Prisma.Decimal(500), refundedTotal: new Prisma.Decimal(100) },
        { number: "3", customerName: "c", orderDate: today, paymentStatus: "PENDING", total: new Prisma.Decimal(9999) },
        { number: "4", customerName: "d", orderDate: new Date(Date.now() - 90 * 86400_000), paymentStatus: "PAID", total: new Prisma.Decimal(7777) },
      ],
    });
    const r = await runReport("daily-sales", { from: today, to: today }, user("SUPER_ADMIN"));
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({ orders: 3, paid: 2, gross: 1500, refunds: 100, net: 1400 });
  });

  it("inventory reports reflect ledger quantities and low-stock filtering", async () => {
    await makeItem({ sku: "OK", opening: 100, reorderLevel: 10 });
    await makeItem({ sku: "LOW", opening: 5, reorderLevel: 10 });
    const low = await runReport("low-stock", {}, user("SUPER_ADMIN"));
    expect(low.rows.map((r) => r.sku)).toEqual(["LOW"]);
    const pack = await runReport("packaging-inventory", { q: "OK" }, user("SUPER_ADMIN"));
    expect(pack.rows[0]).toMatchObject({ sku: "OK", onHand: 100, available: 100 });
  });

  it("sensitive customer columns are only included for authorised roles", async () => {
    await prisma.order.create({ data: { number: "9", customerName: "Priya", customerPhone: "98765", customerEmail: "p@x.test", orderDate: new Date(), status: "CONFIRMED" } });
    const full = await runReport("pending-dispatch", {}, user("SUPER_ADMIN"));
    const limited = await runReport("pending-dispatch", {}, user("DISPATCH_MANAGER"));
    expect(full.columns.map((c) => c.key)).toContain("phone");
    expect(full.rows[0].phone).toBe("98765");
    expect(limited.columns.map((c) => c.key)).not.toContain("phone");
    expect(JSON.stringify(limited.rows)).not.toContain("98765");
  });

  it("MLM report is unavailable while the module is disabled", async () => {
    await makeUser();
    await expect(runReport("mlm-commissions", {}, user("SUPER_ADMIN"))).rejects.toMatchObject({ code: "MLM_DISABLED" });
    expect(listReports(user("VIEWER")).length).toBeGreaterThan(10);
  });
});
