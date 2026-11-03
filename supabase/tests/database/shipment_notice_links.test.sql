-- Shipment-scoped notice producers link to the shipment of the dispute, not
-- to the order summary: for an order with two shipments every notice carries
-- '/profile/orders/<order>?shipment_id=<shipment of the dispute>' and never
-- the other shipment (expo-push-notifications T13, S1).
-- Producers: fn_notify_dispute_opened (trigger), fn_mark_return_delivered,
-- fn_seller_submit_return_evidence, fn_resolve_dispute_to_buyer,
-- fn_resolve_dispute_to_buyer_as_admin, fn_resolve_dispute_to_seller and the
-- success path of fn_cron_return_delivery_timeout.
-- Runs against the local database only: `supabase start`, then `bun run test:db`.
begin;
select plan(23);

-- Same economics formula as validate_product_publication_economics.
create function pg_temp.make_product(p_id uuid, p_seller uuid)
returns void language sql as $$
  insert into public.products (
    id, name, description, price, category, condition, usage, images, status,
    specifications, seller_id, shipping_cost, origin_zip, package_preset,
    publication_shipping_reserve_cents, publication_commission_rate,
    publication_insurance_rate
  )
  select p_id, 'Test GPU', 'Test listing', 1000, 'GPU', 'used', 'gaming',
    array['https://example.test/p.png'], 'SOLD'::public.product_status_enum, '{}'::jsonb, p_seller, 100, '06600', 'gpu_1',
    round(100 * 100)::bigint + s.shipping_buffer_cents
      + ceil(round(1000 * 100)::numeric * public.normalize_publication_rate(s.insurance_rate))::bigint,
    public.normalize_publication_rate(s.service_fee_pct),
    public.normalize_publication_rate(s.insurance_rate)
  from public.system_settings s where s.id = 1
$$;

-- The distinct links a kind wrote, as one comparable string, and how many rows.
create function pg_temp.links(p_kind text) returns text language sql as $$
  select coalesce(string_agg(distinct action_path, ' | '), '') from public.notifications where event_kind = p_kind and user_id in ('d0000000-0000-4000-8000-000000000022', 'd0000000-0000-4000-8000-000000000023')
$$;
create function pg_temp.rows_of(p_kind text) returns bigint language sql as $$
  select count(*) from public.notifications where event_kind = p_kind and user_id in ('d0000000-0000-4000-8000-000000000022', 'd0000000-0000-4000-8000-000000000023')
$$;

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change
)
select '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated',
  u.email, '', now(), '{}'::jsonb, jsonb_build_object('username', u.username), now(), now(), '', '', '', ''
from (values
  ('d0000000-0000-4000-8000-000000000021'::uuid, 'link_admin@test.local', 'link_admin'),
  ('d0000000-0000-4000-8000-000000000022'::uuid, 'link_buyer@test.local', 'link_buyer'),
  ('d0000000-0000-4000-8000-000000000023'::uuid, 'link_seller@test.local', 'link_seller')
) as u(id, email, username);
update public.profiles_private set role = 'admin'
where id = 'd0000000-0000-4000-8000-000000000021';

-- One order, two shipments of the same seller; the dispute is on shipment 1.
insert into public.orders (id, buyer_id, total_amount, shipping_address, status)
values ('d0000000-0000-4000-8000-0000000b0021', 'd0000000-0000-4000-8000-000000000022', 2000, '{}'::jsonb, 'completed');
insert into public.shipments (id, order_id, seller_id, status, completed_at, stripe_payment_intent_id)
values
  ('d0000000-0000-4000-8000-0000000c0021', 'd0000000-0000-4000-8000-0000000b0021', 'd0000000-0000-4000-8000-000000000023', 'completed', now(), 'pi_test_links_1'),
  ('d0000000-0000-4000-8000-0000000c0022', 'd0000000-0000-4000-8000-0000000b0021', 'd0000000-0000-4000-8000-000000000023', 'completed', now(), 'pi_test_links_2');
select pg_temp.make_product('d0000000-0000-4000-8000-0000000a0021', 'd0000000-0000-4000-8000-000000000023');
select pg_temp.make_product('d0000000-0000-4000-8000-0000000a0022', 'd0000000-0000-4000-8000-000000000023');
insert into public.order_items (order_id, product_id, seller_id, price_at_purchase, net_payout, shipment_id)
values
  ('d0000000-0000-4000-8000-0000000b0021', 'd0000000-0000-4000-8000-0000000a0021', 'd0000000-0000-4000-8000-000000000023', 1000, 900, 'd0000000-0000-4000-8000-0000000c0021'),
  ('d0000000-0000-4000-8000-0000000b0021', 'd0000000-0000-4000-8000-0000000a0022', 'd0000000-0000-4000-8000-000000000023', 1000, 900, 'd0000000-0000-4000-8000-0000000c0022');
