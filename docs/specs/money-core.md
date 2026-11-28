# Money core design

This document is the design for Selene's money core (#646): a ledger of money movements, the refund and cancellation records, and the order and shipment status model.
Items #647, #648, and #649 of roadmap #644 implement it.
The maintainer approves this document before any code for those items is written.

Status: Draft.

## Current state

Each problem below cites the code as of 2026-11-27. A bare file name is under `supabase/schemas/public/functions/`.

- **The net owed to a seller is stored three times.** `fn_create_shipments_from_single_payment` inserts `order_items.net_payout_cents` once per shipment (`supabase/schemas/public/functions/fn_create_shipments_from_single_payment.sql` line 260). `admin_connect_payout_release_view` sums it (`supabase/schemas/public/views/admin_connect_payout_release_view.sql` line 15). `release-connect-payout` copies that sum into `connect_payout_run_shipments.net_payout_cents` and `connect_payout_runs.amount_cents`. `fn_begin_shipment_transfer` then checks that the three copies agree (`fn_begin_shipment_transfer.sql:71`). The seller shipping reserve is also stored twice, in `order_items.shipping_amount_cents` and `shipments.shipping_cost_cents` (`fn_create_shipments_from_single_payment.sql:214`).
- **Seguro Selene has no column.** `grep -ci seguro packages/types/src/database.types.ts` prints 0. `calculateCheckoutAllocation` computes each shipment's share (`supabase/functions/create-connect-payment/fee-calculator.ts` line 214) and the share travels only in PaymentIntent metadata. `cancel-order` recomputes it as the refund minus the item prices (`supabase/functions/cancel-order/cancel-order.ts` line 220). `orders.service_fee_amount_cents` holds the commission total, not the Seguro (`fn_create_shipments_from_single_payment.sql:151`).
- **Refunds follow three paths.** Cancellations and the overdue payout refund share `shipment_cancellation_operations`. The dispute refund goes through `fn_record_dispute_refund`, which receives no amount and appends the Stripe refund id to `disputes.admin_notes` (`fn_record_dispute_refund.sql:79`). Checkout recovery keeps its refund id in `internal.checkout_recovery_shells.stripe_refund_id`.
- **Losses live in two tables.** `fn_cancel_shipment` and `fn_complete_overdue_payout_refund` add the Stripe fee loss to `orders.cancellation_loss_cents` (`fn_cancel_shipment.sql:102`, `fn_complete_overdue_payout_refund.sql:62`). `shipment_cancellation_operations` keeps its own `cancellation_loss_cents` and a `label_cost_loss_cents` that three functions write: `fn_record_shipment_carrier_cancellation`, `fn_resolve_shipment_cancellation_review`, and `fn_complete_overdue_payout_refund`.
- **The actual Stripe fee has six writers.** `fn_complete_stripe_fee_reconciliation_job_leased` writes `orders.actual_stripe_fee_cents`. Five Edge Functions also write it with a direct update guarded by `.is('actual_stripe_fee_cents', null)`: `stripe-webhooks`, `cancel-order`, `auto-cancel-orders`, `auto-cancel-preparing`, and `refund-overdue-payout`.
- **The return label fee amount is not stored.** `fn_log_return_payment` records the PaymentIntent id and a `paid` status on the dispute, and drops its `p_amount` argument.
- **`shipment_cancellation_operations` holds five lifecycles in one row.** These are the claim, the Stripe refund, the carrier cancellation, the admin review, and late carrier activity. The table has 37 columns: 33 in `CREATE TABLE` plus 4 `ADD COLUMN` statements. It has 28 `CHECK` constraints, most of them requiring columns to be `NULL` together. Count them in `supabase/schemas/public/tables/shipment_cancellation_operations.sql` with `sed -n '/^CREATE TABLE/,/^);/p' <file> | grep -cE '^  "[a-z_]+" +[a-z]'`, `grep -c 'ADD COLUMN' <file>`, and `grep -c CHECK <file>`.
- **A retried refund leaves no trace.** `fn_record_shipment_cancellation_refund` overwrites `refund_id`, `refund_status`, and `refund_failure_reason` in place, and lets `succeeded` become `failed` (`fn_record_shipment_cancellation_refund.sql:49`).
- **`orders.status` is a stored copy.** `trg_shipments_status` writes `internal.fn_derive_order_status` into `orders.status` after every shipment status change. The derivation returns `cancelled` as soon as one shipment is cancelled, before it looks at delivered or completed shipments (`supabase/schemas/internal/functions/fn_derive_order_status.sql` line 27). `shipments.status` uses the order enum `order_status` (`supabase/schemas/public/tables/shipments.sql` line 14). `fn_on_dispute_opened` writes `orders.status = 'dispute'` directly, and no SQL function sets a shipment to `dispute`.

Nothing answers "what did Selene owe this seller on day X" without joining these tables and replaying their history, and the history of overwritten columns is gone.

## Ledger

The ledger records every movement of money as an entry from one account to another. Balances, losses, and the payout amount are derived from the entries instead of being stored next to each flow.

### Tables

`ledger_accounts` has one row per account. An account is a `kind` plus the owner it belongs to.

- `id uuid` primary key, default `gen_random_uuid()`.
- `kind ledger_account_kind NOT NULL`, an enum with the kinds in the table below.
- `stripe_payment_intent_id text`, set only for `buyer`. A buyer account belongs to the PaymentIntent, not to the order, so it never changes when an order is created after a checkout recovery shell for the same payment. Each entry still carries its `order_id`.
- `shipment_id uuid` references `shipments`, set only for `shipment_funds` and `shipping_reserve`.
- `seller_id uuid` references `profiles`, set only for `seller_balance`, `seller_bank`, and `seller_card`.
- `created_at timestamptz NOT NULL DEFAULT now()`.
- A `CHECK` requires exactly the owner column that the kind needs and `NULL` in the others.
- Four partial unique indexes make each account exist once: `(kind) WHERE` all owners are `NULL`, `(kind, stripe_payment_intent_id)`, `(kind, shipment_id)`, and `(kind, seller_id)`, each `WHERE` that owner is set. A kind without an owner is a single row.

`ledger_entries` has one row per movement.

- `id uuid` primary key, default `gen_random_uuid()`.
- `entry_key text NOT NULL UNIQUE`, built from the provider or database fact the entry records.
- `kind ledger_entry_kind NOT NULL`, an enum with the entry kinds below.
- `from_account_id uuid NOT NULL` and `to_account_id uuid NOT NULL`, both referencing `ledger_accounts`, with `CHECK (from_account_id <> to_account_id)`.
- `amount_cents bigint NOT NULL CHECK (amount_cents > 0)`.
- `order_id uuid` and `shipment_id uuid`, the order and shipment the entry belongs to, for entries on accounts without an owner such as `commission`.
- `reverses_entry_id uuid` references `ledger_entries`, set only on a reversal.
- `effective_at timestamptz NOT NULL`, when the provider says the movement happened.
- `created_at timestamptz NOT NULL DEFAULT now()`, when Selene recorded it. `now()` is the start time of the transaction, so every entry that one transaction posts has the same `created_at`.
- Indexes on `(from_account_id, effective_at)`, `(to_account_id, effective_at)`, and `shipment_id`, plus a unique partial index on `reverses_entry_id WHERE reverses_entry_id IS NOT NULL`, so an entry is reversed at most once.

An entry moves a positive amount from one account to another, so every entry balances by construction. No deferred balance trigger is needed.

Both tables have RLS on, no policies, and no grants to `anon` or `authenticated`. Admin screens read them through service-role Edge Functions.

### Append-only rules

Entries are never changed or deleted.

- No role has `UPDATE`, `DELETE`, or `TRUNCATE` on `ledger_entries`.
- A `BEFORE UPDATE OR DELETE` row trigger and a `BEFORE TRUNCATE` statement trigger raise `LEDGER_ENTRY_IMMUTABLE`, as `fn_prevent_connect_payout_event_mutation` does for `internal.connect_payout_events`.
- A wrong entry is undone by a reversal. The reversal has the same kind and amount, swaps the two accounts, and sets `reverses_entry_id` to the entry it undoes. A trigger checks those three facts on insert.
- A corrected amount is a reversal plus a new entry. For example, a label cost that Envia changes later is a reversal of the `label_purchase` entry and a new `label_purchase` entry with the corrected cost. The original entry keeps `envia:<envia_shipment_id>:label`, so the reversal and the new entry take their keys from the correction fact, such as the Envia event that changed the cost: `envia:<event_id>:label_reversal` and `envia:<event_id>:label`. A replay of the same correction is then a no-op. No function changes a label cost after `fn_finalize_shipment_label` today, so this case has no writer yet.

### Writing entries

