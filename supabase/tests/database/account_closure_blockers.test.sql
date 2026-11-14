-- fn_close_account: each obligation blocker refuses the closure without
-- changing anything, and the same user closes once the blocker is settled
-- (auth-hardening S4, S8; T10c.1). Blockers covered: pending_payouts,
-- open_disputes, pending_refunds, account_restricted, active_orders. active_shipments is
-- in account_closure.test.sql.
-- Runs against the local database only: `supabase start`, then `bun run test:db`.
begin;
select plan(49);

-- Same economics formula as validate_product_publication_economics.
create function pg_temp.make_product(p_id uuid, p_seller uuid, p_status text default 'SOLD')
returns void language sql as $$
  insert into public.products (
    id, name, description, price_cents, category, condition, usage, images, status,
    specifications, seller_id, shipping_cost_cents, origin_zip, package_preset,
    publication_shipping_reserve_cents, publication_commission_rate,
    publication_insurance_rate
  )
  select p_id, 'Test GPU', 'Test listing', 100000, 'GPU', 'used', 'gaming',
    array['https://example.test/p.png'], p_status::public.product_status_enum, '{}'::jsonb, p_seller, 10000, '06600', 'gpu_1',
    10000::bigint + s.shipping_buffer_cents
      + ceil(100000::numeric * s.insurance_rate)::bigint,
    s.service_fee_pct,
    s.insurance_rate
  from public.system_settings s where s.id = 1
$$;

-- One order with one shipment and one sold item, all in the given final status.
-- p_pi is the Connect payment intent (NULL for a sale outside Connect).
create function pg_temp.make_sale(
  p_n integer, p_buyer uuid, p_seller uuid, p_status public.order_status_enum, p_pi text
) returns void language plpgsql as $$
declare
  v_order uuid := ('d0000000-0000-4000-8000-0000000b' || lpad(p_n::text, 4, '0'))::uuid;
  v_shipment uuid := ('d0000000-0000-4000-8000-0000000c' || lpad(p_n::text, 4, '0'))::uuid;
  v_product uuid := ('d0000000-0000-4000-8000-0000000a' || lpad(p_n::text, 4, '0'))::uuid;
begin
  perform pg_temp.make_product(v_product, p_seller);
  insert into public.orders (id, buyer_id, total_amount_cents, shipping_address, status)
  values (v_order, p_buyer, 100000, '{}'::jsonb, p_status);
  insert into public.shipments (id, order_id, seller_id, status, completed_at, stripe_payment_intent_id)
  values (v_shipment, v_order, p_seller, p_status,
    case when p_status = 'completed' then now() end, p_pi);
  insert into public.order_items (order_id, product_id, seller_id, price_at_purchase_cents, net_payout_cents, shipment_id)
  values (v_order, v_product, p_seller, 100000, 90000, v_shipment);
  -- The shipment trigger derives the order status; pin it to the requested one.
  update public.orders set status = p_status where id = v_order;
end $$;

-- What a refused closure must leave untouched, as one comparable string: the
-- profile (deleted_at, username), the closure record, both emails, and the
-- user's live listings (anonymization soft-deletes unsold ones).
create function pg_temp.snapshot(p_user uuid) returns text language sql as $$
  select (select deleted_at is null from public.profiles where id = p_user)::text
    || '|' || (select username from public.profiles where id = p_user)
    || '|' || (select count(*) from internal.account_closures where user_id = p_user)::text
    || '|' || (select email from public.profiles_private where id = p_user)
    || '|' || (select email from auth.users where id = p_user)
    || '|' || (select count(*) from public.products where seller_id = p_user and deleted_at is null)::text
$$;

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change
)
select '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated',
  u.email, '', now(), '{}'::jsonb, jsonb_build_object('username', u.username), now(), now(), '', '', '', ''
from (values
  ('d0000000-0000-4000-8000-000000000011'::uuid, 'payout_unpaid@test.local', 'blk_payout_unpaid'),
  ('d0000000-0000-4000-8000-000000000012'::uuid, 'run_pending@test.local', 'blk_run_pending'),
  ('d0000000-0000-4000-8000-000000000013'::uuid, 'run_recon@test.local', 'blk_run_recon'),
  ('d0000000-0000-4000-8000-000000000014'::uuid, 'dispute_buyer@test.local', 'blk_dispute_buyer'),
  ('d0000000-0000-4000-8000-000000000015'::uuid, 'dispute_seller@test.local', 'blk_dispute_seller'),
  ('d0000000-0000-4000-8000-000000000016'::uuid, 'refund_op@test.local', 'blk_refund_op'),
  ('d0000000-0000-4000-8000-000000000017'::uuid, 'compensation@test.local', 'blk_compensation'),
  ('d0000000-0000-4000-8000-000000000018'::uuid, 'counter_seller@test.local', 'blk_counter_seller'),
  ('d0000000-0000-4000-8000-000000000019'::uuid, 'counter_buyer@test.local', 'blk_counter_buyer')
) as u(id, email, username);

