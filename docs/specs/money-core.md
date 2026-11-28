# Money core design

This document is the design for Selene's money core (#646): a ledger of money movements, the refund and cancellation records, and the order and shipment status model.
Items #647, #648, and #649 of roadmap #644 implement it.
The maintainer approves this document before any code for those items is written.

Status: Draft.

## Current state

Each problem below cites the code as of 2026-11-27. A bare file name is under `supabase/schemas/public/functions/`.

- **The net owed to a seller is stored three times.** `fn_create_shipments_from_single_payment` inserts `order_items.net_payout_cents` once per shipment (`supabase/schemas/public/functions/fn_create_shipments_from_single_payment.sql:260`). `admin_connect_payout_release_view` sums it (`supabase/schemas/public/views/admin_connect_payout_release_view.sql:15`). `release-connect-payout` copies that sum into `connect_payout_run_shipments.net_payout_cents` and `connect_payout_runs.amount_cents`. `fn_begin_shipment_transfer` then checks that the three copies agree (`fn_begin_shipment_transfer.sql:71`). The seller shipping reserve is also stored twice, in `order_items.shipping_amount_cents` and `shipments.shipping_cost_cents` (`fn_create_shipments_from_single_payment.sql:214`).
- **Seguro Selene has no column.** `grep -ci seguro packages/types/src/database.types.ts` prints 0. `calculateCheckoutAllocation` computes each shipment's share (`supabase/functions/create-connect-payment/fee-calculator.ts:214`) and the share travels only in PaymentIntent metadata. `cancel-order` recomputes it as the refund minus the item prices (`supabase/functions/cancel-order/cancel-order.ts:220`). `orders.service_fee_amount_cents` holds the commission total, not the Seguro (`fn_create_shipments_from_single_payment.sql:151`).
- **Refunds follow three paths.** Cancellations and the overdue payout refund share `shipment_cancellation_operations`. The dispute refund goes through `fn_record_dispute_refund`, which receives no amount and appends the Stripe refund id to `disputes.admin_notes` (`fn_record_dispute_refund.sql:79`). Checkout recovery keeps its refund id in `internal.checkout_recovery_shells.stripe_refund_id`.
- **Losses live in two tables.** `fn_cancel_shipment` and `fn_complete_overdue_payout_refund` add the Stripe fee loss to `orders.cancellation_loss_cents` (`fn_cancel_shipment.sql:102`, `fn_complete_overdue_payout_refund.sql:62`). `shipment_cancellation_operations` keeps its own `cancellation_loss_cents` and a `label_cost_loss_cents` that three functions write: `fn_record_shipment_carrier_cancellation`, `fn_resolve_shipment_cancellation_review`, and `fn_complete_overdue_payout_refund`.
- **The actual Stripe fee has six writers.** `fn_complete_stripe_fee_reconciliation_job_leased` writes `orders.actual_stripe_fee_cents`. Five Edge Functions also write it with a direct update guarded by `.is('actual_stripe_fee_cents', null)`: `stripe-webhooks`, `cancel-order`, `auto-cancel-orders`, `auto-cancel-preparing`, and `refund-overdue-payout`.
- **The return label fee amount is not stored.** `fn_log_return_payment` records the PaymentIntent id and a `paid` status on the dispute, and drops its `p_amount` argument.
- **`shipment_cancellation_operations` holds five lifecycles in one row.** These are the claim, the Stripe refund, the carrier cancellation, the admin review, and late carrier activity. The table has 37 columns: 33 in `CREATE TABLE` plus 4 `ADD COLUMN` statements. It has 28 `CHECK` constraints, most of them requiring columns to be `NULL` together. Count them in `supabase/schemas/public/tables/shipment_cancellation_operations.sql` with `sed -n '/^CREATE TABLE/,/^);/p' <file> | grep -cE '^  "[a-z_]+" +[a-z]'`, `grep -c 'ADD COLUMN' <file>`, and `grep -c CHECK <file>`.
- **A retried refund leaves no trace.** `fn_record_shipment_cancellation_refund` overwrites `refund_id`, `refund_status`, and `refund_failure_reason` in place, and lets `succeeded` become `failed` (`fn_record_shipment_cancellation_refund.sql:49`).
- **`orders.status` is a stored copy.** `trg_shipments_status` writes `internal.fn_derive_order_status` into `orders.status` after every shipment status change. The derivation returns `cancelled` as soon as one shipment is cancelled, before it looks at delivered or completed shipments (`supabase/schemas/internal/functions/fn_derive_order_status.sql:27`). `shipments.status` uses the order enum `order_status` (`supabase/schemas/public/tables/shipments.sql:14`). `fn_on_dispute_opened` writes `orders.status = 'dispute'` directly, and no SQL function sets a shipment to `dispute`.

Nothing answers "what did Selene owe this seller on day X" without joining these tables and replaying their history, and the history of overwritten columns is gone.

## Ledger

The ledger records every movement of money as an entry from one account to another. Balances, losses, and the payout amount are derived from the entries instead of being stored next to each flow.

### Tables

`ledger_accounts` has one row per account. An account is a `kind` plus the owner it belongs to.

- `id uuid` primary key, default `gen_random_uuid()`.
- `kind ledger_account_kind NOT NULL`, an enum with the kinds in the table below.
- `order_id uuid` references `orders`, set only for `buyer`.
- `shipment_id uuid` references `shipments`, set only for `shipment_funds` and `shipping_reserve`.
- `seller_id uuid` references `profiles`, set only for `seller_balance` and `seller_bank`.
- `created_at timestamptz NOT NULL DEFAULT now()`.
- A `CHECK` requires exactly the owner column that the kind needs and `NULL` in the others.
- Four partial unique indexes make each account exist once: `(kind) WHERE` all owners are `NULL`, `(kind, order_id)`, `(kind, shipment_id)`, and `(kind, seller_id)`, each `WHERE` that owner is set. A kind without an owner is a single row.

