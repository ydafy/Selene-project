-- Evidence retention (ops-cron-storage S5, L2, L10): fn_list_evidence_purge_candidates
-- lists orders whose every shipment is completed, cancelled or refunded, that closed
-- (latest greatest(completed_at, updated_at) of their shipments, L12) more than 120 days
-- ago, with no open dispute (status not resolved or rejected, NULL counts as open)
-- and not purged yet, oldest closed first, with their evidence object names.
-- fn_mark_evidence_purged stamps orders.evidence_purged_at once the order still
-- qualifies and no evidence object remains for it.
-- Every order that exists before this file is marked purged inside the transaction,
-- so the list sees only this file's orders (ids starting with e5000000-).
-- Runs against the local database only: `supabase start`, then `bun run test:db`.
begin;
select plan(37);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change
)
select '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated',
  u.email, '', now(), '{}'::jsonb, jsonb_build_object('username', u.username), now(), now(), '', '', '', ''
from (values
  ('e5000000-0000-4000-8000-000000000001'::uuid, 'evp_buyer@test.local', 'evp_buyer'),
  ('e5000000-0000-4000-8000-000000000002'::uuid, 'evp_seller@test.local', 'evp_seller')
) as u(id, email, username);

update public.orders set evidence_purged_at = now() where evidence_purged_at is null;

-- Orders (bN) and their shipments (cN):
--   b1 completed 121 days ago, three evidence objects: candidate.
--   b2 completed 119 days ago: too recent.
--   b3 one shipment completed 200 days ago, one still shipped: not closed.
--   b4 closed 130 days ago, open dispute: held.
--   b5 closed 130 days ago, dispute with NULL status and no shipment_id: held.
--   b6 two shipments, closed 140 days ago, one resolved dispute and one rejected
--      order-level dispute, no objects: candidate.
--   b7 closed 150 days ago, already purged: skipped.
--   b8 no shipments: never a candidate.
--   b9 cancelled shipment updated 125 days ago (no completed_at), completed
--      shipment completed 300 days ago and updated 280 days ago: closed 125 days ago.
--   b10-b13 a shipment completed 200 days ago, held: b10 by a second shipment in
--      status dispute, b11 by a waiting_return dispute, b12 by a return_delivered
--      dispute, b13 by an open dispute with no shipment_id.
--   b14 completed exactly 120 days ago: not past the retention yet.
--   b15 refunded after completion (fn_complete_overdue_payout_refund keeps
--      completed_at): completed 200 days ago, updated 30 days ago: too recent (L12).
--   b16 the same refund updated 130 days ago: candidate.
insert into public.orders (id, buyer_id, total_amount_cents, shipping_address)
select ('e5000000-0000-4000-8000-0000000b000' || n)::uuid,
  'e5000000-0000-4000-8000-000000000001', 100000, '{}'::jsonb
from generate_series(1, 9) as n;
insert into public.orders (id, buyer_id, total_amount_cents, shipping_address)
select ('e5000000-0000-4000-8000-0000000b00' || n)::uuid,
  'e5000000-0000-4000-8000-000000000001', 100000, '{}'::jsonb
from generate_series(10, 17) as n;