-- Every user also has one unsold listing, which a closure would soft-delete.
select pg_temp.make_product(('d0000000-0000-4000-8000-0000000f00' || u)::uuid,
  ('d0000000-0000-4000-8000-0000000000' || u)::uuid, 'VERIFIED')
from unnest(array['11', '12', '13', '14', '15', '16', '17']) as u;

-- 11: seller with a completed Connect shipment and no payout run.
select pg_temp.make_sale(1, 'd0000000-0000-4000-8000-000000000019', 'd0000000-0000-4000-8000-000000000011', 'completed', 'pi_test_unpaid');

-- 12 / 13: sellers with a payout run still being reconciled.
insert into public.connect_payout_runs (id, idempotency_key, seller_id, amount, status, actor_id)
values
  ('d0000000-0000-4000-8000-0000000e0012', 'blockers-run-12', 'd0000000-0000-4000-8000-000000000012', 900, 'pending_reconciliation', 'd0000000-0000-4000-8000-000000000012'),
  ('d0000000-0000-4000-8000-0000000e0013', 'blockers-run-13', 'd0000000-0000-4000-8000-000000000013', 900, 'reconciliation_needed', 'd0000000-0000-4000-8000-000000000013');

-- 14 buyer / 15 seller: a dispute each. The dispute triggers need the service
-- role claim, mark the order as disputed and the listing IN_DISPUTE; the sale
-- is put back to finished so only the dispute blocks.
select pg_temp.make_sale(4, 'd0000000-0000-4000-8000-000000000014', 'd0000000-0000-4000-8000-000000000018', 'completed', null);
select pg_temp.make_sale(5, 'd0000000-0000-4000-8000-000000000019', 'd0000000-0000-4000-8000-000000000015', 'completed', null);
select set_config('request.jwt.claims', '{"role": "service_role"}', true);
insert into public.disputes (id, order_id, buyer_id, seller_id, reason, description, shipment_id)
values
  ('d0000000-0000-4000-8000-0000000d0004', 'd0000000-0000-4000-8000-0000000b0004', 'd0000000-0000-4000-8000-000000000014', 'd0000000-0000-4000-8000-000000000018', 'damaged', 'Buyer dispute', 'd0000000-0000-4000-8000-0000000c0004'),
  ('d0000000-0000-4000-8000-0000000d0005', 'd0000000-0000-4000-8000-0000000b0005', 'd0000000-0000-4000-8000-000000000019', 'd0000000-0000-4000-8000-000000000015', 'not_working', 'Seller dispute', 'd0000000-0000-4000-8000-0000000c0005');
update public.disputes set status = 'return_shipped' where id = 'd0000000-0000-4000-8000-0000000d0005';
update public.orders set status = 'completed' where id in ('d0000000-0000-4000-8000-0000000b0004', 'd0000000-0000-4000-8000-0000000b0005');
update public.products set status = 'SOLD' where id in ('d0000000-0000-4000-8000-0000000a0004', 'd0000000-0000-4000-8000-0000000a0005');

-- 16: buyer whose shipment cancellation started and whose refund is pending.
select pg_temp.make_sale(6, 'd0000000-0000-4000-8000-000000000016', 'd0000000-0000-4000-8000-000000000018', 'cancelled', null);
insert into public.shipment_cancellation_operations (
  shipment_id, order_id, source, actor_id, reason, claim_token, claim_expires_at,
  external_started_at, refund_id, refund_status, refund_status_updated_at
) values (
  'd0000000-0000-4000-8000-0000000c0006', 'd0000000-0000-4000-8000-0000000b0006', 'buyer',
  'd0000000-0000-4000-8000-000000000016', 'test cancellation', gen_random_uuid(), now(),
  now(), 're_test_pending', 'pending', now());

-- 17: buyer of a cancelled order whose payment is still being compensated.
select pg_temp.make_sale(7, 'd0000000-0000-4000-8000-000000000017', 'd0000000-0000-4000-8000-000000000018', 'cancelled', null);
update public.orders set compensation_state = 'refund_pending' where id = 'd0000000-0000-4000-8000-0000000b0007';

