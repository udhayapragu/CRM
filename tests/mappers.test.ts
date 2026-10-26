import { describe, expect, it } from "vitest";
import { decideStatusFromWc, gmtDate, mapWcOrder, mapWcProduct } from "@/server/integrations/wordpress/mappers";
import { wcOrder, wcProduct } from "./fake-woo";

describe("WooCommerce mapping", () => {
  it("maps products, treating unmanaged stock as unknown", () => {
    expect(mapWcProduct(wcProduct(1))).toMatchObject({ externalId: "1", stockQuantity: 25, manageStock: true, price: 1500 });
    expect(mapWcProduct(wcProduct(2, { manage_stock: false, stock_quantity: 999 })).stockQuantity).toBeNull();
    expect(mapWcProduct(wcProduct(3, { name: "Rose &amp; Oud" })).name).toBe("Rose & Oud");
  });

  it("maps orders with refunds and addresses", () => {
    const o = mapWcOrder(wcOrder(5, { refunds: [{ id: 1, total: "-250.00" }] }));
    expect(o).toMatchObject({ externalId: "5", customerName: "Asha Rao", refundedTotal: 250, total: 3000 });
    expect(o.lines[0]).toMatchObject({ externalId: "50", productExternalId: "1", quantity: 2 });
  });

  it("parses WooCommerce GMT timestamps without a zone as UTC", () => {
    expect(gmtDate("2026-10-01T10:00:00")?.toISOString()).toBe("2026-10-01T10:00:00.000Z");
    expect(gmtDate("")).toBeNull();
  });

  it.each([
    ["pending", null, "PENDING_PAYMENT", "PENDING"],
    ["processing", null, "NEW", "PAID"],
    ["on-hold", null, "ON_HOLD", "PENDING"],
    ["completed", null, "DISPATCHED", "PAID"],
    ["cancelled", null, "CANCELLED", "UNPAID"],
    ["refunded", null, "CANCELLED", "REFUNDED"],
    ["failed", null, "PENDING_PAYMENT", "FAILED"],
  ] as const)("new order with WC status %s → %s / %s", (wc, local, status, payment) => {
    const d = decideStatusFromWc(wc, local);
    expect(d.status).toBe(status);
    expect(d.paymentStatus).toBe(payment);
  });

  it("never maps anything to DELIVERED and protects dispatched orders", () => {
    const local = { status: "DISPATCHED" as const, paymentStatus: "PAID" as const, hasDispatchedShipment: true };
    for (const wc of ["pending", "processing", "on-hold", "completed", "cancelled", "refunded", "failed"]) {
      expect(decideStatusFromWc(wc, local).status).not.toBe("DELIVERED");
    }
    expect(decideStatusFromWc("cancelled", local)).toMatchObject({ status: "DISPATCHED" });
    expect(decideStatusFromWc("cancelled", local).attention).toBeTruthy();
    expect(decideStatusFromWc("processing", { status: "READY_TO_PACK", paymentStatus: "PENDING", hasDispatchedShipment: false }).status).toBe("READY_TO_PACK");
  });
});