update public.orders set status = 'completed' where id = 'd0000000-0000-4000-8000-0000000b0021';

-- Producers filter by kind, so start from an empty inbox for these users.
delete from public.notifications
where user_id in ('d0000000-0000-4000-8000-000000000022', 'd0000000-0000-4000-8000-000000000023');

-- 6. fn_notify_dispute_opened (AFTER INSERT on disputes, service role only)
select set_config('request.jwt.claims', '{"role": "service_role"}', true);
insert into public.disputes (id, order_id, buyer_id, seller_id, reason, description, shipment_id)
values ('d0000000-0000-4000-8000-0000000d0021', 'd0000000-0000-4000-8000-0000000b0021',
  'd0000000-0000-4000-8000-000000000022', 'd0000000-0000-4000-8000-000000000023',
  'damaged', 'Buyer dispute', 'd0000000-0000-4000-8000-0000000c0021');

select is(pg_temp.links('dispute.opened'),
  '/profile/orders/d0000000-0000-4000-8000-0000000b0021?shipment_id=d0000000-0000-4000-8000-0000000c0021',
  'dispute.opened links to the shipment of the dispute');
select is(
  (select user_id from public.notifications where event_kind = 'dispute.opened' and user_id in ('d0000000-0000-4000-8000-000000000022', 'd0000000-0000-4000-8000-000000000023')),
  'd0000000-0000-4000-8000-000000000023'::uuid, 'dispute.opened goes to the seller');

-- 1. fn_mark_return_delivered (service role)
update public.disputes set status = 'waiting_return' where id = 'd0000000-0000-4000-8000-0000000d0021';
set local role service_role;
select is((select success from public.fn_mark_return_delivered('d0000000-0000-4000-8000-0000000d0021')),
  true, 'fn_mark_return_delivered succeeds');
reset role;
select is(pg_temp.links('return.delivered'),
  '/profile/orders/d0000000-0000-4000-8000-0000000b0021?shipment_id=d0000000-0000-4000-8000-0000000c0021',
  'return.delivered links to the shipment of the dispute');
select is(pg_temp.rows_of('return.delivered'), 2::bigint, 'return.delivered is written for the buyer and the seller');

-- 2. fn_seller_submit_return_evidence (the seller, authenticated)
select set_config('request.jwt.claims', '{"sub": "d0000000-0000-4000-8000-000000000023", "role": "authenticated"}', true);
set local role authenticated;
select is((select success from public.fn_seller_submit_return_evidence(
    'd0000000-0000-4000-8000-0000000d0021', array['https://example.test/e.png'], 'https://example.test/e.mp4')),
  true, 'fn_seller_submit_return_evidence succeeds as the seller');
reset role;
select is(pg_temp.links('return.seller_evidence_submitted'),
  '/profile/orders/d0000000-0000-4000-8000-0000000b0021?shipment_id=d0000000-0000-4000-8000-0000000c0021',
  'return.seller_evidence_submitted links to the shipment of the dispute');
select is(
  (select user_id from public.notifications where event_kind = 'return.seller_evidence_submitted' and user_id in ('d0000000-0000-4000-8000-000000000022', 'd0000000-0000-4000-8000-000000000023')),
  'd0000000-0000-4000-8000-000000000022'::uuid, 'return.seller_evidence_submitted goes to the buyer');

-- 3a. fn_resolve_dispute_to_buyer (service role carrying the admin session); the dispute is open again
select set_config('request.jwt.claims', '{"sub": "d0000000-0000-4000-8000-000000000021", "role": "service_role"}', true);
set local role service_role;
select is((select success from public.fn_resolve_dispute_to_buyer('d0000000-0000-4000-8000-0000000d0021', 'note')),
  true, 'fn_resolve_dispute_to_buyer succeeds as an admin');
reset role;
select is(pg_temp.links('dispute.verdict'),
  '/profile/orders/d0000000-0000-4000-8000-0000000b0021?shipment_id=d0000000-0000-4000-8000-0000000c0021',
  'fn_resolve_dispute_to_buyer: dispute.verdict links to the shipment of the dispute');
select is(pg_temp.rows_of('dispute.verdict'), 2::bigint, 'fn_resolve_dispute_to_buyer: verdict for the buyer and the seller');