select is(
  (select count(*) from public.admin_connect_payout_release_view
   where shipment_id = 'd0000000-0000-4000-8000-0000000c0001'
     and status = 'completed' and release_amount_cents > 0 and payout_run_status is null),
  1::bigint, 'fixture: the completed Connect shipment is releasable and has no payout run');

-- 11: a completed Connect shipment without a paid payout run
set local role service_role;
select is((public.fn_close_account('d0000000-0000-4000-8000-000000000011'::uuid))->>'status', 'blocked', 'pending_payouts: a completed Connect shipment without a paid payout run refuses the closure');
select is((public.fn_close_account('d0000000-0000-4000-8000-000000000011'::uuid))->>'reason', 'pending_payouts', 'pending_payouts: the answer names the reason (11)');
reset role;
select is(pg_temp.snapshot('d0000000-0000-4000-8000-000000000011'), 'true|blk_payout_unpaid|0|payout_unpaid@test.local|payout_unpaid@test.local|2',
  'pending_payouts: the refusal changed nothing (11)');

-- 12: a payout run in pending_reconciliation
set local role service_role;
select is((public.fn_close_account('d0000000-0000-4000-8000-000000000012'::uuid))->>'status', 'blocked', 'pending_payouts: a payout run in pending_reconciliation refuses the closure');
select is((public.fn_close_account('d0000000-0000-4000-8000-000000000012'::uuid))->>'reason', 'pending_payouts', 'pending_payouts: the answer names the reason (12)');
reset role;
select is(pg_temp.snapshot('d0000000-0000-4000-8000-000000000012'), 'true|blk_run_pending|0|run_pending@test.local|run_pending@test.local|1',
  'pending_payouts: the refusal changed nothing (12)');

-- 13: a payout run in reconciliation_needed
set local role service_role;
select is((public.fn_close_account('d0000000-0000-4000-8000-000000000013'::uuid))->>'status', 'blocked', 'pending_payouts: a payout run in reconciliation_needed refuses the closure');
select is((public.fn_close_account('d0000000-0000-4000-8000-000000000013'::uuid))->>'reason', 'pending_payouts', 'pending_payouts: the answer names the reason (13)');
reset role;
select is(pg_temp.snapshot('d0000000-0000-4000-8000-000000000013'), 'true|blk_run_recon|0|run_recon@test.local|run_recon@test.local|1',
  'pending_payouts: the refusal changed nothing (13)');

-- 14: an open dispute as the buyer
set local role service_role;
select is((public.fn_close_account('d0000000-0000-4000-8000-000000000014'::uuid))->>'status', 'blocked', 'open_disputes: an open dispute as the buyer refuses the closure');
select is((public.fn_close_account('d0000000-0000-4000-8000-000000000014'::uuid))->>'reason', 'open_disputes', 'open_disputes: the answer names the reason (14)');
reset role;
select is(pg_temp.snapshot('d0000000-0000-4000-8000-000000000014'), 'true|blk_dispute_buyer|0|dispute_buyer@test.local|dispute_buyer@test.local|1',
  'open_disputes: the refusal changed nothing (14)');

-- 15: a return_shipped dispute as the seller
set local role service_role;
select is((public.fn_close_account('d0000000-0000-4000-8000-000000000015'::uuid))->>'status', 'blocked', 'open_disputes: a return_shipped dispute as the seller refuses the closure');
select is((public.fn_close_account('d0000000-0000-4000-8000-000000000015'::uuid))->>'reason', 'open_disputes', 'open_disputes: the answer names the reason (15)');
reset role;
select is(pg_temp.snapshot('d0000000-0000-4000-8000-000000000015'), 'true|blk_dispute_seller|0|dispute_seller@test.local|dispute_seller@test.local|2',
  'open_disputes: the refusal changed nothing (15)');

-- 16: a started cancellation with a pending refund
set local role service_role;
select is((public.fn_close_account('d0000000-0000-4000-8000-000000000016'::uuid))->>'status', 'blocked', 'pending_refunds: a started cancellation with a pending refund refuses the closure');
select is((public.fn_close_account('d0000000-0000-4000-8000-000000000016'::uuid))->>'reason', 'pending_refunds', 'pending_refunds: the answer names the reason (16)');
reset role;
select is(pg_temp.snapshot('d0000000-0000-4000-8000-000000000016'), 'true|blk_refund_op|0|refund_op@test.local|refund_op@test.local|1',
  'pending_refunds: the refusal changed nothing (16)');