`ledger_entries` has one row per movement.

- `id uuid` primary key, default `gen_random_uuid()`.
- `entry_key text NOT NULL UNIQUE`, built from the provider or database fact the entry records.
- `kind ledger_entry_kind NOT NULL`, an enum with the entry kinds below.
- `from_account_id uuid NOT NULL` and `to_account_id uuid NOT NULL`, both referencing `ledger_accounts`, with `CHECK (from_account_id <> to_account_id)`.
- `amount_cents bigint NOT NULL CHECK (amount_cents > 0)`.
- `order_id uuid` and `shipment_id uuid`, the order and shipment the entry belongs to, for entries on accounts without an owner such as `commission`.
- `reverses_entry_id uuid` references `ledger_entries`, set only on a reversal.
- `effective_at timestamptz NOT NULL`, when the provider says the movement happened.
- `created_at timestamptz NOT NULL DEFAULT clock_timestamp()`, when Selene recorded it.
- Indexes on `(from_account_id, effective_at)`, `(to_account_id, effective_at)`, and `shipment_id`, plus a unique partial index on `reverses_entry_id WHERE reverses_entry_id IS NOT NULL`, so an entry is reversed at most once.

An entry moves a positive amount from one account to another, so every entry balances by construction. No deferred balance trigger is needed.

Both tables have RLS on, no policies, and no grants to `anon` or `authenticated`. Admin screens read them through service-role Edge Functions.

### Append-only rules

Entries are never changed or deleted.

- No role has `UPDATE`, `DELETE`, or `TRUNCATE` on `ledger_entries`.
- A `BEFORE UPDATE OR DELETE` row trigger and a `BEFORE TRUNCATE` statement trigger raise `LEDGER_ENTRY_IMMUTABLE`, as `fn_prevent_connect_payout_event_mutation` does for `internal.connect_payout_events`.
- A wrong entry is undone by a reversal. The reversal has the same kind and amount, swaps the two accounts, and sets `reverses_entry_id` to the entry it undoes. A trigger checks those three facts on insert.
- A corrected amount is a reversal plus a new entry. For example, a label cost that Envia changes later is a reversal of the `label_purchase` entry and a new `label_purchase` entry with the corrected cost. No function changes a label cost after `fn_finalize_shipment_label` today, so this case has no writer yet.

### Writing entries

Only SQL functions post entries. Each one calls `internal.fn_post_ledger_entry` in the same transaction as the state change the entry describes. Edge Functions never post entries directly.

`internal.fn_post_ledger_entry` takes the key, kind, both accounts (as kind plus owner), amount, `effective_at`, order, shipment, and the reversed entry. It creates missing accounts with `ON CONFLICT DO NOTHING`. It applies the idempotency rule.

- If no entry has the key, it inserts the entry.
- If an entry has the key with the same kind, accounts, and amount, it returns that entry and writes nothing.
- If an entry has the key with anything else different, it raises `LEDGER_ENTRY_KEY_CONFLICT`.

`EXECUTE` on it is revoked from `PUBLIC`, `anon`, `authenticated`, and `service_role`. Only the `SECURITY DEFINER` functions in the entry kinds table call it.

### Account kinds

The balance of an account is the sum of entries into it minus the sum of entries out of it. An external account goes negative by the money that left the outside world into Selene.

| Kind                   | Owner    | What its balance means                                                                                          |
| ---------------------- | -------- | --------------------------------------------------------------------------------------------------------------- |
| `buyer`                | order    | External. Minus what the buyer paid for the order, plus what was refunded.                                      |
| `shipment_funds`       | shipment | Money Selene holds for the shipment. After checkout it is the seller net. After the Transfer it is 0.           |
| `seller_balance`       | seller   | Money in the seller's connected Stripe account that a Payout has not yet sent to the bank.                      |
| `seller_bank`          | seller   | External. What reached the seller's bank.                                                                       |
| `seller_card`          | seller   | External. Minus the return label fees charged to the seller's saved card.                                       |
| `commission`           | none     | Selene revenue from commissions.                                                                                |
| `shipping_margin`      | none     | Selene revenue from shipping reserves that labels did not spend.                                                |
| `seguro`               | none     | Seguro Selene collected minus the Stripe fees it paid. Positive is a surplus, negative a deficit.               |
| `shipping_reserve`     | shipment | The seller-paid shipping reserve not yet spent on labels or settled.                                            |
| `carrier`              | none     | External. What Envia charged for labels, minus label costs it returned.                                         |
| `stripe`               | none     | External. Stripe processing fees.                                                                               |
| `loss`                 | none     | Selene losses from Stripe fees on refunded shipments, label costs not returned, and reserve deficits. Negative. |
| `return_label_fees`    | none     | Selene revenue from return label fees.                                                                          |
| `unallocated_payments` | none     | Checkout recovery payments with no order, held until they are refunded. 0 once every one is refunded.           |

### Entry kinds

The table names the SQL function that posts each kind. A function marked "new" does not exist yet, and T5 says which item adds it. A reversal keeps the kind of the entry it undoes, so the table lists only the forward kinds.