insert into public.shipments (id, order_id, seller_id, status, completed_at, updated_at, stripe_payment_intent_id)
values
  ('e5000000-0000-4000-8000-0000000c0001', 'e5000000-0000-4000-8000-0000000b0001', 'e5000000-0000-4000-8000-000000000002',
    'completed', now() - interval '121 days', now() - interval '121 days', 'pi_test_evp_1'),
  ('e5000000-0000-4000-8000-0000000c0002', 'e5000000-0000-4000-8000-0000000b0002', 'e5000000-0000-4000-8000-000000000002',
    'completed', now() - interval '119 days', now() - interval '119 days', 'pi_test_evp_2'),
  ('e5000000-0000-4000-8000-0000000c0003', 'e5000000-0000-4000-8000-0000000b0003', 'e5000000-0000-4000-8000-000000000002',
    'completed', now() - interval '200 days', now() - interval '200 days', 'pi_test_evp_3'),
  ('e5000000-0000-4000-8000-0000000c0013', 'e5000000-0000-4000-8000-0000000b0003', 'e5000000-0000-4000-8000-000000000002',
    'shipped', null, now() - interval '200 days', 'pi_test_evp_13'),
  ('e5000000-0000-4000-8000-0000000c0004', 'e5000000-0000-4000-8000-0000000b0004', 'e5000000-0000-4000-8000-000000000002',
    'completed', now() - interval '130 days', now() - interval '130 days', 'pi_test_evp_4'),
  ('e5000000-0000-4000-8000-0000000c0005', 'e5000000-0000-4000-8000-0000000b0005', 'e5000000-0000-4000-8000-000000000002',
    'refunded', null, now() - interval '130 days', 'pi_test_evp_5'),
  ('e5000000-0000-4000-8000-0000000c0006', 'e5000000-0000-4000-8000-0000000b0006', 'e5000000-0000-4000-8000-000000000002',
    'completed', now() - interval '140 days', now() - interval '140 days', 'pi_test_evp_6'),
  ('e5000000-0000-4000-8000-0000000c0016', 'e5000000-0000-4000-8000-0000000b0006', 'e5000000-0000-4000-8000-000000000002',
    'refunded', null, now() - interval '160 days', 'pi_test_evp_16'),
  ('e5000000-0000-4000-8000-0000000c0007', 'e5000000-0000-4000-8000-0000000b0007', 'e5000000-0000-4000-8000-000000000002',
    'completed', now() - interval '150 days', now() - interval '150 days', 'pi_test_evp_7'),
  ('e5000000-0000-4000-8000-0000000c0009', 'e5000000-0000-4000-8000-0000000b0009', 'e5000000-0000-4000-8000-000000000002',
    'cancelled', null, now() - interval '125 days', 'pi_test_evp_9'),
  ('e5000000-0000-4000-8000-0000000c0019', 'e5000000-0000-4000-8000-0000000b0009', 'e5000000-0000-4000-8000-000000000002',
    'completed', now() - interval '300 days', now() - interval '280 days', 'pi_test_evp_19'),
  ('e5000000-0000-4000-8000-0000000c0100', 'e5000000-0000-4000-8000-0000000b0010', 'e5000000-0000-4000-8000-000000000002',
    'completed', now() - interval '200 days', now() - interval '200 days', 'pi_test_evp_100'),
  ('e5000000-0000-4000-8000-0000000c0101', 'e5000000-0000-4000-8000-0000000b0010', 'e5000000-0000-4000-8000-000000000002',
    'dispute', null, now() - interval '200 days', 'pi_test_evp_101'),
  ('e5000000-0000-4000-8000-0000000c0110', 'e5000000-0000-4000-8000-0000000b0011', 'e5000000-0000-4000-8000-000000000002',
    'completed', now() - interval '200 days', now() - interval '200 days', 'pi_test_evp_110'),
  ('e5000000-0000-4000-8000-0000000c0120', 'e5000000-0000-4000-8000-0000000b0012', 'e5000000-0000-4000-8000-000000000002',
    'completed', now() - interval '200 days', now() - interval '200 days', 'pi_test_evp_120'),
  ('e5000000-0000-4000-8000-0000000c0130', 'e5000000-0000-4000-8000-0000000b0013', 'e5000000-0000-4000-8000-000000000002',
    'completed', now() - interval '200 days', now() - interval '200 days', 'pi_test_evp_130'),
  ('e5000000-0000-4000-8000-0000000c0140', 'e5000000-0000-4000-8000-0000000b0014', 'e5000000-0000-4000-8000-000000000002',
    'completed', now() - interval '120 days', now() - interval '120 days', 'pi_test_evp_140'),
  ('e5000000-0000-4000-8000-0000000c0150', 'e5000000-0000-4000-8000-0000000b0015', 'e5000000-0000-4000-8000-000000000002',
    'refunded', now() - interval '200 days', now() - interval '30 days', 'pi_test_evp_150'),
  ('e5000000-0000-4000-8000-0000000c0160', 'e5000000-0000-4000-8000-0000000b0016', 'e5000000-0000-4000-8000-000000000002',
    'refunded', now() - interval '200 days', now() - interval '130 days', 'pi_test_evp_160'),
  -- b17 completed 100 days ago but last updated 200 days ago: the later date counts.
  ('e5000000-0000-4000-8000-0000000c0170', 'e5000000-0000-4000-8000-0000000b0017', 'e5000000-0000-4000-8000-000000000002',
    'completed', now() - interval '100 days', now() - interval '200 days', 'pi_test_evp_170');