Only SQL functions post entries. Each one calls `internal.fn_post_ledger_entry` in the same transaction as the state change the entry describes. Edge Functions never post entries directly.

`internal.fn_post_ledger_entry` takes the key, kind, both accounts (as kind plus owner), amount, `effective_at`, order, shipment, and the reversed entry. It creates missing accounts with `ON CONFLICT DO NOTHING`. It applies the idempotency rule.

- If no entry has the key, it inserts the entry.
- If an entry has the key with the same kind, accounts, and amount, it returns that entry and writes nothing.
- If an entry has the key with anything else different, it raises `LEDGER_ENTRY_KEY_CONFLICT`.
- If the amount is 0, it writes nothing and returns `NULL`. Checkout gives a 0 commission or reserve for a product with a commission rate or reserve of 0, which `product_publication_economics_snapshot_check` allows. A fee share can also round to 0. A reversal of a skipped entry is skipped too, so the CHECK on `amount_cents` stays `> 0`.

`EXECUTE` on it is revoked from `PUBLIC`, `anon`, `authenticated`, and `service_role`. Only the `SECURITY DEFINER` functions in the entry kinds table call it.

### Account kinds

The balance of an account is the sum of entries into it minus the sum of entries out of it. An external account goes negative by the money that left the outside world into Selene.

| Kind                   | Owner         | What its balance means                                                                                          |
| ---------------------- | ------------- | --------------------------------------------------------------------------------------------------------------- |
| `buyer`                | PaymentIntent | External. Minus what the buyer paid with the PaymentIntent, plus what was refunded.                             |
| `shipment_funds`       | shipment      | Money Selene holds for the shipment. After checkout it is the seller net. After the Transfer it is 0.           |
| `seller_balance`       | seller        | Money in the seller's connected Stripe account that a Payout has not yet sent to the bank.                      |
| `seller_bank`          | seller        | External. What reached the seller's bank.                                                                       |
| `seller_card`          | seller        | External. Minus the return label fees charged to the seller's saved card.                                       |
| `commission`           | none          | Selene revenue from commissions.                                                                                |
| `shipping_margin`      | none          | Selene revenue from shipping reserves that labels did not spend.                                                |
| `seguro`               | none          | Seguro Selene collected minus the Stripe fees it paid. Positive is a surplus, negative a deficit.               |
| `shipping_reserve`     | shipment      | The seller-paid shipping reserve not yet spent on labels or settled.                                            |
| `carrier`              | none          | External. What Envia charged for labels, minus label costs it returned.                                         |
| `stripe`               | none          | External. Stripe processing fees.                                                                               |
| `loss`                 | none          | Selene losses from Stripe fees on refunded shipments, label costs not returned, and reserve deficits. Negative. |
| `return_label_fees`    | none          | Selene revenue from return label fees.                                                                          |
| `unallocated_payments` | none          | Checkout recovery payments with no order, held until they are refunded. 0 once every one is refunded.           |

### Entry kinds

The table names the SQL function that posts each kind. A function marked "new" does not exist yet, and T5 says which item adds it. A reversal keeps the kind of the entry it undoes, so the table lists only the forward kinds.

