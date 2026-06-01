# Spec: SAT Tax Withholding (New Capability)

## Purpose

Configurable ISR + IVA withholding on every seller payout, persisted to `order_items` and `wallet_transactions`, displayed in seller-facing and admin-facing UI per Mexico's Régimen de Plataformas Tecnológicas (Art. 113-A LISR).

---

## Requirements

### Requirement: SAT Withholding Calculation in Payout Formula

The system MUST deduct ISR and IVA withholding from every seller's gross product price before calculating `net_payout`. The percentages MUST be read from `system_settings` (defaults: ISR 1%, IVA 8%).

- **Formula**: `net_payout = price - (price * commission_pct) - (price * isr_pct + price * iva_pct) - COALESCE(shipping_cost, 0)`
- **Storage**: `sat_tax_withholding` column on `order_items` stores `(price * isr_pct + price * iva_pct)`
- **Storage**: `tax_withholding` column on `wallet_transactions` stores the same value for audit

#### Scenario: Happy path — new order with withholding

- GIVEN a product priced at $1,000 MXN, ISR 1%, IVA 8%, commission 9%, shipping $100
- WHEN `fn_create_order_from_payment` processes the order
- THEN `sat_tax_withholding = $1,000 * (0.01 + 0.08) = $90`
- AND `net_payout = $1,000 - $90 (commission) - $90 (withholding) - $100 (shipping) = $720`

#### Scenario: Product price is zero

- GIVEN a product with `price = 0`
- WHEN the function processes the order
- THEN `sat_tax_withholding = 0` and the row is inserted without error

#### Scenario: ISR/IVA percentages configurable

- GIVEN `system_settings` has `isr_withholding_pct = 0.015` and `iva_withholding_pct = 0.10`
- WHEN a new order is created
- THEN the function reads these values and calculates withholding at 1.5% + 10%

---

### Requirement: Schema Migration for Withholding Columns

The system MUST add three nullable columns via a single migration with no NOT NULL constraints, preserving existing data.

| Table | Column | Type | Default |
|-------|--------|------|---------|
| `order_items` | `sat_tax_withholding` | NUMERIC | NULL |
| `wallet_transactions` | `tax_withholding` | NUMERIC | NULL |
| `system_settings` | `isr_withholding_pct` | NUMERIC | 0.01 |
| `system_settings` | `iva_withholding_pct` | NUMERIC | 0.08 |

#### Scenario: Migration runs on existing data

- GIVEN production `order_items` and `wallet_transactions` with existing rows
- WHEN the migration executes
- THEN all existing rows have `sat_tax_withholding = NULL` and `tax_withholding = NULL` respectively (no data loss, no locking)

#### Scenario: Pre-migration order displayed in UI

- GIVEN an `order_item` with `sat_tax_withholding = NULL`
- WHEN the frontend renders the transaction detail
- THEN the ISR and IVA withholding rows are HIDDEN (not shown as zero or blank)

---

### Requirement: Frontend Display of Tax Withholding (Mobile)

`TransactionDetailSheet` MUST display ISR and IVA as SEPARATE rows, each labeled "acreditable en declaración anual" with an educational tooltip. Rows MUST be hidden when withholding is NULL.

#### Scenario: Seller views transaction breakdown with withholding

- GIVEN a `sale_proceeds` transaction with `tax_withholding = 90`
- WHEN the seller opens the detail sheet
- THEN two rows appear between Commission and Shipping:
  - "Retención ISR 1% (acreditable en declaración anual)" with info icon → -$10
  - "Retención IVA 8% (acreditable en declaración anual)" with info icon → -$80
- AND each info icon tooltip explains: "Esta retención es acreditable en tu declaración anual. No es dinero perdido — el SAT te lo descuenta al declarar."

#### Scenario: Tooltip explains creditable nature

- GIVEN a seller viewing the ISR or IVA row
- WHEN they tap the info icon next to either label
- THEN a tooltip/tooltip popover explains the withholding is creditable against annual tax filings, not a permanent loss

#### Scenario: Pre-migration transaction (NULL withholding)

- GIVEN a `sale_proceeds` transaction with `tax_withholding = NULL`
- WHEN the sheet renders
- THEN no ISR or IVA rows appear (no blank lines, no zero amounts)

---

### Requirement: Admin Transaction Ledger Column (Web)

`UserTransactionsTable` MUST show a "Retención SAT" column after "Comisión Selene" that displays the total withholding with an expandable ISR/IVA breakdown. Hidden when NULL.

#### Scenario: Admin views transaction ledger with withholding

- GIVEN transactions with `tax_withholding` values
- WHEN the admin views the table
- THEN a "Retención SAT" column appears showing "-$90" (total)
- AND expanding or hovering shows "ISR 1%: -$10 / IVA 8%: -$80"

#### Scenario: Pre-migration transaction (NULL withholding)

- GIVEN a transaction with `tax_withholding = NULL`
- WHEN the table renders
- THEN the "Retención SAT" cell shows "—" (em dash, not zero)

---

### Requirement: PaymentIntent Metadata for Audit Trail

`create-payment-intent` MUST include `sat_isr_withholding`, `sat_iva_withholding`, and `sat_total_withholding` in the PaymentIntent `metadata` object.

#### Scenario: Metadata available for Stripe dashboard audit

- GIVEN a new PaymentIntent is created for an order
- WHEN the Edge Function reads `system_settings` for ISR/IVA percentages
- THEN the PaymentIntent metadata includes `sat_isr_withholding`, `sat_iva_withholding`, `sat_total_withholding` as decimal strings
- AND these are visible in the Stripe Dashboard

---

### Requirement: i18n Keys for Tax Withholding

The system MUST add translation keys in both `es/wallet.json` and `en/wallet.json` for all withholding-related UI strings.

#### Scenario: Spanish locale renders correct labels

- GIVEN the app locale is `es`
- WHEN the TransactionDetailSheet renders
- THEN labels read "Retención ISR 1% (acreditable en declaración anual)" and "Retención IVA 8% (acreditable en declaración anual)"

#### Scenario: English locale renders correct labels

- GIVEN the app locale is `en`
- WHEN the TransactionDetailSheet renders
- THEN labels read "ISR Withholding 1% (creditable on annual tax filing)" and "IVA Withholding 8% (creditable on annual tax filing)"