-- The dispute insert triggers need the service role claim and a shipment_id; the
-- order-level disputes (shipment_id NULL) drop it afterwards.
select set_config('request.jwt.claims', '{"role": "service_role"}', true);
insert into public.disputes (id, order_id, buyer_id, seller_id, reason, description, shipment_id)
values
  ('e5000000-0000-4000-8000-0000000d0004', 'e5000000-0000-4000-8000-0000000b0004', 'e5000000-0000-4000-8000-000000000001',
    'e5000000-0000-4000-8000-000000000002', 'damaged', 'Open dispute', 'e5000000-0000-4000-8000-0000000c0004'),
  ('e5000000-0000-4000-8000-0000000d0005', 'e5000000-0000-4000-8000-0000000b0005', 'e5000000-0000-4000-8000-000000000001',
    'e5000000-0000-4000-8000-000000000002', 'damaged', 'Order-level dispute', 'e5000000-0000-4000-8000-0000000c0005'),
  ('e5000000-0000-4000-8000-0000000d0006', 'e5000000-0000-4000-8000-0000000b0006', 'e5000000-0000-4000-8000-000000000001',
    'e5000000-0000-4000-8000-000000000002', 'damaged', 'Resolved dispute', 'e5000000-0000-4000-8000-0000000c0006'),
  ('e5000000-0000-4000-8000-0000000d0016', 'e5000000-0000-4000-8000-0000000b0006', 'e5000000-0000-4000-8000-000000000001',
    'e5000000-0000-4000-8000-000000000002', 'damaged', 'Rejected dispute', 'e5000000-0000-4000-8000-0000000c0016');
update public.disputes set status = null, shipment_id = null where id = 'e5000000-0000-4000-8000-0000000d0005';
update public.disputes set status = 'resolved' where id = 'e5000000-0000-4000-8000-0000000d0006';
update public.disputes set status = 'rejected', shipment_id = null where id = 'e5000000-0000-4000-8000-0000000d0016';
insert into public.disputes (id, order_id, buyer_id, seller_id, reason, description, shipment_id)
values
  ('e5000000-0000-4000-8000-0000000d0110', 'e5000000-0000-4000-8000-0000000b0011', 'e5000000-0000-4000-8000-000000000001',
    'e5000000-0000-4000-8000-000000000002', 'damaged', 'Waiting return', 'e5000000-0000-4000-8000-0000000c0110'),
  ('e5000000-0000-4000-8000-0000000d0120', 'e5000000-0000-4000-8000-0000000b0012', 'e5000000-0000-4000-8000-000000000001',
    'e5000000-0000-4000-8000-000000000002', 'damaged', 'Return delivered', 'e5000000-0000-4000-8000-0000000c0120'),
  ('e5000000-0000-4000-8000-0000000d0130', 'e5000000-0000-4000-8000-0000000b0013', 'e5000000-0000-4000-8000-000000000001',
    'e5000000-0000-4000-8000-000000000002', 'damaged', 'Open order-level dispute', 'e5000000-0000-4000-8000-0000000c0130');
update public.disputes set status = 'waiting_return' where id = 'e5000000-0000-4000-8000-0000000d0110';
update public.disputes set status = 'return_delivered' where id = 'e5000000-0000-4000-8000-0000000d0120';
update public.disputes set status = 'open', shipment_id = null where id = 'e5000000-0000-4000-8000-0000000d0130';

update public.orders set evidence_purged_at = now() - interval '1 day'
where id = 'e5000000-0000-4000-8000-0000000b0007';