-- 17: an order still compensating a payment
set local role service_role;
select is((public.fn_close_account('d0000000-0000-4000-8000-000000000017'::uuid))->>'status', 'blocked', 'pending_refunds: an order still compensating a payment refuses the closure');
select is((public.fn_close_account('d0000000-0000-4000-8000-000000000017'::uuid))->>'reason', 'pending_refunds', 'pending_refunds: the answer names the reason (17)');
reset role;
select is(pg_temp.snapshot('d0000000-0000-4000-8000-000000000017'), 'true|blk_compensation|0|compensation@test.local|compensation@test.local|1',
  'pending_refunds: the refusal changed nothing (17)');

-- Allowed control: settle each blocker and the same users close ------------------
-- 11: the payout run is paid and mapped to the shipment.
insert into public.connect_payout_runs (id, idempotency_key, seller_id, amount, status, actor_id, paid_at)
values ('d0000000-0000-4000-8000-0000000e0011', 'blockers-run-11', 'd0000000-0000-4000-8000-000000000011', 900, 'paid', 'd0000000-0000-4000-8000-000000000011', now());
insert into public.connect_payout_run_shipments (run_id, shipment_id, net_payout, status)
values ('d0000000-0000-4000-8000-0000000e0011', 'd0000000-0000-4000-8000-0000000c0001', 900, 'paid');
-- 12 / 13: the runs are paid.
update public.connect_payout_runs set status = 'paid', paid_at = now()
where id in ('d0000000-0000-4000-8000-0000000e0012', 'd0000000-0000-4000-8000-0000000e0013');
-- 14 / 15: the disputes are resolved.
update public.disputes set status = 'resolved'
where id in ('d0000000-0000-4000-8000-0000000d0004', 'd0000000-0000-4000-8000-0000000d0005');
-- 16: an admin resolved the failed refund.
update public.shipment_cancellation_operations set
  refund_status = 'failed', refund_resolved_at = now(),
  refund_resolved_by = 'd0000000-0000-4000-8000-000000000018', refund_resolution_reference = 'manual-ref-1'
where shipment_id = 'd0000000-0000-4000-8000-0000000c0006';
-- 17: the compensation finished.
update public.orders set compensation_state = 'refunded' where id = 'd0000000-0000-4000-8000-0000000b0007';

set local role service_role;
select is((public.fn_close_account('d0000000-0000-4000-8000-000000000011'::uuid))->>'status', 'closed', 'settled pending_payouts: the same user now closes (11)');
reset role;
select isnt((select deleted_at from public.profiles where id = 'd0000000-0000-4000-8000-000000000011'), null, 'settled pending_payouts: the profile is soft-deleted (11)');
set local role service_role;
select is((public.fn_close_account('d0000000-0000-4000-8000-000000000012'::uuid))->>'status', 'closed', 'settled pending_payouts: the same user now closes (12)');
reset role;
select isnt((select deleted_at from public.profiles where id = 'd0000000-0000-4000-8000-000000000012'), null, 'settled pending_payouts: the profile is soft-deleted (12)');
set local role service_role;
select is((public.fn_close_account('d0000000-0000-4000-8000-000000000013'::uuid))->>'status', 'closed', 'settled pending_payouts: the same user now closes (13)');
reset role;
select isnt((select deleted_at from public.profiles where id = 'd0000000-0000-4000-8000-000000000013'), null, 'settled pending_payouts: the profile is soft-deleted (13)');
set local role service_role;
select is((public.fn_close_account('d0000000-0000-4000-8000-000000000014'::uuid))->>'status', 'closed', 'settled open_disputes: the same user now closes (14)');
reset role;
select isnt((select deleted_at from public.profiles where id = 'd0000000-0000-4000-8000-000000000014'), null, 'settled open_disputes: the profile is soft-deleted (14)');
set local role service_role;
select is((public.fn_close_account('d0000000-0000-4000-8000-000000000015'::uuid))->>'status', 'closed', 'settled open_disputes: the same user now closes (15)');
reset role;
select isnt((select deleted_at from public.profiles where id = 'd0000000-0000-4000-8000-000000000015'), null, 'settled open_disputes: the profile is soft-deleted (15)');
set local role service_role;
select is((public.fn_close_account('d0000000-0000-4000-8000-000000000016'::uuid))->>'status', 'closed', 'settled pending_refunds: the same user now closes (16)');
reset role;
select isnt((select deleted_at from public.profiles where id = 'd0000000-0000-4000-8000-000000000016'), null, 'settled pending_refunds: the profile is soft-deleted (16)');
set local role service_role;
select is((public.fn_close_account('d0000000-0000-4000-8000-000000000017'::uuid))->>'status', 'closed', 'settled pending_refunds: the same user now closes (17)');
reset role;
select isnt((select deleted_at from public.profiles where id = 'd0000000-0000-4000-8000-000000000017'), null, 'settled pending_refunds: the profile is soft-deleted (17)');