| Kind               | From → to                              | Amount                                                                                                                                                      | `entry_key`                              | Posted by                                                                                                                                                                | Flow                         |
| ------------------ | -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------- |
| `charge`           | `buyer` → `shipment_funds`             | The shipment's price plus its Seguro share. The share is the order's `grossUpDomesticMx` Seguro, split by price with `allocateCents`.                       | `<payment_intent>:<shipment>:charge`     | `fn_create_shipments_from_single_payment`                                                                                                                                | Checkout                     |
| `commission`       | `shipment_funds` → `commission`        | `round(price × publication_commission_rate)`, today's `order_items.commission_amount_cents`                                                                 | `<payment_intent>:<shipment>:commission` | `fn_create_shipments_from_single_payment`                                                                                                                                | Checkout                     |
| `seguro`           | `shipment_funds` → `seguro`            | The shipment's Seguro share, the same amount as in `charge`                                                                                                 | `<payment_intent>:<shipment>:seguro`     | `fn_create_shipments_from_single_payment`                                                                                                                                | Checkout                     |
| `shipping_reserve` | `shipment_funds` → `shipping_reserve`  | `publication_shipping_reserve_cents`, today's `order_items.shipping_amount_cents`                                                                           | `<payment_intent>:<shipment>:reserve`    | `fn_create_shipments_from_single_payment`                                                                                                                                | Checkout                     |
| `stripe_fee`       | `seguro` → `stripe`                    | The fee of the charge's balance transaction, today's `orders.actual_stripe_fee_cents`                                                                       | `<charge_id>:stripe_fee`                 | `fn_complete_stripe_fee_reconciliation_job_leased`, plus a new function for the five Edge Function writers                                                               | Fee reconciliation           |
| `label_purchase`   | `shipping_reserve` → `carrier`         | `shipments.label_provider_cost_cents`                                                                                                                       | `envia:<envia_shipment_id>:label`        | `fn_finalize_shipment_label`, `fn_reconcile_shipment_label`                                                                                                              | Label                        |
| `label_returned`   | `carrier` → `shipping_reserve`         | The label cost, when Envia reports `balanceReturned`                                                                                                        | `envia:<envia_shipment_id>:returned`     | `fn_record_shipment_carrier_cancellation`                                                                                                                                | Cancellation                 |
| `label_loss`       | `loss` → `shipping_reserve`            | The label cost when Envia did not return it, today's `label_cost_loss_cents`                                                                                | `<shipment>:label_loss`                  | `fn_record_shipment_carrier_cancellation`, `fn_resolve_shipment_cancellation_review`, `fn_complete_overdue_payout_refund`                                                | Cancellation, overdue refund |
| `reserve_surplus`  | `shipping_reserve` → `shipping_margin` | The reserve minus the label cost, when positive                                                                                                             | `<shipment>:reserve_settlement`          | The functions that set `completed`: `fn_release_shipment_funds`, `fn_confirm_shipment_delivery`, `fn_resolve_dispute_to_seller`, `fn_resolve_dispute_to_seller_as_admin` | Completion                   |
| `reserve_deficit`  | `loss` → `shipping_reserve`            | The label cost minus the reserve, when positive                                                                                                             | `<shipment>:reserve_settlement`          | Same as `reserve_surplus`                                                                                                                                                | Completion                   |
| `transfer`         | `shipment_funds` → `seller_balance`    | The `shipment_funds` balance, which `connect_payout_run_shipments.net_payout_cents` must equal                                                              | `<transfer_id>`                          | `fn_complete_shipment_transfer`                                                                                                                                          | Payout                       |
| `payout`           | `seller_balance` → `seller_bank`       | `connect_payout_runs.amount_cents`                                                                                                                          | `<payout_id>:paid`                       | `fn_project_payout_run_terminal` (`paid`)                                                                                                                                | Payout                       |
| `refund`           | `shipment_funds` → `buyer`             | The frozen `refund_request` amount: price plus Seguro share (`computeShipmentRefundAmountCents`)                                                            | `<refund_id>`                            | `fn_record_shipment_cancellation_refund` (`succeeded`)                                                                                                                   | Cancellation, overdue refund |
| `refund_fee_loss`  | `loss` → `seguro`                      | The shipment's share of the actual Stripe fee (`allocateCancellationLossCents`), the frozen `cancellation_loss_cents`, or computed in SQL when it is `NULL` | `<shipment>:refund_fee_loss`             | `fn_record_shipment_cancellation_refund`, `fn_resolve_shipment_cancellation_refund`, or the functions that post `stripe_fee` if the fee was unknown at refund start      | Cancellation, overdue refund |
| `manual_repayment` | `shipment_funds` → `buyer`             | The frozen `refund_request` amount                                                                                                                          | `<shipment>:manual_repayment`            | `fn_resolve_shipment_cancellation_refund`                                                                                                                                | Cancellation, overdue refund |
| `dispute_refund`   | `shipment_funds` → `buyer`             | Open (#741). Today `disputeRefundAmountCents` returns price plus the seller shipping reserve. `fn_record_dispute_refund` receives no amount.                | `<refund_id>`                            | `fn_record_dispute_refund`                                                                                                                                               | Dispute refund               |
| `return_label_fee` | `seller_card` → `return_label_fees`    | `system_settings.return_label_fee_cents` as charged on the return PaymentIntent                                                                             | `<payment_intent>:return_label_fee`      | `fn_log_return_payment`                                                                                                                                                  | Return label                 |
| `recovery_charge`  | `buyer` → `unallocated_payments`       | `internal.checkout_recovery_shells.charged_amount_cents`                                                                                                    | `<payment_intent>:recovery_charge`       | `fn_upsert_checkout_recovery_shell`                                                                                                                                      | Checkout recovery            |
| `recovery_refund`  | `unallocated_payments` → `buyer`       | The full charge                                                                                                                                             | `<refund_id>`                            | `fn_finalize_checkout_recovery`                                                                                                                                          | Checkout recovery            |

A refund recorded as `succeeded` posts, in the same transaction:

1. Reversals of the shipment's `commission`, `seguro`, and `shipping_reserve` entries, keyed `<refund_id>:commission`, `<refund_id>:seguro`, and `<refund_id>:reserve`. For an overdue payout refund the reserve was already settled, so the function also reverses the `reserve_surplus` or `reserve_deficit` entry (`<refund_id>:reserve_settlement`).
2. The `refund` entry, which brings `shipment_funds` to 0.
3. The `refund_fee_loss` entry, when the actual fee is known.
4. A `label_loss` or `label_returned` entry when a label was bought, which leaves `shipping_reserve` at 0.

The `seguro` reversal moves the amount of the checkout `seguro` entry, so the refund must be the price plus that recorded share. Today `computeShipmentRefundAmountCents` rounds each share with `Math.round`, while checkout splits the Seguro with `allocateCents`. With three shipments of equal price and a Seguro of 100 cents, checkout records 34, 33, and 33, and the refund basis gives 33 to each. #647 makes the refund basis read the recorded share.

The dispute refund has no Transfer reversal. `fn_record_dispute_refund` accepts only a `shipped` or `delivered` shipment, and `fn_begin_shipment_transfer` starts a Transfer only for a `completed` one (`fn_begin_shipment_transfer.sql:59`). `resolve-dispute-refund` still sets `reverse_transfer: true` (`supabase/functions/resolve-dispute-refund/index.ts` line 200). It also records the refund with a `NULL` id when Stripe answers `charge_already_refunded`, and `dispute_refund` needs that id for its key.

Other refund events post these entries:

- A refund that moves from `succeeded` to `failed` posts a reversal of the `refund` entry, keyed `<refund_id>:failed`. The money is back in Selene's Stripe balance, and `shipment_funds` holds it again.
- A manual repayment after a failed refund posts `manual_repayment`. If no refund ever succeeded, it also posts the reversals from step 1 first, and the `refund_fee_loss` entry, because Stripe keeps the fee of the original charge either way.
- A payout that moves from `paid` to `failed` posts a reversal of the `payout` entry, keyed `<payout_id>:failed`, from `fn_project_payout_run_terminal`.

The `refund_fee_loss` amount is the operation's frozen `cancellation_loss_cents`. It is `NULL` when the Edge Function could not read the fee at refund start: the order has no `stripe_charge_id`, or the charge has no balance transaction fee and `buildStripeFeeReconciliationPlan` returns `deferred`. Then the entry posts when both the refund outcome and the fee are known, by whichever function comes second:

- `fn_record_shipment_cancellation_refund` or `fn_resolve_shipment_cancellation_refund`, if the order's `stripe_fee` entry already exists.
- Each function that posts `stripe_fee`, for every shipment of the order whose refund succeeded or was repaid by hand and whose frozen loss is `NULL`.

The SQL computation is the split of `allocateCancellationLossCents`. Each shipment of the order gets the fee times its `charge` amount divided by the sum of the order's `charge` amounts, rounded down. The remaining cents go one each by largest remainder, then by shipment id. The key `<shipment>:refund_fee_loss` posts the entry once in either order.

The two paths serialize on the order row. Before it checks for the other path's fact, each path locks the order `FOR UPDATE` and holds the lock until it commits its own fact. `fn_record_shipment_cancellation_refund` and `fn_resolve_shipment_cancellation_refund` take it after the shipment and operation locks. Each function that posts `stripe_fee` takes it before it writes the fee, and takes no shipment or operation lock. `fn_complete_stripe_fee_reconciliation_job_leased` already locks the order `FOR UPDATE` after its job row. The order is therefore always the last lock, and the lock order stays shipment, operation, order, as in `fn_cancel_shipment` today. Under `READ COMMITTED`, each statement after the lock sees the fact the other transaction committed, so the second path always finds the first one's fact. If both post, the shared key makes the second post a no-op.

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

`$1` is the seller and `$2` is the start of the day after X in the America/Mexico_City time zone. Filter on `effective_at` for what had happened by day X. Filter on `created_at` for what Selene knew by day X. Because `created_at` is the transaction start time, a cutoff never splits one transaction. A transaction that starts before the cutoff and commits after it counts as known by X, so the answer can lead the committed state by the length of one transaction. PostgreSQL stores no commit time per row, and this design does not need one. Before completion this amount is held, not yet payable, because a refund can still take it.

### Growth and retention

An order writes about 10 to 15 entries. A single-shipment order writes 8 (4 at checkout, the fee, the label, the reserve settlement, and the Transfer) plus its share of a payout. At the design target of 5,000 orders a month (`docs/conventions.md`, "Design target"), that is 50,000 to 75,000 entries and 15,000 to 25,000 accounts a month. The indexes on `from_account_id` and `to_account_id` let a balance query read only the entries of one account.

Entries and accounts are financial records and are kept forever. #450 classifies them in the retention rules.

### Extensions left to other issues

The maintainer decided these on 2026-11-27:

- ISR and IVA withholding for sellers is decided in #658. If Selene withholds, it adds entry kinds and accounts to this ledger.
- Chargebacks are designed in #269. They will add a kind that moves money from `shipment_funds` or `loss` to `buyer`.
- A monthly report of the Seguro surplus or deficit is #745. Per month it shows the Seguro collected (`seguro` entries), the Stripe fees it paid (`stripe_fee` from `seguro`), the Seguro returned on refunds (`seguro` reversals), and the fee losses on refunds (`refund_fee_loss`). Its result is collected minus fees minus returned, which is the change of the `seguro` balance minus the `refund_fee_loss` entries. Label losses, reserve deficits, and the recovery fee below are not Seguro costs, so the report leaves the rest of `loss` out.
- A checkout recovery shell has no order, and its `buyer` account is the PaymentIntent's like any other. If `fn_create_shipments_from_single_payment` later creates an order for a PaymentIntent that has a `recovery_charge` and no `recovery_refund`, it first reverses the `recovery_charge`, so the charge is counted once, in the order's `charge` entries. A `recovery_refund` posted after that would find `unallocated_payments` empty for the PaymentIntent and must raise; #647 proves with pgTAP which of the two flows wins under the PaymentIntent lock. Stripe keeps its fee on a recovery refund, and no code reads that fee today. #647 reads it and posts it as `stripe_fee` from `loss` to `stripe`, because no Seguro was ever allocated for a payment without an order.

## Refund and cancellation records

Today one wide row holds five lifecycles, a refund status that is overwritten, and two loss columns, and each refund path stores its refund somewhere else (see [Current state](#current-state): "`shipment_cancellation_operations` holds five lifecycles in one row", "A retried refund leaves no trace", "Refunds follow three paths", and "Losses live in two tables"). This design keeps `shipment_cancellation_operations` as the claim and its fence, moves each other lifecycle to its own table, records every Stripe refund of every path in one `refunds` table with an append-only status history, and moves the losses to the ledger. Function names and signatures stay where possible, so the TLC code mapping changes only in which table a function writes.

### Cancellation operation

`shipment_cancellation_operations` stays the one cancellation record per shipment, as `docs/specs/shipment-cancellation-coordination.md` requires. It keeps 12 of its 37 columns: the keys `shipment_id` (primary key) and `order_id`, plus `operation_key`, `source`, `actor_id`, `reason`, `claim_token`, `claim_expires_at`, `external_started_at`, `refund_request`, `cancellation_loss_cents`, and `created_at`. Its CHECKs on `source`, on `source` with `actor_id`, and on a nonblank `reason` stay. Of the other 25 columns, 24 move to the tables below, which name the column each one replaces. The last one, `label_cost_loss_cents`, is dropped, as is `orders.cancellation_loss_cents`. Losses become sums of `refund_fee_loss` and `label_loss` entries.

`cancellation_loss_cents` stays because it is an input, not a running total. The Edge Function computes the shipment's fee share with `allocateCancellationLossCents`, and `fn_start_shipment_cancellation_refund` freezes it with the request under the fence. The `refund_fee_loss` entry posts that frozen amount, so the start and cancel signatures do not change. A `NULL` freeze means the fee was unknown at refund start, and the ledger section says which function posts the loss later.

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

Every cancellation writer locks the shipment first, then the operation row `FOR UPDATE`, then writes a child row. No function locks a child row before its operation. A writer that needs the order, such as the deferred `refund_fee_loss` check in the ledger section, locks it last. The overdue payout path keeps its order: runs, mappings, shipment, operation. `external_started_at` stays the fence before any Stripe call, and no child row authorizes one. `fn_record_shipment_cancellation_refund` still compares the payment intent and amount with the frozen `refund_request` before it inserts the `refunds` row. Recovery keeps its three ways: the recorded refund (now the operation's `refunds` row), the `metadata.shipment_id` lookup, and the replay inside 23 hours.

### Writers after the change

Each writer keeps its name and writes these tables. "Plus" names the ledger entries it posts.

- `fn_claim_shipment_cancellation`: the operation. It reads `shipment_cancellation_reviews` to refuse a claim under review or closed.
- `fn_start_shipment_cancellation` (`external_started_at`), `fn_start_shipment_cancellation_refund` (`refund_request`), `fn_claim_overdue_payout_refund`, and `fn_lease_overdue_refund_replay`: the operation. The refund start also reads the carrier cancellation and the review.
- `fn_record_shipment_cancellation_refund`: `refunds` and `internal.refund_events`, plus the refund entries.
- `fn_apply_shipment_cancellation_refund_event`: `refunds` and `internal.refund_events` through `fn_record_shipment_cancellation_refund`, and `notifications`.
- `fn_escalate_shipment_cancellation`: `shipment_refund_escalations`.
- `fn_resolve_shipment_cancellation_refund`: `shipment_refund_resolutions` and `admin_audit_logs`, plus `manual_repayment`, and the reversals and `refund_fee_loss` when no refund succeeded.
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
- `fn_finalize_checkout_recovery`: `refunds` (purpose `checkout_recovery`), `internal.refund_events`, and `internal.payment_recoveries`, and for an order the listings, plus `recovery_refund`. `orders.status` follows through the trigger on `internal.payment_recoveries` (see [Order status](#order-status)).

Readers of the moved columns, such as `fn_list_shipment_refund_problems`, `fn_get_shipment_cancellation_recovery`, and `fn_close_account`, join the new tables. T5 lists them.

### Worked example of a failed refund

Shipment `B` from the ledger example is cancelled by its seller while `paid`. The frozen request asks for 125,347 cents on `pi_1`.

1. Stripe answers the create call with `re_1`, `succeeded`. `fn_record_shipment_cancellation_refund` inserts `refunds` row `R1` (`re_1`, `pi_1`, 125,347, `cancellation`, `B`, `succeeded`) and `refund_events` row from no status to `succeeded`, recorded by `fn_record_shipment_cancellation_refund`, with no event id. It posts ledger entries 11 to 15 of the ledger example. `fn_cancel_shipment` cancels `B`.
2. Stripe sends `refund.failed` as `evt_2`. `internal.fn_append_refund_event` appends `succeeded` to `failed` with the failure reason, `stripe_event_id = 'evt_2'`, recorded by `fn_record_shipment_cancellation_refund`, and sets `R1.status = 'failed'`. The ledger gets the `refund` reversal from `buyer` to `shipment_funds(B)`, 125,347, key `re_1:failed`. The buyer gets `shipment.refund_failed`, and `B` is listed by `fn_list_shipment_refund_problems`.
3. An admin repays the buyer by SPEI and records the tracking key. `fn_resolve_shipment_cancellation_refund` inserts the `shipment_refund_resolutions` row (`B`, `R1`, the reference, the admin, the time). No `shipment_refund_escalations` row exists, because the refund was recorded. The ledger gets `manual_repayment` from `shipment_funds(B)` to `buyer`, 125,347, key `B:manual_repayment`. The step 1 reversals and `B:refund_fee_loss` already exist, so none are posted again. `B` is already cancelled.

`shipment_funds(B)` ends at 0, and `loss` keeps the 5,347 fee loss. A later Stripe event for `re_1` returns `unchanged` or `after_resolution` and appends nothing.

### Open questions about the records

- `fn_record_dispute_refund` and `fn_finalize_checkout_recovery` receive no amount or status today, and `resolve-dispute-refund` can record a `NULL` refund id. They need new arguments, and #741 decides the dispute amount.
- Webhook refund events for dispute and checkout recovery refunds are ignored today. T5 decides whether `stripe-webhooks` routes them by `refunds.stripe_refund_id`.

## Order and shipment states

Today one enum types both the order and its shipments, a trigger copies a derived status into `orders.status`, and opening a dispute writes that column directly (see [Current state](#current-state): "`orders.status` is a stored copy"). A pgTAP file run on 2026-11-27 against the local stack of this worktree, with `supabase test db`, proved both problems. It was a scratch file and is not committed. All 7 assertions passed:

- An order with a `delivered` shipment and a `cancelled` shipment from two sellers derives `cancelled`, and stays `cancelled` after the delivered shipment completes.
- An order with a `delivered` and a `shipped` shipment derives `shipped`.
- Opening a `money_dispute` on the delivered shipment sets `orders.status = 'dispute'` and leaves the shipment `delivered`.
- The other seller's shipment then moves from `shipped` to `delivered`, and `orders.status` becomes `delivered` while the dispute is still `open`.

This design gives shipments their own enum, keeps the dispute on `disputes`, derives the order status in one function with rules that fit multi-seller orders, guards every shipment transition, and moves the deadlines off `updated_at`. #649 implements the states and commits a pgTAP test that pins the cancelled plus delivered case and the dispute case. #574 implements the deadlines.

### Shipment status

`shipments.status` gets a new enum, `shipment_status`, with the values `paid`, `preparing`, `shipped`, `delivered`, `completed`, `cancelled`, and `refunded`. These are the values a shipment takes today. A shipment is never `pending` or `dispute`, and nothing writes `shipments.status = 'dispute'`. Because the names stay, the app copy, the i18n keys under `status.*` in `apps/frontend/src/shared/i18n/locales/en/orders.json` and its Spanish copy, and the TLC model's `shStatus` (paid, delivered, completed, cancelled, refunded) keep their values. `order_status` keeps all nine values and types only `orders.status`.

`fn_create_shipments_from_single_payment` inserts each shipment as `paid`. Today it inserts `preparing` as a "sub-pending" seed and advances it to `paid` once its allocation is written (`supabase/schemas/public/functions/fn_create_shipments_from_single_payment.sql` line 197 and line 292). The seed exists only because the shared enum has no value before `paid`. The insert, its order items, and the advance run in one transaction, so no other transaction ever sees the seed.

### Where the dispute lives

The dispute lives only on `disputes`, one row per shipment (`disputes.shipment_id` is unique). A shipment in dispute keeps its logistic status, such as `delivered`. "In dispute" means the shipment has an active dispute: a `disputes` row whose `status` is not `resolved` or `rejected`, which is how readers find one today. No shipment gets a `dispute` status, because the dispute has its own seven-state machine in `dispute_status`.

`fn_on_dispute_opened` stops writing `orders.status` (`supabase/schemas/public/functions/fn_on_dispute_opened.sql` line 10). The order shows `dispute` through the derivation below.

### Order status

`orders.status` stays a stored cache, not a view. A view with `security_invoker` would derive the status from the shipments the reader can see, so a seller who can read only their own shipment would get a different order status than the buyer. A `SECURITY DEFINER` view would expose the other sellers' shipments.

A new function, `internal.fn_refresh_order_status(p_order_id)`, is the only writer of `orders.status`. It runs three steps:

1. Lock the order row `FOR UPDATE`.
2. Derive the status in a new statement, so it sees what a concurrent shipment or dispute writer committed while it waited for the lock.
3. Update `orders.status` only when the derived value differs from the stored one.

Three triggers call it. One is `AFTER INSERT OR UPDATE OF status` on `shipments` and replaces `trg_shipments_status` and `public.fn_shipments_status_trigger`, which update the order in the same statement that derives it (`supabase/schemas/public/functions/fn_shipments_status_trigger.sql` line 8). The other is new, `AFTER INSERT OR UPDATE OF status` on `disputes`, so opening, resolving, or rejecting a dispute refreshes the order. The third is new, `AFTER INSERT OR UPDATE OF state` on `internal.payment_recoveries`, for a row with an `order_id`, because an order with no shipments has no shipment change to fire a trigger. Every writer of the recovery state is covered: `fn_finalize_checkout_recovery` setting `refunded`, and `fn_record_checkout_recovery_refund` moving it back to a retry when a refund fails after `succeeded`.

A `BEFORE UPDATE OF status` trigger on `orders` refuses every other writer with `ORDER_STATUS_DERIVED`. `internal.fn_refresh_order_status` sets a transaction-local flag with `set_config('selene.order_status_refresh', 'on', true)` before its update and clears it after, and the trigger passes only while the flag is set. Clients have no `UPDATE` on `orders.status`, so the flag guards against a SQL function that writes the column by mistake, not against an attacker.

`internal.fn_derive_order_status` stays as the pure derivation that `internal.fn_refresh_order_status` calls, with new rules. Today it checks `dispute`, `refunded`, and `cancelled` before any logistic status (`supabase/schemas/internal/functions/fn_derive_order_status.sql` line 25). The first matching row wins:

| Order has                                                                        | Status                                                                                                  |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| No shipments, and its `internal.payment_recoveries` row has `state = 'refunded'` | `refunded`                                                                                              |
| No shipments                                                                     | `pending`                                                                                               |
| An active dispute                                                                | `dispute`                                                                                               |
| At least one live shipment (not `cancelled` or `refunded`)                       | The least advanced live shipment, in the order `paid`, `preparing`, `shipped`, `delivered`, `completed` |
| No live shipment, and at least one `refunded`                                    | `refunded`                                                                                              |
| No live shipment                                                                 | `cancelled`                                                                                             |

A cancelled or refunded shipment no longer hides the other sellers' progress. Some worked cases:

| Shipments                                         | Today                                                           | After       |
| ------------------------------------------------- | --------------------------------------------------------------- | ----------- |
| `cancelled` and `delivered`                       | `cancelled`                                                     | `delivered` |
| `cancelled` and `completed`                       | `cancelled`                                                     | `completed` |
| `delivered` and `shipped`                         | `shipped`                                                       | `shipped`   |
| `delivered` with an active dispute, and `shipped` | `dispute`, until the `shipped` one changes and overwrites it    | `dispute`   |
| All `cancelled`                                   | `cancelled`                                                     | `cancelled` |
| `cancelled` and `refunded`                        | `refunded`                                                      | `refunded`  |
| None, and the payment recovery is `refunded`      | `refunded`, written directly by `fn_finalize_checkout_recovery` | `refunded`  |

### Shipment transition guard

A new `BEFORE UPDATE OF status` trigger on `shipments` refuses any change outside this table with `SHIPMENT_STATUS_TRANSITION_INVALID`:

| From                    | Allowed to                                                            |
| ----------------------- | --------------------------------------------------------------------- |
| `paid`                  | `preparing`, `cancelled`                                              |
| `preparing`             | `shipped`, `delivered`, `cancelled`                                   |
| `shipped`               | `delivered`, `completed` (dispute resolved to the seller), `refunded` |
| `delivered`             | `completed`, `refunded`                                               |
| `completed`             | `refunded`                                                            |
| `cancelled`, `refunded` | Nothing                                                               |

An update that keeps the same status passes, so an `UPDATE OF status` that rewrites the current value is not an error. An insert must be `paid`. Each writer keeps its own `WHERE` guard on the from status, such as `fn_cancel_shipment` with `paid` or `preparing` and `fn_record_dispute_refund` with `shipped` or `delivered`. The trigger is the backstop for a writer that forgets one.

`fn_resolve_dispute_to_seller` and `fn_resolve_dispute_to_seller_as_admin` change the most. Today they check only the dispute status, then set the shipment `completed` from any status, or write `orders.status = 'completed'` directly when `disputes.shipment_id IS NULL` (`supabase/schemas/public/functions/fn_resolve_dispute_to_seller.sql` line 63). After the change, both lock the shipment and require `shipped` or `delivered`. They refuse a dispute with no shipment instead of writing `orders.status`. No such dispute is created today: `fn_open_shipment_dispute` is the only producer, and it always sets `shipment_id` from the shipment it locks. Older rows without one are disposable test data (AGENTS.md), so #649 writes no migration for them, and #650 makes the column `NOT NULL`.

### Deadlines

Three deadlines start from `updated_at`, so any later write to the row restarts them (#574). Each one gets a column that records the moment its clock starts.

| Deadline                                   | Today's column         | New column                                                                                 | Reader                                                                                                                                                                                              |
| ------------------------------------------ | ---------------------- | ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A `preparing` shipment expires             | `shipments.updated_at` | `shipments.label_generated_at`, which exists and is set by `fn_finalize_shipment_label`    | `auto-cancel-preparing` (`supabase/functions/auto-cancel-preparing/handler.ts` line 147) and the shipment countdown in `apps/frontend/src/features/orders/components/order-action-card.tsx` line 98 |
| The seller pays the return label, 48 hours | `disputes.updated_at`  | New `disputes.waiting_return_at`, set when `status` enters `waiting_return`                | `fn_cron_dispute_payout_timeout` (`supabase/schemas/public/functions/fn_cron_dispute_payout_timeout.sql` line 17) and its countdown in the same app file, line 120                                  |
| The buyer ships the return, 48 hours       | `disputes.updated_at`  | New `disputes.return_payout_paid_at`, set when `fn_log_return_payment` records the payment | `fn_cron_dispute_shipping_timeout` (`supabase/schemas/public/functions/fn_cron_dispute_shipping_timeout.sql` line 19) and its countdown in the same app file, line 128                              |

The third row has a second problem: `fn_log_return_payment` sets `status = 'return_shipped'` when it records the payment, while the cron and the countdown look for `waiting_return` with the payment `paid`, so neither ever matches (#750). #574 fixes the status they read in the same change.

The other deadlines already read their own columns: `created_at`, `delivered_at`, and `return_delivered_at`. Once no deadline reads `updated_at`, the shared `updated_at` trigger of #308 can cover `shipments` and `disputes`.

### Locks and concurrency

The order lock comes last, as in the ledger section. A writer locks the shipment, then the cancellation operation, then the dispute, and `internal.fn_refresh_order_status` locks the order at the end, from the trigger. A shipment writer already holds the shipment row when its trigger fires, and a dispute writer holds the dispute row. `fn_resolve_dispute_to_seller` locks the dispute first today (`supabase/schemas/public/functions/fn_resolve_dispute_to_seller.sql` line 39), so it changes to lock the shipment before the dispute. The rule holds for every dispute writer: read the dispute's `shipment_id` without a lock, lock the shipment, then lock the dispute and check that its `shipment_id` did not change. `fn_open_shipment_dispute` already locks the shipment before it inserts the dispute.

The derivation runs after the lock and in a new statement because of `READ COMMITTED`. Each statement takes a new snapshot. Today the trigger derives inside the `UPDATE` of the order, so the derivation reads the shipments with the snapshot taken before that `UPDATE` waited for the row. If two sellers' shipments change at the same time, the second transaction can then write a status that misses the first transaction's change. With the lock first, the second transaction waits until the first commits, and its next statement sees both shipment changes.

### New names

These names are new: the enum `shipment_status`, the function `internal.fn_refresh_order_status`, the error `SHIPMENT_STATUS_TRANSITION_INVALID`, the triggers on `disputes` and `internal.payment_recoveries`, the guard triggers on `orders` and `shipments`, and the columns `disputes.waiting_return_at` and `disputes.return_payout_paid_at`. #649 implements the shipment status, the dispute model, the order status, and the transition guard, after #648 creates `internal.payment_recoveries`, which the first derivation row reads. #574 implements the deadlines after #649, because it changes the same dispute status writers.

## Code path changes

This section lists what each item changes outside the new tables. The writers of the refund and cancellation tables are in "Writers after the change" of the records section, and the functions that post each ledger entry are in the entry kinds table of the ledger section. Neither list is repeated here.

### SQL writers and readers

#647 adds `internal.fn_post_ledger_entry` and makes each function in the entry kinds table call it, in the same transaction as its state change. The new functions are `fn_record_order_stripe_fee` and `fn_get_shipment_refund_basis` (#647, under Edge Functions), `fn_record_checkout_recovery_refund` (#648, under the dispute refund and checkout recovery records), and `internal.fn_refresh_order_status` (#649, in [Order and shipment states](#order-and-shipment-states)). Each Edge Function keeps calling the same RPC, and no Edge Function posts an entry.

These readers switch from a dropped or moved column to the ledger or to a new table:

| Reader                                                                                                                              | Reads today                                                                                                                  | Reads after the change                                                                                                                                 | Item       |
| ----------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------- |
| `admin_connect_payout_release_view`                                                                                                 | The sum of `order_items.net_payout_cents`                                                                                    | `release_amount_cents`: the `shipment_funds` balance plus its unreversed `transfer` entries, so the amount stays the shipment's net after the Transfer | #647       |
| `fn_begin_shipment_transfer`, `fn_atomic_payout_resume_mapping`, `fn_complete_shipment_transfer`, `internal.fn_notify_held_payouts` | `connect_payout_run_shipments.net_payout_cents` against the view                                                             | The same mapping amount against the view, which now returns the `shipment_funds` balance                                                               | #647       |
| `fn_close_account`                                                                                                                  | The view's `release_amount_cents`, the operation's `refund_status`, `orders.compensation_state`                              | The view, `refunds.status`, and `internal.payment_recoveries.state`                                                                                    | #647, #648 |
| `fn_list_shipment_refund_problems`, `fn_get_shipment_cancellation_summary`, `fn_get_shipment_cancellation_recovery`                 | The refund, escalation, resolution, and loss columns of `shipment_cancellation_operations`, `orders.cancellation_loss_cents` | `refunds`, `shipment_refund_escalations`, `shipment_refund_resolutions`, and the `refund_fee_loss` and `label_loss` entries                            | #648, #647 |
| `fn_list_shipment_cancellation_reviews`                                                                                             | The review columns of the operation                                                                                          | `shipment_cancellation_reviews`                                                                                                                        | #648       |
| `fn_list_shipment_late_carrier_activity`                                                                                            | The `late_carrier_activity_*` columns of the operation                                                                       | `shipment_late_carrier_activities`                                                                                                                     | #648       |
| `fn_get_shipment_carrier_cancellation`                                                                                              | The carrier columns of the operation                                                                                         | `shipment_carrier_cancellations`                                                                                                                       | #648       |
| `fn_refresh_seller_stats`                                                                                                           | `orders.status = 'completed'` (`supabase/schemas/internal/functions/fn_refresh_seller_stats.sql` line 28)                    | The seller's own shipments with `status = 'completed'`, because a cancelled plus completed order now derives `completed` for both sellers              | #649       |

`fn_apply_shipment_cancellation_refund_event` reads `orders.cancellation_loss_cents` today. After #647 it reads the operation's frozen `cancellation_loss_cents` or the `refund_fee_loss` entry. `supabase/tests/fixtures/money.psql` derives run and mapping amounts from `net_payout_cents`, so #647 rewrites it to derive them from the ledger. Once the view reads the `shipment_funds` balance, `order_items.net_payout_cents` has no reader, so #647 drops it in its last slice: the ledger section allows it to be derived or checked, and a dropped column cannot drift.

#649 changes the state functions of [Order and shipment states](#order-and-shipment-states). `fn_create_shipments_from_single_payment` inserts `paid`. `internal.fn_refresh_order_status` and its triggers replace `public.fn_shipments_status_trigger`. `fn_on_dispute_opened` stops writing `orders.status`. A trigger on `internal.payment_recoveries` calls the refresh for an order with no shipments. `fn_resolve_dispute_to_seller` and `fn_resolve_dispute_to_seller_as_admin` lock the shipment and require `shipped` or `delivered`. Every dispute writer locks the shipment before the dispute, including `fn_resolve_dispute_to_buyer_as_admin` and the three dispute crons. A cron selects its candidate disputes without a lock, then for each one locks the shipment `FOR UPDATE SKIP LOCKED`, then the dispute, and checks its conditions again; a skipped shipment waits for the next run, as a skipped dispute does today. Every SQL object that casts a shipment status to `order_status` changes its cast to `shipment_status`, such as the `reviews` policy (`supabase/schemas/public/tables/reviews.sql` line 45), `admin_connect_payout_release_view`, and the partial index in `supabase/schemas/public/tables/shipments.sql` line 143.

### Dispute refund and checkout recovery records

These close the two open questions of the records section.

| Function                                   | Arguments after the change                                                                                                                             | Today                                              | Caller passes                                                                                                                                                 |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fn_record_dispute_refund`                 | `p_dispute_id`, `p_stripe_refund_id`, `p_payment_intent_id`, `p_amount_cents`, `p_status`, `p_failure_reason`, `p_stripe_event_id`, `p_stripe_created` | `p_dispute_id`, `p_stripe_refund_id`               | `resolve-dispute-refund`: the refund object's id, PaymentIntent, amount, status, failure reason, and `created`. `stripe-webhooks`: the same plus the event id |
| `fn_finalize_checkout_recovery`            | `p_stripe_payment_intent_id`, `p_stripe_refund_id`, `p_amount_cents`, `p_stripe_created`                                                               | `p_stripe_payment_intent_id`, `p_stripe_refund_id` | `checkout-recovery-worker` and `stripe-webhooks` (`compensateRecoveryShell`): the result of the refund create call                                            |
| `fn_record_checkout_recovery_refund` (new) | The refund id, PaymentIntent, amount, status, failure reason, event id, and event `created`                                                            | Does not exist                                     | `stripe-webhooks`, for a later refund event of a recovery refund                                                                                              |

`fn_record_dispute_refund` requires the refund id. It checks the amount against the server basis, which #741 decides (today price plus reserve). Only `succeeded` resolves the dispute and sets the shipment `refunded`. It posts the same entries as a cancellation refund. The shipment guard (`shipped` or `delivered`) and the dispute guard apply only to the first record of the dispute's refund. A later event for a refund that is already recorded skips them and goes to the status machine, so a `succeeded` to `failed` event appends its event and posts the `refund` reversal keyed `<stripe_refund_id>:failed`, while the shipment stays `refunded` and the dispute stays resolved. The failed refund is then listed by `fn_list_shipment_refund_problems`, and its manual repayment belongs with #262 (#749). Today `resolve-dispute-refund` passes only the id and never checks the status (`supabase/functions/resolve-dispute-refund/index.ts` line 239).

When Stripe answers `charge_already_refunded` (`supabase/functions/resolve-dispute-refund/index.ts` line 216), `resolve-dispute-refund` lists the PaymentIntent's refunds and records the one whose `metadata.dispute_id` matches. If none matches, it records nothing and reports the dispute. Today the SQL writes `unknown` into `disputes.admin_notes` instead.

`fn_finalize_checkout_recovery` keeps its name for the create-call result. The amount must equal the shell's `charged_amount_cents` or the order's `total_amount_cents`. A recovery refund that fails after `succeeded` reverses `recovery_refund` and queues a retry. The retry's idempotency key is `pi_<id>_recovery_<n>`, where `n` is the number of failed or canceled refunds of that recovery. Today the key is `pi_<id>_recovery` (`supabase/functions/checkout-recovery-worker/recovery.ts` line 79). A crash before the next confirmed failure replays the same key, so only a confirmed failure gets a new one.

### Edge cases of the new paths

- **Rows from before #647.** A shipment created before the ledger exists has no entries. AGENTS.md treats those rows as disposable test data, so no backfill is written. `fn_get_shipment_refund_basis` raises `LEDGER_ENTRY_MISSING` when the shipment has no `charge` entry instead of reading the share as 0, and `admin_connect_payout_release_view` returns no amount for a shipment without a `shipment_funds` account, so it is not releasable.
- **A 0 fee.** `fn_record_order_stripe_fee` with a fee of 0 sets `actual_stripe_fee_cents = 0` and posts nothing, because `internal.fn_post_ledger_entry` skips a 0 amount. The deferred `refund_fee_loss` split of 0 posts nothing either.
- **A dispute refund that is not final yet.** When the create call answers `pending` or `requires_action`, `fn_record_dispute_refund` inserts the `refunds` row and leaves the dispute and the shipment as they are. The later `succeeded` event resolves them. A retried `resolve-dispute-refund` reuses the key `refund_dispute_<disputeId>`, so Stripe returns the same refund, and the partial unique index allows no second live refund for the dispute. After a failed dispute refund no new one is created; that is the manual repayment of #262.
- **The create call and its webhook at the same time.** Both record the same `stripe_refund_id`. `fn_record_dispute_refund` and `fn_record_checkout_recovery_refund` lock the owner first (the shipment, then the dispute, or the payment recovery row), then insert or update the `refunds` row. The second caller applies the status machine to the existing row: an allowed transition, such as `pending` to `succeeded`, appends its event and updates the projection, and only a repeated or backward report returns `changed: false`.
- **Events out of order.** A `refund.failed` that arrives before the create call is recorded inserts the row as `failed`. The create call's later `succeeded` is a backward report and appends nothing, which matches Stripe's final state. No `refund` entry posts, so the ledger has nothing to reverse.
- **A recovery that crashes between the Stripe call and the record.** The replay uses the same key `pi_<id>_recovery_<n>` and gets the same refund. If that refund fails while nothing recorded it, its `refund.failed` event carries `metadata.payment_recovery_id`, so the webhook records it as `failed`, `n` grows by one, and the next attempt gets a new key.
- **A dispute status added later.** The derivation counts a dispute as active unless its status is `resolved` or `rejected`, so a new status shows the order as `dispute` until the derivation learns it. That is the safe default for money held for the seller.

### Webhook routing

`stripe-webhooks` handles `refund.updated` and `refund.failed`. Today it ignores every dispute refund event (`supabase/functions/stripe-webhooks/shipment-refund-events.ts` line 102, Finding #749) and treats a refund without `metadata.shipment_id` as `not_a_shipment_refund` (line 97). After the change it finds the refund's owner in this order:

1. `refunds.stripe_refund_id`.
2. Only for a refund that is not recorded: `metadata.dispute_id`, then `metadata.shipment_id`, then a new `metadata.payment_recovery_id` that the recovery refund creator sets.
3. No owner: the event is settled as `not_a_shipment_refund` and reported, as today. The outcome keeps its name, so the webhook's outcome contract and its tests do not change.

The owner's purpose picks the RPC:

| Purpose                          | RPC                                           |
| -------------------------------- | --------------------------------------------- |
| `cancellation`, `overdue_payout` | `fn_apply_shipment_cancellation_refund_event` |
| `dispute`                        | `fn_record_dispute_refund`                    |
| `checkout_recovery`              | `fn_record_checkout_recovery_refund`          |

Each RPC passes the event id to `internal.fn_append_refund_event`, which stores it in `refund_events.stripe_event_id`. That column is unique, so a redelivered event appends nothing. The manual repayment of a failed dispute refund belongs with #262.

### Edge Functions

No Edge Function posts a ledger entry. Each one changes only the RPC it calls, the arguments it passes, or the column it reads.

| Edge Function                                                                                             | What changes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Item |
| --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| `stripe-webhooks`, `cancel-order`, `auto-cancel-orders`, `auto-cancel-preparing`, `refund-overdue-payout` | The direct update guarded by `.is('actual_stripe_fee_cents', null)` becomes a call to the new `fn_record_order_stripe_fee(p_order_id, p_charge_id, p_fee_cents, p_effective_at)`. It keeps the `IS NULL` guard, posts `stripe_fee`, and runs the deferred `refund_fee_loss` check under the order lock.                                                                                                                                                                                                             | #647 |
| `cancel-order`, `auto-cancel-orders`, `auto-cancel-preparing`, `refund-overdue-payout`                    | The refund basis in `supabase/functions/_shared/cancellation/refund-basis.ts` reads the shipment's recorded `seguro` entry instead of rounding a share with `computeShipmentRefundAmountCents`. It reads it through a new service-only RPC, `fn_get_shipment_refund_basis(p_shipment_id)`, which returns the price and the recorded share, because Edge Functions have no grant on the ledger tables.                                                                                                               | #647 |
| `auto-cancel-preparing`                                                                                   | Reads `shipments.label_generated_at` instead of `updated_at`.                                                                                                                                                                                                                                                                                                                                                                                                                                                       | #574 |
| `resolve-dispute-refund`                                                                                  | Passes the whole refund to `fn_record_dispute_refund`, and handles `charge_already_refunded` by listing the PaymentIntent's refunds.                                                                                                                                                                                                                                                                                                                                                                                | #648 |
| `stripe-webhooks`                                                                                         | Routes refund events by owner, as above. `fn_upsert_checkout_recovery_shell` already runs before the immediate refund, so it returns the `internal.payment_recoveries` id it wrote, and `compensateRecoveryShell` creates the refund with `metadata.payment_recovery_id` set to it and the key `pi_<id>_recovery_<n>`, then passes the amount and `created` to `fn_finalize_checkout_recovery`. A crash after the Stripe call or a refund that stays `pending` then fails later with an owner the webhook can find. | #648 |
| `checkout-recovery-worker`                                                                                | Passes the amount and `created`, sets `metadata.payment_recovery_id` from the claimed row, and builds the key `pi_<id>_recovery_<n>`. Both creators build the refund request with one shared helper, so every replay of a key sends the same parameters, which Stripe requires for a reused idempotency key.                                                                                                                                                                                                        | #648 |
| `release-connect-payout`                                                                                  | Inserts mapping and run amounts that are checked against the `shipment_funds` balance through the view.                                                                                                                                                                                                                                                                                                                                                                                                             | #647 |
| `resume-pending-payouts`                                                                                  | Its check of `net_payout_cents` against `release_amount_cents` (`supabase/functions/resume-pending-payouts/resume-pending-payouts.ts` line 408) compares with the view, whose amount stays the shipment's net after the Transfer, so a run resumed after its Transfer still matches. The code does not change.                                                                                                                                                                                                      | #647 |
| `generate-shipping-label`                                                                                 | No code change. `fn_finalize_shipment_label` and `fn_reconcile_shipment_label` post `label_purchase`.                                                                                                                                                                                                                                                                                                                                                                                                               | #647 |
| `list-shipment-operation-reviews`, `list-shipment-late-carrier-activity`, `list-shipment-refund-problems` | Their SQL functions read the new tables. The responses keep their field names, such as `carrier_cancellation_outcome` and `late_carrier_activity_at`.                                                                                                                                                                                                                                                                                                                                                               | #648 |

### Crons

No cron schedule changes. These jobs in `supabase/schemas/_cluster/misc.sql` reach changed functions:

- `auto-cancel-orders-job` and `auto-cancel-preparing-job`: fee writers, refund basis, and refund records. `auto-cancel-preparing-job` also reads `label_generated_at` (#574).
- `checkout-recovery-worker-every-5-minutes`: the new `fn_finalize_checkout_recovery` arguments and the retry key.
- `reconcile-stripe-fees-every-5-minutes`: `fn_complete_stripe_fee_reconciliation_job_leased` posts `stripe_fee` and the deferred `refund_fee_loss`.
- `resume-pending-payouts` and `held-payout-seller-notices`: payout amounts checked against the ledger.
- `complete-delivered-shipments`, `track-shipments-preparing`, and `track-shipments-shipped`: `fn_confirm_shipment_delivery` posts the reserve settlement, `fn_record_tracking_event` writes `shipment_late_carrier_activities`, and both pass the transition guard.
- `dispute-payout-timeout-job`, `dispute-shipping-timeout-job`, and `return-delivery-timeout`: dispute writers under the shipment-before-dispute lock order (#649). The first two also read the new deadline columns (#574).
- `reconcile-connect-payments`: `internal.fn_reconcile_connect_payments` reads `shipments.status`, which changes type (#649).

### App and admin-web

`packages/types/src/types.ts` gets `ShipmentStatus = Enums<'shipment_status'>` next to `OrderStatus` (line 52). The app reads no money columns. These app files read a shipment status through `Tables<'shipments'>['status']`, which becomes `shipment_status` with the same values after `bun run db:types`: `apps/frontend/src/features/orders/hooks/use-orders.ts`, `apps/frontend/src/features/orders/hooks/use-shipments.ts`, `apps/frontend/src/features/orders/components/order-action-card.tsx`, `apps/frontend/src/features/orders/logic/order-status.ts`, `apps/frontend/src/features/orders/components/order-card.tsx`, `apps/frontend/src/features/orders/components/order-stepper.tsx`, `apps/frontend/src/features/orders/components/multi-seller-banner.tsx`, and `apps/frontend/src/features/orders/logic/order-action-banner.ts`.

The meaning of `orders.status` changes for multi-seller orders: an order with a cancelled shipment now shows the other shipments' progress instead of `cancelled`. A screen that reads `orders.status` to mean "some shipment was cancelled" must read the shipments. `apps/admin-web/src/features/users/hooks/use-user-detail.ts` filters `orders.status = 'cancelled'`, which after #649 counts only orders whose every shipment was cancelled. The filter stays, because a user's cancelled orders are the ones where nothing was delivered; a single cancelled shipment shows in the order's shipments. The countdowns in `apps/frontend/src/features/orders/components/order-action-card.tsx` read the new deadline columns (#574). Admin-web changes only where it reads a table or enum directly, because the Edge Function responses keep their field names.

### Tests

Each item rewrites the tests that pin the columns and functions it changes. The groups from the T5 survey are pgTAP files in `supabase/tests/database`, Bruno folders in `bruno`, and e2e specs in `e2e/admin-web`.

| Item | pgTAP                                                                                                                                                                                           | bun                                                                                                                                                                                      | Bruno                                                  | e2e                              |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ | -------------------------------- |
| #648 | `shipment_cancellation_*`, `overdue_payout_refund`, `overdue_refund_hardening`, `checkout_recovery_*`, `account_closure_blockers`, `integrity_constraints`, `ops_failures`                      | `stripe-webhooks`, `resolve-dispute-refund`, `checkout-recovery-worker`, the cancellation helpers, the list functions, and the `scripts/verify` harnesses of the cancellation lifecycles | `cancellations`, `dispute-integrity`, `stripe-sandbox` | `e2e/admin-web/shipments.e2e.ts` |
| #647 | `settlement_single_payment`, `money_orders`, `payout_*`, `stripe_fee_reconciliation_*`, `shipment_cancellation_*`, `overdue_payout_refund`, `account_closure_blockers`, `integrity_constraints` | The five fee writers, `refund-basis`, `release-connect-payout`, `resume-pending-payouts`                                                                                                 | `orders`, `functions`, `stripe-sandbox`                | `e2e/admin-web/payments.e2e.ts`  |
| #649 | `settlement_single_payment`, `internal_functions`, `order_status_name`, `shipment_disputes`, `money_orders`                                                                                     | The app order status logic and `apps/admin-web/src/features/users/hooks/use-user-detail.ts`                                                                                              | `orders`, `dispute-integrity`                          | `e2e/admin-web/shipments.e2e.ts` |
| #574 | `dispute_return_timeouts`, `ops_failures`                                                                                                                                                       | `auto-cancel-preparing` and the app countdowns                                                                                                                                           | `cancellations`, `dispute-integrity`                   |                                  |

The design also needs new tests. Each one fails before its item and passes after it.

- Ledger idempotency (#647): for each entry kind, a replay with the same key and amount writes nothing, the same key with another amount raises `LEDGER_ENTRY_KEY_CONFLICT`, and a 0 amount writes nothing.
- Append-only triggers: `UPDATE`, `DELETE`, and `TRUNCATE` on `ledger_entries` raise `LEDGER_ENTRY_IMMUTABLE` (#647). `internal.refund_events` and the final child rows refuse changes (#648).
- Refund event transitions (#648): every allowed row of the refund status machine appends one event, and every other pair appends nothing and returns `changed: false`.
- Order derivation (#649): every row of the worked table in [Order and shipment states](#order-and-shipment-states), including the cancelled plus delivered case and the dispute case.
- Transition guard (#649): every pair outside the guard table raises `SHIPMENT_STATUS_TRANSITION_INVALID`, an insert other than `paid` raises, and a same-status update passes. A direct write of `orders.status` raises `ORDER_STATUS_DERIVED`.
- Concurrent refresh (#649): two sellers' shipments of one order change in two sessions at once, and the order ends with the status derived from both. pgTAP runs in one session, so this is a harness in `scripts/verify`, like `scripts/verify/test-shipment-transfer-coordination.ts`.
- Recovery race (#647): the order creation and the `recovery_refund` of one PaymentIntent, under the PaymentIntent lock, as the ledger section requires.

## Effect on the TLC model

The model in `docs/formal/shipment-transfer-cancellation/ShipmentTransferCancel.tla` covers transfer, cancellation, and the overdue payout refund. Disputes and returns are out of scope. The design changes which tables its mapped functions write and read, but no action, guard, or invariant.

### Mapping rows that change

The code mapping table in `docs/formal/shipment-transfer-cancellation/README.md` has 21 actions. These rows change their code step or guard text:

| Item | Rows                                                                                                                                              | What changes                                                                                                                                                                                                                                                                                                                        |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #648 | `RecordRefund`, `RecordRefundFailed`, `CancelShipment`, `CompleteOverdue`, `ResolveFailedOverdueRefund`, `Progress`, `ClaimCancel`, `StartRefund` | The refund status is read from and written to `refunds` and `internal.refund_events`. The resolution is `shipment_refund_resolutions`. `Progress` records late activity in `shipment_late_carrier_activities` instead of the `late_carrier_activity_*` columns. `ClaimCancel` and `StartRefund` read the review and carrier tables. |
| #647 | `Reprice`, `Begin`, `CreateRun`, `CompleteTransfer`, `RecordRefund`, `CancelShipment`, `CompleteOverdue`, `ResolveFailedOverdueRefund`            | `release_amount_cents` is the `shipment_funds` balance, so the inputs of `Reprice` are ledger entries. `G_BeginAmount` compares the mapping with that balance. The other rows post entries and stop writing the loss columns.                                                                                                       |
| #649 | `Progress`, `ConfirmDelivery`, `CancelShipment`, `CompleteOverdue`                                                                                | Only if their function files change. The transition guard trigger is a backstop on `shipments`, not a new guard of these actions.                                                                                                                                                                                                   |

#574 changes no row. `auto-cancel-preparing` is not in the mapping table, and the dispute deadlines are out of scope.

### Variables

- `shStatus` maps to `shipments.status`, which becomes `shipment_status`. Its five model values (paid, delivered, completed, cancelled, refunded) keep their names.
- `refundStatus` maps to the `refunds.status` projection of the operation's refund. The model's reduction stays (assumption 5): `failed` stands for `failed` and `canceled`. `refundOk`, history the model keeps today, now also exists in the database as the operation's `succeeded` event in `internal.refund_events`.
- `viewAmt` maps to `release_amount_cents`, which the view now derives from the `shipment_funds` balance. `mapNet` stays `connect_payout_run_shipments.net_payout_cents`, checked against that balance.

### Actions and invariants

No action and no invariant changes, for these reasons:

- A cancellation operation still accepts one Stripe refund. `fn_record_shipment_cancellation_refund` keeps `REFUND_ID_MISMATCH` (`supabase/schemas/public/functions/fn_record_shipment_cancellation_refund.sql` line 40), so one `refunds` row per operation matches the model's single `refundStatus`.
- The model's shipment transitions (paid to delivered, delivered to completed, paid to cancelled, completed to refunded) are a subset of the T4 guard table, with `paid` standing for `preparing` as the README's bounds say.
- Amounts stay abstract. `G_BeginAmount` is the same equality with a different source for the view amount.
- Losses, ledger entries, and `orders.status` are not modelled.

### Keeping the model in sync

The README's rule is: "When any file in the mapping table changes, re-read its row and update the model and this table." Its "Checked against the code" section adds: "When a function in the mapping table changes, run the harness as well as TLC." The harness is `scripts/verify/test-shipment-lifecycle-model.ts`, and its row checks read the refund columns, so #648 rewrites them.

Each implementing PR updates its rows of the mapping table and the "Synced against" line in the same PR. Run TLC from the README's "Run it" section:

```sh
cd docs/formal/shipment-transfer-cancellation
java -XX:+UseParallelGC -cp "$TLA2TOOLS" tlc2.TLC -workers auto -deadlock \
  -metadir "$(mktemp -d)" -config ShipmentTransferCancel.cfg ShipmentTransferCancel.tla
```

## Implementation order

The items land in this order. Each one can start after the item named in its row is merged.

1. **#648, refund and cancellation history.** Can start now. The ledger keys refund entries on `refunds.stripe_refund_id`, and today a dispute refund can be recorded with a `NULL` id, so the records come first. It also creates `internal.payment_recoveries`.
2. **#647, ledger.** Can start after #648. It drops the loss columns that #648 still writes and keys its refund entries on the `refunds` rows.
3. **#649, order and shipment states.** Can start after #647. Its first derivation row reads `internal.payment_recoveries` from #648, and it rewrites the completion and dispute functions (`fn_release_shipment_funds`, `fn_confirm_shipment_delivery`, `fn_resolve_dispute_to_seller`) that #647 changes to post the reserve settlement, so running them one after the other avoids two migrations rewriting the same functions at once.
4. **#574, deadlines.** Can start after #649, because it changes the dispute status writers that #649 touches. It fixes #750 in the same change.
5. **#639, clients read only the shipments columns they use.** Can start after #649, because it needs the final `shipments` columns.
6. **#650, dispute record cleanup.** Can start after #574, because it needs the dispute model of #649 and both change `disputes` columns and the dispute timeout functions.

Each commit stays near 400 changed lines, counting generated files. SQL goes in its own commit, apart from Edge Functions and UI, and `packages/types/src/database.types.ts` goes in the commit of the migration that produced it. These are suggested slices:

- #648: (1) `refunds`, `internal.refund_events`, `internal.fn_append_refund_event`, and the cancellation refund writers. (2) The carrier, review, late activity, escalation, and resolution tables with their writers and readers. (3) `internal.payment_recoveries`, the new `fn_finalize_checkout_recovery` and `fn_record_dispute_refund` arguments, and `fn_record_checkout_recovery_refund`. (4) The column drops. (5) `stripe-webhooks` routing. (6) `resolve-dispute-refund` and `checkout-recovery-worker`. (7) The TLC mapping rows and the harness.
- #647: (1) `ledger_accounts`, `ledger_entries`, the append-only triggers, `internal.fn_post_ledger_entry`, and `ledger_account_balances`. (2) The checkout entries, `stripe_fee`, and `fn_record_order_stripe_fee`. (3) The label, completion, transfer, and payout entries. (4) The refund entries and losses, and the loss column drops. (5) The checkout recovery entries. (6) The view and the payout checks against `shipment_funds`. (7) The five fee writers and the refund basis in Edge Functions. (8) The TLC mapping rows.
- #649: (1) `shipment_status`, the insert as `paid`, and the transition guard. (2) `internal.fn_refresh_order_status`, its triggers, the `orders` guard, the new derivation, and the dispute writers. (3) `ShipmentStatus`, the app, and admin-web.
- #574: (1) The deadline columns and the dispute crons, with #750. (2) `auto-cancel-preparing`. (3) The app countdowns.
- #639 and #650 plan their slices in their own issues.