-- 3b. fn_resolve_dispute_to_buyer_as_admin (service role, admin id as argument)
delete from public.notifications where event_kind = 'dispute.verdict' and user_id in ('d0000000-0000-4000-8000-000000000022', 'd0000000-0000-4000-8000-000000000023');
update public.disputes set status = 'open' where id = 'd0000000-0000-4000-8000-0000000d0021';
select set_config('request.jwt.claims', '{"role": "service_role"}', true);
set local role service_role;
select is((select success from public.fn_resolve_dispute_to_buyer_as_admin(
    'd0000000-0000-4000-8000-0000000d0021', 'note', 'd0000000-0000-4000-8000-000000000021')),
  true, 'fn_resolve_dispute_to_buyer_as_admin succeeds');
reset role;
select is(pg_temp.links('dispute.verdict'),
  '/profile/orders/d0000000-0000-4000-8000-0000000b0021?shipment_id=d0000000-0000-4000-8000-0000000c0021',
  'fn_resolve_dispute_to_buyer_as_admin: dispute.verdict links to the shipment of the dispute');
select is(pg_temp.rows_of('dispute.verdict'), 2::bigint, 'fn_resolve_dispute_to_buyer_as_admin: verdict for the buyer and the seller');

-- 4. fn_resolve_dispute_to_seller (service role carrying the admin session)
delete from public.notifications where event_kind = 'dispute.verdict' and user_id in ('d0000000-0000-4000-8000-000000000022', 'd0000000-0000-4000-8000-000000000023');
update public.disputes set status = 'open' where id = 'd0000000-0000-4000-8000-0000000d0021';
select set_config('request.jwt.claims', '{"sub": "d0000000-0000-4000-8000-000000000021", "role": "service_role"}', true);
set local role service_role;
select is((select success from public.fn_resolve_dispute_to_seller('d0000000-0000-4000-8000-0000000d0021', 'note')),
  true, 'fn_resolve_dispute_to_seller succeeds as an admin');
reset role;
select is(pg_temp.links('dispute.verdict'),
  '/profile/orders/d0000000-0000-4000-8000-0000000b0021?shipment_id=d0000000-0000-4000-8000-0000000c0021',
  'fn_resolve_dispute_to_seller: dispute.verdict links to the shipment of the dispute');
select is(pg_temp.rows_of('dispute.verdict'), 2::bigint, 'fn_resolve_dispute_to_seller: verdict for the buyer and the seller');

-- 5. fn_cron_return_delivery_timeout, Connect success path (untyped notice)
delete from public.notifications where title = 'Devolución Recibida' and user_id in ('d0000000-0000-4000-8000-000000000022', 'd0000000-0000-4000-8000-000000000023');
update public.disputes
set status = 'return_delivered', return_delivered_at = now() - interval '49 hours'
where id = 'd0000000-0000-4000-8000-0000000d0021';
select set_config('request.jwt.claims', '{"role": "service_role"}', true);
set local role service_role;
select ok((select count(*) from public.fn_cron_return_delivery_timeout()) = 1,
  'fn_cron_return_delivery_timeout runs');
reset role;
select is(
  (select string_agg(action_path, ' | ') from public.notifications where title = 'Devolución Recibida' and user_id in ('d0000000-0000-4000-8000-000000000022', 'd0000000-0000-4000-8000-000000000023')),
  '/profile/orders/d0000000-0000-4000-8000-0000000b0021?shipment_id=d0000000-0000-4000-8000-0000000c0021',
  'fn_cron_return_delivery_timeout: the notice links to the shipment of the dispute');
select is(
  (select user_id from public.notifications where title = 'Devolución Recibida' and user_id in ('d0000000-0000-4000-8000-000000000022', 'd0000000-0000-4000-8000-000000000023')),
  'd0000000-0000-4000-8000-000000000022'::uuid, 'fn_cron_return_delivery_timeout: the notice goes to the buyer');
select is(
  (select event_kind from public.notifications where title = 'Devolución Recibida' and user_id in ('d0000000-0000-4000-8000-000000000022', 'd0000000-0000-4000-8000-000000000023')),
  null, 'fn_cron_return_delivery_timeout: the notice has no event_kind');

-- The other shipment of the order never appears in any link of these users.
select is(
  (select count(*) from public.notifications
   where user_id in ('d0000000-0000-4000-8000-000000000022', 'd0000000-0000-4000-8000-000000000023')
     and action_path like '%d0000000-0000-4000-8000-0000000c0022%'),
  0::bigint, 'no notice links to the other shipment of the order');
select is(
  (select count(*) from public.notifications
   where user_id in ('d0000000-0000-4000-8000-000000000022', 'd0000000-0000-4000-8000-000000000023')
     and action_path is distinct from
       '/profile/orders/d0000000-0000-4000-8000-0000000b0021?shipment_id=d0000000-0000-4000-8000-0000000c0021'),
  0::bigint, 'every notice of the dispute links to the shipment of the dispute');

select * from finish();
rollback;
