-- Ledger immutability: entries can never be updated, and only demo entries may be deleted
-- (used by "Clear demo data"). Real corrections must be made with reversing entries.
CREATE OR REPLACE FUNCTION luxe_ledger_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'InventoryLedgerEntry is append-only (update rejected)';
  END IF;
  IF TG_OP = 'DELETE' AND OLD."isDemo" = false THEN
    RAISE EXCEPTION 'InventoryLedgerEntry is append-only (delete of non-demo entry rejected)';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER luxe_ledger_guard_trg
BEFORE UPDATE OR DELETE ON "InventoryLedgerEntry"
FOR EACH ROW EXECUTE FUNCTION luxe_ledger_guard();

-- Fulfilment counters can never exceed ordered quantity or go negative.
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_qty_bounds" CHECK (
  "quantity" >= 0 AND "packedQty" >= 0 AND "dispatchedQty" >= 0 AND "returnedQty" >= 0
  AND "packedQty" <= "quantity" AND "dispatchedQty" <= "packedQty" AND "returnedQty" <= "dispatchedQty"
);

-- Reservations and per-location stock cannot go negative.
ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_reserved_nonneg" CHECK ("qtyReserved" >= 0);
ALTER TABLE "StockLevel" ADD CONSTRAINT "StockLevel_onhand_nonneg" CHECK ("qtyOnHand" >= 0);
ALTER TABLE "StockReservation" ADD CONSTRAINT "StockReservation_qty_pos" CHECK ("quantity" > 0);
ALTER TABLE "InventoryLedgerEntry" ADD CONSTRAINT "InventoryLedgerEntry_qty_nonzero" CHECK ("quantity" <> 0);
