-- One source per money value (odd/tasks/table-cleanup.md S2a, #637): every
-- listing holds its publication snapshot, no legacy backfill exists, and the
-- system_settings money columns have no column DEFAULT that could disagree
-- with the configured row.
-- Runs against the local database only: `supabase start`, then `bun run test:db`.
begin;
select plan(8);

select col_not_null('public', 'products', 'publication_shipping_reserve_cents',
  'products.publication_shipping_reserve_cents is NOT NULL');
select col_not_null('public', 'products', 'publication_commission_rate',
  'products.publication_commission_rate is NOT NULL');
select col_not_null('public', 'products', 'publication_insurance_rate',
  'products.publication_insurance_rate is NOT NULL');

select hasnt_function('public', 'backfill_product_publication_economics', array['uuid'],
  'the legacy snapshot backfill is gone');

select col_hasnt_default('public', 'system_settings', 'service_fee_pct',
  'system_settings.service_fee_pct has no default');
select col_hasnt_default('public', 'system_settings', 'insurance_rate',
  'system_settings.insurance_rate has no default');
select col_hasnt_default('public', 'system_settings', 'shipping_buffer_cents',
  'system_settings.shipping_buffer_cents has no default');
select col_hasnt_default('public', 'system_settings', 'return_label_fee_cents',
  'system_settings.return_label_fee_cents has no default');

select * from finish();
rollback;