| Kind               | From → to                              | Amount                                                                                                                                       | `entry_key`                              | Posted by                                                                                                                                                                | Flow                         |
| ------------------ | -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------- |
| `charge`           | `buyer` → `shipment_funds`             | The shipment's price plus its Seguro share. The share is the order's `grossUpDomesticMx` Seguro, split by price with `allocateCents`.        | `<payment_intent>:<shipment>:charge`     | `fn_create_shipments_from_single_payment`                                                                                                                                | Checkout                     |
| `commission`       | `shipment_funds` → `commission`        | `round(price × publication_commission_rate)`, today's `order_items.commission_amount_cents`                                                  | `<payment_intent>:<shipment>:commission` | `fn_create_shipments_from_single_payment`                                                                                                                                | Checkout                     |
| `seguro`           | `shipment_funds` → `seguro`            | The shipment's Seguro share, the same amount as in `charge`                                                                                  | `<payment_intent>:<shipment>:seguro`     | `fn_create_shipments_from_single_payment`                                                                                                                                | Checkout                     |
| `shipping_reserve` | `shipment_funds` → `shipping_reserve`  | `publication_shipping_reserve_cents`, today's `order_items.shipping_amount_cents`                                                            | `<payment_intent>:<shipment>:reserve`    | `fn_create_shipments_from_single_payment`                                                                                                                                | Checkout                     |
| `stripe_fee`       | `seguro` → `stripe`                    | The fee of the charge's balance transaction, today's `orders.actual_stripe_fee_cents`                                                        | `<charge_id>:stripe_fee`                 | `fn_complete_stripe_fee_reconciliation_job_leased`, plus a new function for the five Edge Function writers                                                               | Fee reconciliation           |
| `label_purchase`   | `shipping_reserve` → `carrier`         | `shipments.label_provider_cost_cents`                                                                                                        | `envia:<envia_shipment_id>:label`        | `fn_finalize_shipment_label`, `fn_reconcile_shipment_label`                                                                                                              | Label                        |
| `label_returned`   | `carrier` → `shipping_reserve`         | The label cost, when Envia reports `balanceReturned`                                                                                         | `envia:<envia_shipment_id>:returned`     | `fn_record_shipment_carrier_cancellation`                                                                                                                                | Cancellation                 |
| `label_loss`       | `loss` → `shipping_reserve`            | The label cost when Envia did not return it, today's `label_cost_loss_cents`                                                                 | `<shipment>:label_loss`                  | `fn_record_shipment_carrier_cancellation`, `fn_resolve_shipment_cancellation_review`, `fn_complete_overdue_payout_refund`                                                | Cancellation, overdue refund |
| `reserve_surplus`  | `shipping_reserve` → `shipping_margin` | The reserve minus the label cost, when positive                                                                                              | `<shipment>:reserve_settlement`          | The functions that set `completed`: `fn_release_shipment_funds`, `fn_confirm_shipment_delivery`, `fn_resolve_dispute_to_seller`, `fn_resolve_dispute_to_seller_as_admin` | Completion                   |
| `reserve_deficit`  | `loss` → `shipping_reserve`            | The label cost minus the reserve, when positive                                                                                              | `<shipment>:reserve_settlement`          | Same as `reserve_surplus`                                                                                                                                                | Completion                   |
| `transfer`         | `shipment_funds` → `seller_balance`    | The `shipment_funds` balance, which `connect_payout_run_shipments.net_payout_cents` must equal                                               | `<transfer_id>`                          | `fn_complete_shipment_transfer`                                                                                                                                          | Payout                       |
| `payout`           | `seller_balance` → `seller_bank`       | `connect_payout_runs.amount_cents`                                                                                                           | `<payout_id>:paid`                       | `fn_project_payout_run_terminal` (`paid`)                                                                                                                                | Payout                       |
| `refund`           | `shipment_funds` → `buyer`             | The frozen `refund_request` amount: price plus Seguro share (`computeShipmentRefundAmountCents`)                                             | `<refund_id>`                            | `fn_record_shipment_cancellation_refund` (`succeeded`)                                                                                                                   | Cancellation, overdue refund |
| `refund_fee_loss`  | `loss` → `seguro`                      | The shipment's share of the actual Stripe fee (`allocateCancellationLossCents`), today's `cancellation_loss_cents`                           | `<shipment>:refund_fee_loss`             | `fn_record_shipment_cancellation_refund`, or `fn_complete_stripe_fee_reconciliation_job_leased` if the fee was unknown at refund time                                    | Cancellation, overdue refund |
| `manual_repayment` | `shipment_funds` → `buyer`             | The frozen `refund_request` amount                                                                                                           | `<shipment>:manual_repayment`            | `fn_resolve_shipment_cancellation_refund`                                                                                                                                | Cancellation, overdue refund |
| `dispute_refund`   | `shipment_funds` → `buyer`             | Open (#741). Today `disputeRefundAmountCents` returns price plus the seller shipping reserve. `fn_record_dispute_refund` receives no amount. | `<refund_id>`                            | `fn_record_dispute_refund`                                                                                                                                               | Dispute refund               |
| `return_label_fee` | `seller_card` → `return_label_fees`    | `system_settings.return_label_fee_cents` as charged on the return PaymentIntent                                                              | `<payment_intent>:return_label_fee`      | `fn_log_return_payment`                                                                                                                                                  | Return label                 |
| `recovery_charge`  | `buyer` → `unallocated_payments`       | `internal.checkout_recovery_shells.charged_amount_cents`                                                                                     | `<payment_intent>:recovery_charge`       | `fn_upsert_checkout_recovery_shell`                                                                                                                                      | Checkout recovery            |
| `recovery_refund`  | `unallocated_payments` → `buyer`       | The full charge                                                                                                                              | `<refund_id>`                            | `fn_finalize_checkout_recovery`                                                                                                                                          | Checkout recovery            |

A refund recorded as `succeeded` posts, in the same transaction:

1. Reversals of the shipment's `commission`, `seguro`, and `shipping_reserve` entries, keyed `<refund_id>:commission`, `<refund_id>:seguro`, and `<refund_id>:reserve`. For an overdue payout refund the reserve was already settled, so the function also reverses the `reserve_surplus` or `reserve_deficit` entry (`<refund_id>:reserve_settlement`).
2. The `refund` entry, which brings `shipment_funds` to 0.
3. The `refund_fee_loss` entry, when the actual fee is known.
4. A `label_loss` or `label_returned` entry when a label was bought, which leaves `shipping_reserve` at 0.

The `seguro` reversal moves the amount of the checkout `seguro` entry, so the refund must be the price plus that recorded share. Today `computeShipmentRefundAmountCents` rounds each share with `Math.round`, while checkout splits the Seguro with `allocateCents`. With three shipments of equal price and a Seguro of 100 cents, checkout records 34, 33, and 33, and the refund basis gives 33 to each. #647 makes the refund basis read the recorded share.

The dispute refund has no Transfer reversal. `fn_record_dispute_refund` accepts only a `shipped` or `delivered` shipment, and `fn_begin_shipment_transfer` starts a Transfer only for a `completed` one (`fn_begin_shipment_transfer.sql:59`). `resolve-dispute-refund` still sets `reverse_transfer: true` (`supabase/functions/resolve-dispute-refund/index.ts:200`). It also records the refund with a `NULL` id when Stripe answers `charge_already_refunded`, and `dispute_refund` needs that id for its key.

Other refund events post these entries:

- A refund that moves from `succeeded` to `failed` posts a reversal of the `refund` entry, keyed `<refund_id>:failed`. The money is back in Selene's Stripe balance, and `shipment_funds` holds it again.
- A manual repayment after a failed refund posts `manual_repayment`. If no refund ever succeeded, it also posts the reversals from step 1 first.
- A payout that moves from `paid` to `failed` posts a reversal of the `payout` entry, keyed `<payout_id>:failed`, from `fn_project_payout_run_terminal`.

`fn_record_shipment_cancellation_refund` stays the one place that records a cancellation refund, as `docs/specs/shipment-cancellation-coordination.md` requires. T3 replaces its overwritten columns with refund records.

### Worked example

A buyer orders two products from two sellers with one PaymentIntent `pi_1` and charge `ch_1`. Both products have a commission rate of 0.10 and a shipping reserve of 18,000 cents.

| Shipment | Seller | Price   | Commission | Reserve | Seguro share | Charge  |
| -------- | ------ | ------- | ---------- | ------- | ------------ | ------- |
| `A`      | `S1`   | 250,000 | 25,000     | 18,000  | 11,141       | 261,141 |
| `B`      | `S2`   | 120,000 | 12,000     | 18,000  | 5,347        | 125,347 |

`grossUpDomesticMx(370000)` returns a buyer total of 386,488 and a Seguro of 16,488. `allocateCents` splits it 11,141 to `A` and 5,347 to `B`. Stripe charges a fee of 16,488, the rate `grossUpDomesticMx` assumes (3.6% plus 300 cents, plus 16% IVA). The seller of `B` cancels while `B` is `paid`, after the fee is known. `A` gets a label for 14,500, is delivered, completes, and is paid out.

| #   | Kind                        | From → to                                   | Amount  | `entry_key`            |
| --- | --------------------------- | ------------------------------------------- | ------- | ---------------------- |
| 1   | `charge`                    | `buyer` → `shipment_funds(A)`               | 261,141 | `pi_1:A:charge`        |
| 2   | `commission`                | `shipment_funds(A)` → `commission`          | 25,000  | `pi_1:A:commission`    |
| 3   | `seguro`                    | `shipment_funds(A)` → `seguro`              | 11,141  | `pi_1:A:seguro`        |
| 4   | `shipping_reserve`          | `shipment_funds(A)` → `shipping_reserve(A)` | 18,000  | `pi_1:A:reserve`       |
| 5   | `charge`                    | `buyer` → `shipment_funds(B)`               | 125,347 | `pi_1:B:charge`        |
| 6   | `commission`                | `shipment_funds(B)` → `commission`          | 12,000  | `pi_1:B:commission`    |
| 7   | `seguro`                    | `shipment_funds(B)` → `seguro`              | 5,347   | `pi_1:B:seguro`        |
| 8   | `shipping_reserve`          | `shipment_funds(B)` → `shipping_reserve(B)` | 18,000  | `pi_1:B:reserve`       |
| 9   | `stripe_fee`                | `seguro` → `stripe`                         | 16,488  | `ch_1:stripe_fee`      |
| 10  | `label_purchase`            | `shipping_reserve(A)` → `carrier`           | 14,500  | `envia:E1:label`       |
| 11  | `commission` reversal       | `commission` → `shipment_funds(B)`          | 12,000  | `re_1:commission`      |
| 12  | `seguro` reversal           | `seguro` → `shipment_funds(B)`              | 5,347   | `re_1:seguro`          |
| 13  | `shipping_reserve` reversal | `shipping_reserve(B)` → `shipment_funds(B)` | 18,000  | `re_1:reserve`         |
| 14  | `refund`                    | `shipment_funds(B)` → `buyer`               | 125,347 | `re_1`                 |
| 15  | `refund_fee_loss`           | `loss` → `seguro`                           | 5,347   | `B:refund_fee_loss`    |
| 16  | `reserve_surplus`           | `shipping_reserve(A)` → `shipping_margin`   | 3,500   | `A:reserve_settlement` |
| 17  | `transfer`                  | `shipment_funds(A)` → `seller_balance(S1)`  | 207,000 | `tr_1`                 |
| 18  | `payout`                    | `seller_balance(S1)` → `seller_bank(S1)`    | 207,000 | `po_1:paid`            |

Entry 14 is `computeShipmentRefundAmountCents` for `B`: 120,000 plus `round(16488 × 120000 / 370000)` = 125,347. Entry 15 is `allocateCancellationLossCents(16488, ...)` weighted by the refund bases of `A` (261,141) and `B` (125,347), which gives `B` 5,347.

The final balances are:

| Account               | Balance  |
| --------------------- | -------- |
| `buyer`               | -261,141 |
| `shipment_funds(A)`   | 0        |
| `shipment_funds(B)`   | 0        |
| `shipping_reserve(A)` | 0        |
| `shipping_reserve(B)` | 0        |
| `commission`          | 25,000   |
| `shipping_margin`     | 3,500    |
| `seguro`              | 0        |
| `carrier`             | 14,500   |
| `stripe`              | 16,488   |
| `loss`                | -5,347   |
| `seller_balance(S1)`  | 0        |
| `seller_bank(S1)`     | 207,000  |

The balances sum to 0. Selene keeps 23,153 cents, which is `commission` plus `shipping_margin` plus `seguro` plus `loss`. That matches the cash: 386,488 charged, minus 125,347 refunded, 16,488 to Stripe, 14,500 to Envia, and 207,000 to the seller.

### Derived values

A view `ledger_account_balances` returns `account_id`, `kind`, the owner columns, and `balance_cents`. It is derived from `ledger_entries` and stores nothing.

- The payout amount of a shipment is the balance of its `shipment_funds` account. It equals the price minus the commission minus the reserve, unless a refund posted.
- `order_items.net_payout_cents` becomes derived from the ledger, or a column checked against it.
- `connect_payout_run_shipments.net_payout_cents` is checked against the `shipment_funds` balance when the run is created and when `fn_begin_shipment_transfer` runs.
- `connect_payout_runs.amount_cents` stays as the amount sent to Stripe. It must equal the sum of its mappings.
- `orders.cancellation_loss_cents` and `label_cost_loss_cents` become sums of `refund_fee_loss` and `label_loss` entries.
- The Seguro result is the balance of `seguro`.

What Selene owed a seller on day X is the sum of the `shipment_funds` balances of that seller's shipments, counting entries up to X:

```sql
SELECT COALESCE(SUM(CASE WHEN e.to_account_id = a.id THEN e.amount_cents ELSE -e.amount_cents END), 0) AS owed_cents
FROM public.ledger_accounts a
JOIN public.shipments s ON s.id = a.shipment_id
JOIN public.ledger_entries e ON a.id IN (e.from_account_id, e.to_account_id)
WHERE a.kind = 'shipment_funds'
  AND s.seller_id = $1
  AND e.effective_at < $2;
```

`$1` is the seller and `$2` is the start of the day after X in `America/Mexico_City`. Filter on `effective_at` for what had happened by day X. Filter on `created_at` for what Selene knew by day X. Before completion this amount is held, not yet payable, because a refund can still take it.

### Growth and retention

An order writes about 10 to 15 entries. A single-shipment order writes 8 (4 at checkout, the fee, the label, the reserve settlement, and the Transfer) plus its share of a payout. At the design target of 5,000 orders a month (`docs/conventions.md`, "Design target"), that is 50,000 to 75,000 entries and 15,000 to 25,000 accounts a month. The indexes on `from_account_id` and `to_account_id` let a balance query read only the entries of one account.

Entries and accounts are financial records and are kept forever. #450 classifies them in the retention rules.

### Open questions

These need a decision from the maintainer:

- ISR and IVA withholding for sellers (#658) would add entry kinds and accounts.
- Chargebacks (#269) are not handled today. They would add a kind that moves money from `shipment_funds` or `loss` to `buyer`.
- Whether the Seguro surplus or deficit is reported per month.
- A checkout recovery shell has no order, so it has no `buyer` account. This draft needs a `buyer` account owned by the PaymentIntent for that case. Stripe also keeps its fee on a recovery refund, and no code reads that fee today.

## Refund and cancellation records

Today one wide row holds five lifecycles, a refund status that is overwritten, and two loss columns, and each refund path stores its refund somewhere else (see [Current state](#current-state): "`shipment_cancellation_operations` holds five lifecycles in one row", "A retried refund leaves no trace", "Refunds follow three paths", and "Losses live in two tables"). This design keeps `shipment_cancellation_operations` as the claim and its fence, moves each other lifecycle to its own table, records every Stripe refund of every path in one `refunds` table with an append-only status history, and moves the losses to the ledger. Function names and signatures stay where possible, so the TLC code mapping changes only in which table a function writes.

### Cancellation operation

`shipment_cancellation_operations` stays the one cancellation record per shipment, as `docs/specs/shipment-cancellation-coordination.md` requires. It keeps 12 of its 37 columns: the keys `shipment_id` (primary key) and `order_id`, plus `operation_key`, `source`, `actor_id`, `reason`, `claim_token`, `claim_expires_at`, `external_started_at`, `refund_request`, `cancellation_loss_cents`, and `created_at`. Its CHECKs on `source`, on `source` with `actor_id`, and on a nonblank `reason` stay. Of the other 25 columns, 24 move to the tables below, which name the column each one replaces. The last one, `label_cost_loss_cents`, is dropped, as is `orders.cancellation_loss_cents`. Losses become sums of `refund_fee_loss` and `label_loss` entries.

`cancellation_loss_cents` stays because it is an input, not a running total. The Edge Function computes the shipment's fee share with `allocateCancellationLossCents`, and `fn_start_shipment_cancellation_refund` freezes it with the request under the fence. The `refund_fee_loss` entry posts that frozen amount, so the start and cancel signatures do not change.

Four CHECKs today compare columns of two lifecycles: `carrier_balance_consistent`, `carrier_balance_no_loss`, `refund_resolution_status`, and `late_activity_after_start`. A CHECK cannot read another table, so the writer function makes each of these checks while it holds the operation lock. The other CHECKs move with their columns.

### Refunds

`public.refunds` has one row per Stripe refund, for every path.

| Column                      | Type and constraints                                                                        | Replaces                                                               |
| --------------------------- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `id`                        | `uuid` primary key, default `gen_random_uuid()`                                             |                                                                        |
| `stripe_refund_id`          | `text NOT NULL UNIQUE`                                                                      | `refund_id`, `orders.stripe_refund_id`, the shell's `stripe_refund_id` |
| `stripe_payment_intent_id`  | `text NOT NULL`                                                                             | `refund_request->>'payment_intent'` as recorded                        |
| `amount_cents`              | `bigint NOT NULL CHECK (amount_cents > 0)`                                                  | Nothing. The dispute path stores no amount today.                      |
| `purpose`                   | `refund_purpose NOT NULL`: `cancellation`, `overdue_payout`, `dispute`, `checkout_recovery` |                                                                        |
| `shipment_id`               | `uuid` references `shipments`                                                               |                                                                        |
| `cancellation_operation_id` | `uuid` references `shipment_cancellation_operations(shipment_id)`                           |                                                                        |
| `dispute_id`                | `uuid` references `disputes`                                                                | The refund id appended to `disputes.admin_notes`                       |
| `payment_recovery_id`       | `uuid` references `internal.payment_recoveries`                                             |                                                                        |
| `status`                    | `refund_status NOT NULL`: `pending`, `requires_action`, `succeeded`, `failed`, `canceled`   | `refund_status`                                                        |
| `failure_reason`            | `text`, set only when `status = 'failed'`                                                   | `refund_failure_reason`                                                |
| `status_updated_at`         | `timestamptz NOT NULL`                                                                      | `refund_status_updated_at`                                             |
| `created_at`                | `timestamptz NOT NULL DEFAULT now()`                                                        |                                                                        |

A CHECK makes the purpose match its owner. `cancellation` and `overdue_payout` set `shipment_id` and `cancellation_operation_id`, equal to each other. `dispute` sets `shipment_id` and `dispute_id`. `checkout_recovery` sets only `payment_recovery_id`. The writer also checks that `overdue_payout` matches an operation with source `admin_overdue_payout`. Indexes cover each owner column. A partial unique index on each of `cancellation_operation_id`, `dispute_id`, and `payment_recovery_id`, `WHERE status NOT IN ('failed', 'canceled')`, allows at most one live refund per owner, so a second refund can exist only after the first one failed or was canceled. A trigger refuses an update to any column other than `status`, `failure_reason`, and `status_updated_at`, and refuses `DELETE`.

`status` is a projection of `internal.refund_events`, which has one row per status change and is append-only like `internal.connect_payout_events`. Its columns are `id uuid` (primary key), `refund_id uuid NOT NULL` references `refunds`, `from_status refund_status` (`NULL` on the first row of a refund), `to_status refund_status NOT NULL` with `CHECK (from_status IS DISTINCT FROM to_status)`, `failure_reason text` (set only when `to_status = 'failed'`), `stripe_event_id text` (unique when set, the webhook event that reported the change), `stripe_created timestamptz` (that event's `created` time), `recorded_by text NOT NULL` (the SQL function that appended the row), and `recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()`.

`UNIQUE (refund_id, to_status)` holds because the status machine reaches each status at most once. A `BEFORE UPDATE OR DELETE` trigger raises, as `fn_prevent_connect_payout_event_mutation` does. One internal function, `internal.fn_append_refund_event`, validates the transition, appends the event, and updates the projection in the same transaction. Every refund writer below calls it, and nothing else writes `refunds.status`.

### Refund status machine

The transitions are today's forward-only rules from `fn_record_shipment_cancellation_refund`:

| From                 | Allowed to                                                      |
| -------------------- | --------------------------------------------------------------- |
| No row yet           | `pending`, `requires_action`, `succeeded`, `failed`, `canceled` |
| `requires_action`    | `pending`, `succeeded`, `failed`, `canceled`                    |
| `pending`            | `succeeded`, `failed`, `canceled`                               |
| `succeeded`          | `failed`                                                        |
| `failed`, `canceled` | Nothing                                                         |

The first report of a refund inserts its `refunds` row and its first `refund_events` row. An allowed transition appends one `refund_events` row and updates the projection. A repeated or backward report appends nothing and returns `changed: false`, as today. A report on an operation that has a `shipment_refund_resolutions` row appends nothing and returns `unchanged` or `after_resolution`, as `fn_apply_shipment_cancellation_refund_event` does today.

A retried refund is a second `refunds` row with its own `stripe_refund_id` and its own events. The first row keeps its `failed` or `canceled` history. A cancellation operation still accepts only one Stripe refund: `fn_record_shipment_cancellation_refund` keeps `REFUND_ID_MISMATCH`, because the frozen request and the key `cancel_shipment_<shipmentId>` never change. A second row for one owner appears only where a path retries with a new refund, such as checkout recovery after a failed refund.

The ledger keys its refund entries on `refunds.stripe_refund_id`. The event that records `succeeded` posts `refund`, `dispute_refund`, or `recovery_refund` with key `<stripe_refund_id>` and the reversals keyed `<stripe_refund_id>:commission`, `:seguro`, and `:reserve`. The event that records `succeeded` to `failed` posts the reversal keyed `<stripe_refund_id>:failed`. Each entry takes `effective_at` from `stripe_created`, or `recorded_at` when no webhook reported the change. A second refund after a failed one posts only its own `refund` entry, because the reversals already exist and an entry is reversed at most once.

### Carrier cancellation, review, and late carrier activity

`public.shipment_carrier_cancellations` has one row per operation, written once. Its columns are `shipment_id` (primary key, references `shipment_cancellation_operations`), `outcome text NOT NULL CHECK (outcome IN ('accepted', 'refused', 'ambiguous'))` (replaces `carrier_cancellation_outcome`), `recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()` (replaces `carrier_cancellation_recorded_at`), `balance_returned boolean` (replaces `carrier_balance_returned`), and `balance_returned_at timestamptz` (replaces `carrier_balance_returned_at`). CHECKs require `balance_returned` exactly when `outcome = 'accepted'`, and `balance_returned_at` only when `balance_returned` is true.

The label cost loss is the `label_loss` entry, or `label_returned` when Envia returned the balance. It is no longer a column.

`public.shipment_cancellation_reviews` has one row per review.

| Column            | Type and constraints                                                                           | Replaces                 |
| ----------------- | ---------------------------------------------------------------------------------------------- | ------------------------ |
| `id`              | `uuid` primary key                                                                             |                          |
| `shipment_id`     | `uuid NOT NULL` references `shipment_cancellation_operations`                                  |                          |
| `reason`          | `text NOT NULL CHECK (reason IN ('tracking_unknown', 'carrier_refused', 'carrier_ambiguous'))` | `review_reason`          |
| `required_at`     | `timestamptz NOT NULL DEFAULT clock_timestamp()`                                               | `review_required_at`     |
| `resolution`      | `text CHECK (resolution IN ('refund_approved', 'closed_no_refund'))`                           | `review_resolution`      |
| `resolved_at`     | `timestamptz`                                                                                  | `review_resolved_at`     |
| `resolved_by`     | `uuid` references `profiles`                                                                   | `review_resolved_by`     |
| `resolution_note` | `text`, trimmed, 1 to 500 characters                                                           | `review_resolution_note` |

A CHECK keeps the four resolution columns `NULL` together, and `resolved_at >= required_at`. A partial unique index on `shipment_id WHERE resolution IS NULL` allows at most one open review per operation. A resolution is final: a trigger refuses any update of a resolved row and any `DELETE`. `fn_mark_shipment_cancellation_review` still marks an operation once, so an operation closed with `closed_no_refund` never gets a new review.

`public.shipment_late_carrier_activities` has one row per shipment. Its columns are `shipment_id` (primary key, references `shipment_cancellation_operations`), `first_activity_at timestamptz NOT NULL` (replaces `late_carrier_activity_at`), `event_type shipment_tracking_event_type NOT NULL` (replaces `late_carrier_activity_event_type`), and `acknowledged_at timestamptz`, `acknowledged_by uuid` references `profiles`, and `acknowledged_note text` (trimmed, 1 to 200 characters), which replace the three `late_carrier_activity_acknowledged_*` columns. A CHECK keeps the three acknowledgement columns `NULL` together, and `acknowledged_at` not before `first_activity_at`.

### Escalation and manual repayment

`public.shipment_refund_escalations` has one row per operation: `shipment_id` (primary key, references the operation), `reason text NOT NULL CHECK (reason IN ('refund_not_found', 'refund_ambiguous'))`, and `escalated_at timestamptz NOT NULL DEFAULT clock_timestamp()`. It replaces `recovery_escalation_reason` and `recovery_escalated_at`. The row stays as history after a resolution.

`public.shipment_refund_resolutions` has one row per operation and is final: `shipment_id` (primary key, references the operation), `refund_id uuid` references `refunds` (`NULL` for an escalated operation with no recorded refund), `reference text NOT NULL` (trimmed, 1 to 200 characters), `resolved_by uuid NOT NULL` references `profiles`, and `resolved_at timestamptz NOT NULL DEFAULT clock_timestamp()`. It replaces `refund_resolution_reference`, `refund_resolved_by`, and `refund_resolved_at`. A trigger refuses `UPDATE` and `DELETE`. The amount repaid is the `manual_repayment` entry.

### Payment recoveries

`internal.payment_recoveries` is the checkout recovery queue, one row per PaymentIntent. It is a queue with a lease, so it lives in `internal`.

| Column                     | Type and constraints                                                                                                                                         | Replaces                        |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------- |
| `id`                       | `uuid` primary key                                                                                                                                           |                                 |
| `stripe_payment_intent_id` | `text NOT NULL UNIQUE`                                                                                                                                       |                                 |
| `order_id`                 | `uuid UNIQUE` references `orders`, `NULL` when the payment has only a shell                                                                                  |                                 |
| `state`                    | `payment_recovery_state NOT NULL DEFAULT 'refund_pending'`: `refund_pending`, `refunding`, `refund_failed_retry_queued`, `refunded`, `reconciliation_needed` | `compensation_state`            |
| `attempt_count`            | `integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0)`                                                                                                      | `compensation_attempt_count`    |
| `next_retry_at`            | `timestamptz`                                                                                                                                                | `next_compensation_retry_at`    |
| `lease_expires_at`         | `timestamptz`                                                                                                                                                | `compensation_lease_expires_at` |
| `last_error`               | `text`                                                                                                                                                       | `compensation_last_error`       |
| `created_at`, `updated_at` | `timestamptz NOT NULL DEFAULT now()`                                                                                                                         |                                 |

Each replaced column is the one on `orders` and the one on `internal.checkout_recovery_shells`. The sixth column of each, `stripe_refund_id`, moves to `refunds`. The enum replaces the two CHECKs that #638 named. One partial index on `(next_retry_at, created_at) WHERE state IN ('refund_pending', 'refund_failed_retry_queued', 'refunding')` replaces `orders_checkout_recovery_claim_idx` and `checkout_recovery_shells_claim_idx`. A shell keeps only the payment that has no order: `stripe_payment_intent_id`, `reason`, `source_metadata`, `charged_amount_cents`, `stripe_charge_id`, `created_at`, and `updated_at`.

### Access, locks, and the fence

Every table in this section has RLS on, no policies, and `REVOKE ALL` from `anon`, `authenticated`, and `service_role`, as `shipment_cancellation_operations` has today. Only `SECURITY DEFINER` functions write them, and Edge Functions call those service-only RPCs. Buyers and sellers see refund state only through `fn_get_shipment_cancellation_summary`.

Every cancellation writer locks the shipment first, then the operation row `FOR UPDATE`, then writes a child row. No function locks a child row before its operation. The overdue payout path keeps its order: runs, mappings, shipment, operation. `external_started_at` stays the fence before any Stripe call, and no child row authorizes one. `fn_record_shipment_cancellation_refund` still compares the payment intent and amount with the frozen `refund_request` before it inserts the `refunds` row. Recovery keeps its three ways: the recorded refund (now the operation's `refunds` row), the `metadata.shipment_id` lookup, and the replay inside 23 hours.

### Writers after the change

Each writer keeps its name and writes these tables. "Plus" names the ledger entries it posts.

- `fn_claim_shipment_cancellation`: the operation. It reads `shipment_cancellation_reviews` to refuse a claim under review or closed.
- `fn_start_shipment_cancellation` (`external_started_at`), `fn_start_shipment_cancellation_refund` (`refund_request`), `fn_claim_overdue_payout_refund`, and `fn_lease_overdue_refund_replay`: the operation. The refund start also reads the carrier cancellation and the review.
- `fn_record_shipment_cancellation_refund`: `refunds` and `internal.refund_events`, plus the refund entries.
- `fn_apply_shipment_cancellation_refund_event`: `refunds` and `internal.refund_events` through `fn_record_shipment_cancellation_refund`, and `notifications`.
- `fn_escalate_shipment_cancellation`: `shipment_refund_escalations`.
- `fn_resolve_shipment_cancellation_refund`: `shipment_refund_resolutions` and `admin_audit_logs`, plus `manual_repayment`.
- `fn_record_shipment_carrier_cancellation`: `shipment_carrier_cancellations`, plus `label_loss` or `label_returned`.
- `fn_mark_shipment_cancellation_review`: a new `shipment_cancellation_reviews` row.
- `fn_resolve_shipment_cancellation_review`: the open `shipment_cancellation_reviews` row, plus `label_loss` when it applies.
- `fn_record_tracking_event`: `shipment_late_carrier_activities`, with `ON CONFLICT DO NOTHING`.
- `fn_acknowledge_shipment_late_carrier_activity`: `shipment_late_carrier_activities`. It gains the shipment lock before the operation lock, which it does not take today.
- `fn_cancel_shipment`: `shipments` and `notifications`. It no longer writes `orders.cancellation_loss_cents`.
- `fn_complete_overdue_payout_refund`: `shipments`, payout runs, mappings, and `notifications`, plus `label_loss`. It no longer writes either loss column.
- `fn_record_dispute_refund`: `refunds` (purpose `dispute`) and `internal.refund_events`, plus `dispute_refund`. It stops appending the refund id to `disputes.admin_notes`.
- `fn_upsert_checkout_recovery_shell`: the shell or `orders.payment_processing`, and `internal.payment_recoveries`, plus `recovery_charge` for a shell.
- `fn_set_checkout_recovery_charge_evidence`: unchanged, `stripe_charge_id` on `orders` or the shell.
- `fn_claim_checkout_recovery_shells`, `fn_mark_checkout_recovery_retry`, and `fn_mark_checkout_recovery_reconciliation_needed`: `internal.payment_recoveries`.
- `fn_finalize_checkout_recovery`: `refunds` (purpose `checkout_recovery`), `internal.refund_events`, and `internal.payment_recoveries`, and `orders.status` and the listings for an order, plus `recovery_refund`.

Readers of the moved columns, such as `fn_list_shipment_refund_problems`, `fn_get_shipment_cancellation_recovery`, and `fn_close_account`, join the new tables. T5 lists them.

### Worked example of a failed refund

Shipment `B` from the ledger example is cancelled by its seller while `paid`. The frozen request asks for 125,347 cents on `pi_1`.

1. Stripe answers the create call with `re_1`, `succeeded`. `fn_record_shipment_cancellation_refund` inserts `refunds` row `R1` (`re_1`, `pi_1`, 125,347, `cancellation`, `B`, `succeeded`) and `refund_events` row from no status to `succeeded`, recorded by `fn_record_shipment_cancellation_refund`, with no event id. It posts ledger entries 11 to 15 of the ledger example. `fn_cancel_shipment` cancels `B`.
2. Stripe sends `refund.failed` as `evt_2`. `internal.fn_append_refund_event` appends `succeeded` to `failed` with the failure reason, `stripe_event_id = 'evt_2'`, recorded by `fn_record_shipment_cancellation_refund`, and sets `R1.status = 'failed'`. The ledger gets the `refund` reversal from `buyer` to `shipment_funds(B)`, 125,347, key `re_1:failed`. The buyer gets `shipment.refund_failed`, and `B` is listed by `fn_list_shipment_refund_problems`.
3. An admin repays the buyer by SPEI and records the tracking key. `fn_resolve_shipment_cancellation_refund` inserts the `shipment_refund_resolutions` row (`B`, `R1`, the reference, the admin, the time). No `shipment_refund_escalations` row exists, because the refund was recorded. The ledger gets `manual_repayment` from `shipment_funds(B)` to `buyer`, 125,347, key `B:manual_repayment`. The step 1 reversals already exist, so none are posted. `B` is already cancelled.

`shipment_funds(B)` ends at 0, and `loss` keeps the 5,347 fee loss. A later Stripe event for `re_1` returns `unchanged` or `after_resolution` and appends nothing.

### Open questions about the records

- `fn_record_dispute_refund` and `fn_finalize_checkout_recovery` receive no amount or status today, and `resolve-dispute-refund` can record a `NULL` refund id. They need new arguments, and #741 decides the dispute amount.
- Webhook refund events for dispute and checkout recovery refunds are ignored today. T5 decides whether `stripe-webhooks` routes them by `refunds.stripe_refund_id`.

## Order and shipment states

T4 writes this section.

## Code path changes

T5 writes this section.

## Effect on the TLC model

T5 writes this section.

## Implementation order

T5 writes this section.