-- account_restricted and active_orders ------------------------------------------
-- 21 suspended and 22 banned (each with a live listing); 23 a buyer whose order
-- is paid but not finished.
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change
)
select '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated',
  u.email, '', now(), '{}'::jsonb, jsonb_build_object('username', u.username), now(), now(), '', '', '', ''
from (values
  ('d0000000-0000-4000-8000-000000000021'::uuid, 'restricted_susp@test.local', 'blk_restricted_s'),
  ('d0000000-0000-4000-8000-000000000022'::uuid, 'restricted_ban@test.local', 'blk_restricted_b'),
  ('d0000000-0000-4000-8000-000000000023'::uuid, 'active_order@test.local', 'blk_active_order')
) as u(id, email, username);
select pg_temp.make_product('d0000000-0000-4000-8000-0000000f0021', 'd0000000-0000-4000-8000-000000000021', 'VERIFIED');
select pg_temp.make_product('d0000000-0000-4000-8000-0000000f0022', 'd0000000-0000-4000-8000-000000000022', 'VERIFIED');
update public.profiles_private set status = 'suspended' where id = 'd0000000-0000-4000-8000-000000000021';
update public.profiles_private set status = 'banned' where id = 'd0000000-0000-4000-8000-000000000022';
select pg_temp.make_sale(8, 'd0000000-0000-4000-8000-000000000023', 'd0000000-0000-4000-8000-000000000018', 'paid', null);

set local role service_role;
select is((public.fn_close_account('d0000000-0000-4000-8000-000000000021'::uuid))->>'status', 'blocked', 'account_restricted: a suspended account cannot close itself');
select is((public.fn_close_account('d0000000-0000-4000-8000-000000000021'::uuid))->>'reason', 'account_restricted', 'account_restricted: the answer names the reason (21)');
select is((public.fn_close_account('d0000000-0000-4000-8000-000000000022'::uuid))->>'status', 'blocked', 'account_restricted: a banned account cannot close itself');
select is((public.fn_close_account('d0000000-0000-4000-8000-000000000022'::uuid))->>'reason', 'account_restricted', 'account_restricted: the answer names the reason (22)');
select is((public.fn_close_account('d0000000-0000-4000-8000-000000000023'::uuid))->>'status', 'blocked', 'active_orders: an unfinished buyer order refuses the closure');
select is((public.fn_close_account('d0000000-0000-4000-8000-000000000023'::uuid))->>'reason', 'active_orders', 'active_orders: the answer names the reason (23)');
reset role;
select is(pg_temp.snapshot('d0000000-0000-4000-8000-000000000021'), 'true|blk_restricted_s|0|restricted_susp@test.local|restricted_susp@test.local|1',
  'account_restricted: the refusal changed nothing (21)');
select is(pg_temp.snapshot('d0000000-0000-4000-8000-000000000022'), 'true|blk_restricted_b|0|restricted_ban@test.local|restricted_ban@test.local|1',
  'account_restricted: the refusal changed nothing (22)');
select is(pg_temp.snapshot('d0000000-0000-4000-8000-000000000023'), 'true|blk_active_order|0|active_order@test.local|active_order@test.local|0',
  'active_orders: the refusal changed nothing (23)');

-- Settled: the suspension is lifted and the order completes; the ban stays final.
update public.profiles_private set status = 'active' where id = 'd0000000-0000-4000-8000-000000000021';
update public.orders set status = 'completed' where id = 'd0000000-0000-4000-8000-0000000b0008';
update public.shipments set status = 'completed', completed_at = now() where id = 'd0000000-0000-4000-8000-0000000c0008';
set local role service_role;
select is((public.fn_close_account('d0000000-0000-4000-8000-000000000021'::uuid))->>'status', 'closed', 'settled account_restricted: the same user closes once active (21)');
select is((public.fn_close_account('d0000000-0000-4000-8000-000000000023'::uuid))->>'status', 'closed', 'settled active_orders: the same buyer closes once the order completes (23)');
reset role;
select isnt((select deleted_at from public.profiles where id = 'd0000000-0000-4000-8000-000000000021'), null, 'settled account_restricted: the profile is soft-deleted (21)');
select isnt((select deleted_at from public.profiles where id = 'd0000000-0000-4000-8000-000000000023'), null, 'settled active_orders: the profile is soft-deleted (23)');

select * from finish();
rollback;