-- Evidence of b1 in all three folders, plus objects of b2 and of a path that only
-- shares b1's id as a prefix of its second folder, and objects that name b1 but
-- are not its evidence: another folder, a folder that ends in "disputes", the bare
-- folder name with no trailing slash, and the verification bucket.
insert into storage.objects (bucket_id, name)
values
  ('evidence', 'disputes/e5000000-0000-4000-8000-0000000b0001/e5000000-0000-4000-8000-000000000001/defect.jpg'),
  ('evidence', 'returns/e5000000-0000-4000-8000-0000000b0001/e5000000-0000-4000-8000-000000000001/return.jpg'),
  ('evidence', 'shipments/e5000000-0000-4000-8000-0000000b0001/e5000000-0000-4000-8000-000000000002/box.jpg'),
  ('evidence', 'disputes/e5000000-0000-4000-8000-0000000b0002/e5000000-0000-4000-8000-000000000001/defect.jpg'),
  ('evidence', 'disputes/e5000000-0000-4000-8000-0000000b0001x/e5000000-0000-4000-8000-000000000001/other.jpg'),
  ('evidence', 'other/e5000000-0000-4000-8000-0000000b0001/x.jpg'),
  ('evidence', 'xdisputes/e5000000-0000-4000-8000-0000000b0001/x.jpg'),
  ('evidence', 'disputes/e5000000-0000-4000-8000-0000000b0001'),
  ('verification', 'disputes/e5000000-0000-4000-8000-0000000b0001/u/x.jpg');

-- Grants: service_role only.
select ok(has_function_privilege('service_role', 'public.fn_list_evidence_purge_candidates(integer)', 'EXECUTE'),
  'service_role can list evidence purge candidates');
select ok(has_function_privilege('service_role', 'public.fn_mark_evidence_purged(uuid)', 'EXECUTE'),
  'service_role can mark an order purged');
select ok(
  not has_function_privilege('anon', 'public.fn_list_evidence_purge_candidates(integer)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.fn_list_evidence_purge_candidates(integer)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.fn_mark_evidence_purged(uuid)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.fn_mark_evidence_purged(uuid)', 'EXECUTE'),
  'anon and authenticated cannot call either function');
select ok(
  (select bool_and(p.prosecdef and p.proconfig = array['search_path=pg_catalog, pg_temp'])
   from pg_proc p
   where p.oid in ('public.fn_list_evidence_purge_candidates(integer)'::regprocedure,
                   'public.fn_mark_evidence_purged(uuid)'::regprocedure)),
  'both functions are SECURITY DEFINER with search_path pg_catalog, pg_temp');

