-- Spec: price is carried on the invoice line, never on the item master record.
-- Item.unitPrice was a hardcoded 1000.0 placeholder on creation, never updated,
-- and never read by any pricing logic -- invoice line items get their price
-- entirely from user input via InvoiceLineItem.unitPrice.
ALTER TABLE "items" DROP COLUMN "unit_price";