select set_config('request.jwt.claims', '{"sub": "e5000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
set local role authenticated;
select throws_ok($$select * from public.fn_list_evidence_purge_candidates(10)$$,
  '42501', null, 'authenticated cannot list candidates');
select throws_ok($$select public.fn_mark_evidence_purged('e5000000-0000-4000-8000-0000000b0001')$$,
  '42501', null, 'authenticated cannot mark an order');
reset role;

select set_config('request.jwt.claims', '{"role": "service_role"}', true);
set local role service_role;

-- Listing.
select results_eq(
  $$select order_id, object_names from public.fn_list_evidence_purge_candidates(100)$$,
  $$values
    ('e5000000-0000-4000-8000-0000000b0006'::uuid, '{}'::text[]),
    ('e5000000-0000-4000-8000-0000000b0016'::uuid, '{}'::text[]),
    ('e5000000-0000-4000-8000-0000000b0009'::uuid, '{}'::text[]),
    ('e5000000-0000-4000-8000-0000000b0001'::uuid, array[
      'disputes/e5000000-0000-4000-8000-0000000b0001/e5000000-0000-4000-8000-000000000001/defect.jpg',
      'returns/e5000000-0000-4000-8000-0000000b0001/e5000000-0000-4000-8000-000000000001/return.jpg',
      'shipments/e5000000-0000-4000-8000-0000000b0001/e5000000-0000-4000-8000-000000000002/box.jpg'])$$,
  'lists the closed, undisputed, unpurged orders past 120 days, oldest closed first, with their evidence objects');
select results_eq(
  $$select order_id from public.fn_list_evidence_purge_candidates(2)$$,
  $$values ('e5000000-0000-4000-8000-0000000b0006'::uuid), ('e5000000-0000-4000-8000-0000000b0016'::uuid)$$,
  'p_limit caps the batch and keeps the oldest closed orders');
select results_eq(
  $$select object_names from public.fn_list_evidence_purge_candidates(100)
    where order_id = 'e5000000-0000-4000-8000-0000000b0001'$$,
  $$values (array[
      'disputes/e5000000-0000-4000-8000-0000000b0001/e5000000-0000-4000-8000-000000000001/defect.jpg',
      'returns/e5000000-0000-4000-8000-0000000b0001/e5000000-0000-4000-8000-000000000001/return.jpg',
      'shipments/e5000000-0000-4000-8000-0000000b0001/e5000000-0000-4000-8000-000000000002/box.jpg'])$$,
  'object_names leaves out objects in other folders, the bare folder name and other buckets');
select is_empty(
  $$select order_id from public.fn_list_evidence_purge_candidates(100)
    where order_id in ('e5000000-0000-4000-8000-0000000b0010', 'e5000000-0000-4000-8000-0000000b0011',
                       'e5000000-0000-4000-8000-0000000b0012', 'e5000000-0000-4000-8000-0000000b0013')$$,
  'orders held by a disputed shipment or a waiting_return, return_delivered or open order-level dispute are not listed');
select is_empty(
  $$select order_id from public.fn_list_evidence_purge_candidates(100)
    where order_id = 'e5000000-0000-4000-8000-0000000b0014'$$,
  'an order closed exactly 120 days ago is not listed');
select is_empty(
  $$select order_id from public.fn_list_evidence_purge_candidates(100)
    where order_id = 'e5000000-0000-4000-8000-0000000b0015'$$,
  'an order refunded 30 days ago after a completion 200 days ago is not listed');
select is_empty(
  $$select order_id from public.fn_list_evidence_purge_candidates(100)
    where order_id = 'e5000000-0000-4000-8000-0000000b0017'$$,
  'an order completed 100 days ago with an older updated_at is not listed');
select results_eq(
  $$select order_id from public.fn_list_evidence_purge_candidates(100)
    where order_id = 'e5000000-0000-4000-8000-0000000b0016'$$,
  $$values ('e5000000-0000-4000-8000-0000000b0016'::uuid)$$,
  'an order refunded 130 days ago after a completion 200 days ago is listed');
select throws_ok($$select * from public.fn_list_evidence_purge_candidates(0)$$,
  'P0001', 'INVALID_ARGUMENT', 'a limit below 1 is rejected');
select throws_ok($$select * from public.fn_list_evidence_purge_candidates(101)$$,
  'P0001', 'INVALID_ARGUMENT', 'a limit above 100 is rejected');
select throws_ok($$select * from public.fn_list_evidence_purge_candidates(null)$$,
  'P0001', 'INVALID_ARGUMENT', 'a NULL limit is rejected');

-- Marking: refused while the rule fails, whatever the objects.
select is(public.fn_mark_evidence_purged('e5000000-0000-4000-8000-0000000b0003'), false,
  'an order with a live shipment is not marked');
select is(public.fn_mark_evidence_purged('e5000000-0000-4000-8000-0000000b0004'), false,
  'an order with an open dispute is not marked');
select is(public.fn_mark_evidence_purged('e5000000-0000-4000-8000-0000000b0005'), false,
  'an order with a NULL-status dispute is not marked');
select is(public.fn_mark_evidence_purged('e5000000-0000-4000-8000-0000000b0008'), false,
  'an order without shipments is not marked');
select is(public.fn_mark_evidence_purged('e5000000-0000-4000-8000-0000000b0007'), false,
  'an order already purged is not marked again');
select is(public.fn_mark_evidence_purged('e5000000-0000-4000-8000-0000000b0010'), false,
  'an order with a shipment in dispute is not marked');
select is(public.fn_mark_evidence_purged('e5000000-0000-4000-8000-0000000b0011'), false,
  'an order with a waiting_return dispute is not marked');
select is(public.fn_mark_evidence_purged('e5000000-0000-4000-8000-0000000b0012'), false,
  'an order with a return_delivered dispute is not marked');
select is(public.fn_mark_evidence_purged('e5000000-0000-4000-8000-0000000b0013'), false,
  'an order with an open order-level dispute is not marked');
select is(public.fn_mark_evidence_purged('e5000000-0000-4000-8000-0000000b0015'), false,
  'an order refunded 30 days ago after a completion 200 days ago is not marked');
select is(public.fn_mark_evidence_purged('e5000000-0000-4000-8000-0000000b0017'), false,
  'an order completed 100 days ago with an older updated_at is not marked');

-- Marking: refused while evidence remains.
select is(public.fn_mark_evidence_purged('e5000000-0000-4000-8000-0000000b0001'), false,
  'an order whose evidence objects remain is not marked');

-- What the Storage API remove does for b1 (two of three, then the last one).
reset role;
set local storage.allow_delete_query = 'true';
delete from storage.objects
where bucket_id = 'evidence'
  and name in ('disputes/e5000000-0000-4000-8000-0000000b0001/e5000000-0000-4000-8000-000000000001/defect.jpg',
               'returns/e5000000-0000-4000-8000-0000000b0001/e5000000-0000-4000-8000-000000000001/return.jpg');
set local storage.allow_delete_query = 'false';
set local role service_role;
select is(public.fn_mark_evidence_purged('e5000000-0000-4000-8000-0000000b0001'), false,
  'an order with one evidence object left is not marked');
reset role;
set local storage.allow_delete_query = 'true';
delete from storage.objects
where bucket_id = 'evidence'
  and name = 'shipments/e5000000-0000-4000-8000-0000000b0001/e5000000-0000-4000-8000-000000000002/box.jpg';
set local storage.allow_delete_query = 'false';
set local role service_role;

select is(public.fn_mark_evidence_purged('e5000000-0000-4000-8000-0000000b0001'), true,
  'an order with no evidence left is marked');
select is(public.fn_mark_evidence_purged('e5000000-0000-4000-8000-0000000b0001'), false,
  'a second mark of the same order returns false');
select is(public.fn_mark_evidence_purged('e5000000-0000-4000-8000-0000000b0006'), true,
  'an order that never had evidence is marked');
reset role;

select is(
  (select array_agg(id order by id) from public.orders
   where id::text like 'e5000000-%' and evidence_purged_at is not null),
  array['e5000000-0000-4000-8000-0000000b0001', 'e5000000-0000-4000-8000-0000000b0006',
        'e5000000-0000-4000-8000-0000000b0007']::uuid[],
  'only the marked orders (and the one purged before) carry evidence_purged_at');
select is(
  (select count(*) from storage.objects where bucket_id = 'evidence' and name like '%/e5000000-0000-4000-8000-0000000b000%'),
  5::bigint,
  'the objects of other orders and b1''s non-evidence objects in the evidence bucket are untouched');
select is(
  (select array_agg(bucket_id || ':' || name order by bucket_id, name) from storage.objects
   where name like '%e5000000-0000-4000-8000-0000000b0001'
      or name like '%e5000000-0000-4000-8000-0000000b0001/%'),
  array['evidence:disputes/e5000000-0000-4000-8000-0000000b0001',
        'evidence:other/e5000000-0000-4000-8000-0000000b0001/x.jpg',
        'evidence:xdisputes/e5000000-0000-4000-8000-0000000b0001/x.jpg',
        'verification:disputes/e5000000-0000-4000-8000-0000000b0001/u/x.jpg'],
  'b1 is marked while its objects outside the three evidence folders remain');

set local role service_role;
select results_eq(
  $$select order_id from public.fn_list_evidence_purge_candidates(100)$$,
  $$values ('e5000000-0000-4000-8000-0000000b0016'::uuid), ('e5000000-0000-4000-8000-0000000b0009'::uuid)$$,
  'marked orders leave the candidate list');
reset role;

select * from finish();
rollback;
