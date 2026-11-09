-- The return evidence RPCs store only object paths of the caller's own uploads
-- for the dispute's order in the evidence bucket:
-- `disputes/<order_id>/<seller_id>/<file>` for fn_seller_submit_return_evidence and
-- `returns/<order_id>/<buyer_id>/<file>` for fn_buyer_submit_return_evidence.
-- Any other value returns INVALID_EVIDENCE_PATH and leaves the dispute unchanged.
-- Runs against the local database only: `supabase start`, then `bun run test:db`.
begin;
select plan(35);

create function pg_temp.as_user(p_id uuid) returns void language sql as $$
  select set_config('request.jwt.claims',
    jsonb_build_object('sub', p_id, 'role', 'authenticated')::text, true)
$$;

-- What a submission may change: the status and both evidence columns.
create function pg_temp.dispute_state(p_id uuid) returns text language sql as $$
  select status::text || ' ' || seller_evidence::text || ' ' || buyer_evidence::text
  from public.disputes where id = p_id
$$;

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change
)
select '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated',
  u.email, '', now(), '{}'::jsonb, jsonb_build_object('username', u.username), now(), now(), '', '', '', ''
from (values
  ('f3000000-0000-4000-8000-000000000001'::uuid, 'evp_buyer@test.local', 'evp_buyer'),
  ('f3000000-0000-4000-8000-000000000002'::uuid, 'evp_seller@test.local', 'evp_seller')
) as u(id, email, username);

-- Two orders of the buyer, each with one shipment of the seller and one dispute:
-- dispute 1 waits for the seller's evidence, dispute 2 for the buyer's.
insert into public.orders (id, buyer_id, total_amount, shipping_address)
values
  ('f3000000-0000-4000-8000-0000000b0001', 'f3000000-0000-4000-8000-000000000001', 1000, '{}'::jsonb),
  ('f3000000-0000-4000-8000-0000000b0002', 'f3000000-0000-4000-8000-000000000001', 1000, '{}'::jsonb);
insert into public.shipments (id, order_id, seller_id, status, stripe_payment_intent_id)
values
  ('f3000000-0000-4000-8000-0000000c0001', 'f3000000-0000-4000-8000-0000000b0001', 'f3000000-0000-4000-8000-000000000002', 'delivered', 'pi_test_evp_1'),
  ('f3000000-0000-4000-8000-0000000c0002', 'f3000000-0000-4000-8000-0000000b0002', 'f3000000-0000-4000-8000-000000000002', 'delivered', 'pi_test_evp_2');
select set_config('request.jwt.claims', '{"role": "service_role"}', true);
insert into public.disputes (id, order_id, buyer_id, seller_id, reason, description, shipment_id)
values
  ('f3000000-0000-4000-8000-0000000d0001', 'f3000000-0000-4000-8000-0000000b0001',
   'f3000000-0000-4000-8000-000000000001', 'f3000000-0000-4000-8000-000000000002',
   'damaged', 'Buyer dispute', 'f3000000-0000-4000-8000-0000000c0001'),
  ('f3000000-0000-4000-8000-0000000d0002', 'f3000000-0000-4000-8000-0000000b0002',
   'f3000000-0000-4000-8000-000000000001', 'f3000000-0000-4000-8000-000000000002',
   'damaged', 'Buyer dispute', 'f3000000-0000-4000-8000-0000000c0002');
update public.disputes set status = 'return_delivered' where id = 'f3000000-0000-4000-8000-0000000d0001';
update public.disputes set status = 'waiting_return' where id = 'f3000000-0000-4000-8000-0000000d0002';

-- fn_seller_submit_return_evidence, as the dispute's seller.
select pg_temp.as_user('f3000000-0000-4000-8000-000000000002');
set local role authenticated;
select is(
  (select row(success, error_message)::text from public.fn_seller_submit_return_evidence(
    'f3000000-0000-4000-8000-0000000d0001',
    array['disputes/f3000000-0000-4000-8000-0000000b0001/f3000000-0000-4000-8000-000000000001/a.jpg'],
    'disputes/f3000000-0000-4000-8000-0000000b0001/f3000000-0000-4000-8000-000000000002/v.mp4')),
  '(f,INVALID_EVIDENCE_PATH)', 'the seller cannot submit an image from another user''s folder');
select is(pg_temp.dispute_state('f3000000-0000-4000-8000-0000000d0001'),
  'return_delivered {"images": [], "video_url": null} {"images": [], "video_url": null, "tech_checklist": {}}',
  'a rejected image from another user''s folder leaves the dispute unchanged');
select is(
  (select row(success, error_message)::text from public.fn_seller_submit_return_evidence(
    'f3000000-0000-4000-8000-0000000d0001',
    array['disputes/f3000000-0000-4000-8000-0000000b0002/f3000000-0000-4000-8000-000000000002/a.jpg'],
    'disputes/f3000000-0000-4000-8000-0000000b0001/f3000000-0000-4000-8000-000000000002/v.mp4')),
  '(f,INVALID_EVIDENCE_PATH)', 'the seller cannot submit an image from another order');
select is(pg_temp.dispute_state('f3000000-0000-4000-8000-0000000d0001'),
  'return_delivered {"images": [], "video_url": null} {"images": [], "video_url": null, "tech_checklist": {}}',
  'a rejected image from another order leaves the dispute unchanged');
select is(
  (select row(success, error_message)::text from public.fn_seller_submit_return_evidence(
    'f3000000-0000-4000-8000-0000000d0001',
    array['https://example.test/disputes/f3000000-0000-4000-8000-0000000b0001/f3000000-0000-4000-8000-000000000002/a.jpg'],
    'disputes/f3000000-0000-4000-8000-0000000b0001/f3000000-0000-4000-8000-000000000002/v.mp4')),
  '(f,INVALID_EVIDENCE_PATH)', 'the seller cannot submit a full URL');
select is(pg_temp.dispute_state('f3000000-0000-4000-8000-0000000d0001'),
  'return_delivered {"images": [], "video_url": null} {"images": [], "video_url": null, "tech_checklist": {}}',
  'a rejected full URL leaves the dispute unchanged');
select is(
  (select row(success, error_message)::text from public.fn_seller_submit_return_evidence(
    'f3000000-0000-4000-8000-0000000d0001',
    array['disputes/f3000000-0000-4000-8000-0000000b0001/f3000000-0000-4000-8000-000000000002/../f3000000-0000-4000-8000-000000000001/a.jpg'],
    'disputes/f3000000-0000-4000-8000-0000000b0001/f3000000-0000-4000-8000-000000000002/v.mp4')),
  '(f,INVALID_EVIDENCE_PATH)', 'the seller cannot submit a path with a .. segment');
select is(pg_temp.dispute_state('f3000000-0000-4000-8000-0000000d0001'),
  'return_delivered {"images": [], "video_url": null} {"images": [], "video_url": null, "tech_checklist": {}}',
  'a rejected .. segment leaves the dispute unchanged');
select is(
  (select row(success, error_message)::text from public.fn_seller_submit_return_evidence(
    'f3000000-0000-4000-8000-0000000d0001',
    array['/disputes/f3000000-0000-4000-8000-0000000b0001/f3000000-0000-4000-8000-000000000002/a.jpg'],
    'disputes/f3000000-0000-4000-8000-0000000b0001/f3000000-0000-4000-8000-000000000002/v.mp4')),
  '(f,INVALID_EVIDENCE_PATH)', 'the seller cannot submit a path with a leading slash');
select is(pg_temp.dispute_state('f3000000-0000-4000-8000-0000000d0001'),
  'return_delivered {"images": [], "video_url": null} {"images": [], "video_url": null, "tech_checklist": {}}',
  'a rejected leading slash leaves the dispute unchanged');
select is(
  (select row(success, error_message)::text from public.fn_seller_submit_return_evidence(
    'f3000000-0000-4000-8000-0000000d0001',
    array['disputes/f3000000-0000-4000-8000-0000000b0001/f3000000-0000-4000-8000-000000000002/a.jpg'],
    'https://example.test/v.mp4')),
  '(f,INVALID_EVIDENCE_PATH)', 'the seller cannot submit a video outside their folder');
select is(pg_temp.dispute_state('f3000000-0000-4000-8000-0000000d0001'),
  'return_delivered {"images": [], "video_url": null} {"images": [], "video_url": null, "tech_checklist": {}}',
  'a rejected video leaves the dispute unchanged');
-- Malformed paths inside the seller's own folder are rejected too.
select is(
  (select row(success, error_message)::text from public.fn_seller_submit_return_evidence(
    'f3000000-0000-4000-8000-0000000d0001', array[c.p],
    'disputes/f3000000-0000-4000-8000-0000000b0001/f3000000-0000-4000-8000-000000000002/v.mp4')),
  '(f,INVALID_EVIDENCE_PATH)', 'the seller cannot submit a path with ' || c.label)
from (values
  ('an encoded traversal', 'disputes/f3000000-0000-4000-8000-0000000b0001/f3000000-0000-4000-8000-000000000002/%2e%2e%2fa.jpg'),
  ('a backslash', 'disputes/f3000000-0000-4000-8000-0000000b0001/f3000000-0000-4000-8000-000000000002/..' || chr(92) || 'a.jpg'),
  ('a double slash', 'disputes/f3000000-0000-4000-8000-0000000b0001/f3000000-0000-4000-8000-000000000002//a.jpg'),
  ('an empty file name', 'disputes/f3000000-0000-4000-8000-0000000b0001/f3000000-0000-4000-8000-000000000002/'),
  ('a 201-character file name', 'disputes/f3000000-0000-4000-8000-0000000b0001/f3000000-0000-4000-8000-000000000002/' || repeat('a', 201)),
  ('a capitalized folder', 'Disputes/f3000000-0000-4000-8000-0000000b0001/f3000000-0000-4000-8000-000000000002/a.jpg'),
  ('an extra segment', 'disputes/f3000000-0000-4000-8000-0000000b0001/f3000000-0000-4000-8000-000000000002/x/a.jpg'),
  ('a trailing newline', 'disputes/f3000000-0000-4000-8000-0000000b0001/f3000000-0000-4000-8000-000000000002/a.jpg' || chr(10))
) as c(label, p);
select is(pg_temp.dispute_state('f3000000-0000-4000-8000-0000000d0001'),
  'return_delivered {"images": [], "video_url": null} {"images": [], "video_url": null, "tech_checklist": {}}',
  'rejected malformed paths leave the dispute unchanged');
select is(
  (select row(success, error_message)::text from public.fn_seller_submit_return_evidence(
    'f3000000-0000-4000-8000-0000000d0001',
    array['disputes/f3000000-0000-4000-8000-0000000b0001/f3000000-0000-4000-8000-000000000002/a.jpg',
          'disputes/f3000000-0000-4000-8000-0000000b0001/f3000000-0000-4000-8000-000000000002/b.jpg'],
    'disputes/f3000000-0000-4000-8000-0000000b0001/f3000000-0000-4000-8000-000000000002/v.mp4')),
  '(t,)', 'the seller submits images and a video from their own folder for the order');
reset role;
select is(
  (select status::text || ' ' || (seller_evidence->'images')::text || ' ' || (seller_evidence->>'video_url')
   from public.disputes where id = 'f3000000-0000-4000-8000-0000000d0001'),
  'open ["disputes/f3000000-0000-4000-8000-0000000b0001/f3000000-0000-4000-8000-000000000002/a.jpg", '
  || '"disputes/f3000000-0000-4000-8000-0000000b0001/f3000000-0000-4000-8000-000000000002/b.jpg"] '
  || 'disputes/f3000000-0000-4000-8000-0000000b0001/f3000000-0000-4000-8000-000000000002/v.mp4',
  'the seller''s paths are stored and the dispute is open again');

-- fn_buyer_submit_return_evidence: server only; the caller identity is the `sub` claim.
select pg_temp.as_user('f3000000-0000-4000-8000-000000000001');
set local role authenticated;
select throws_ok(
  $$select * from public.fn_buyer_submit_return_evidence('f3000000-0000-4000-8000-0000000d0002',
    array['returns/f3000000-0000-4000-8000-0000000b0002/f3000000-0000-4000-8000-000000000001/a.jpg'])$$,
  '42501', null, 'authenticated cannot call fn_buyer_submit_return_evidence');
reset role;
select is(pg_temp.dispute_state('f3000000-0000-4000-8000-0000000d0002'),
  'waiting_return {"images": [], "video_url": null} {"images": [], "video_url": null, "tech_checklist": {}}',
  'the denied call leaves the dispute unchanged');

select set_config('request.jwt.claims',
  '{"sub": "f3000000-0000-4000-8000-000000000001", "role": "service_role"}', true);
set local role service_role;
select is(
  (select row(success, error_message)::text from public.fn_buyer_submit_return_evidence(
    'f3000000-0000-4000-8000-0000000d0002',
    array['returns/f3000000-0000-4000-8000-0000000b0002/f3000000-0000-4000-8000-000000000002/a.jpg'])),
  '(f,INVALID_EVIDENCE_PATH)', 'the buyer cannot submit an image from another user''s folder');
select is(pg_temp.dispute_state('f3000000-0000-4000-8000-0000000d0002'),
  'waiting_return {"images": [], "video_url": null} {"images": [], "video_url": null, "tech_checklist": {}}',
  'a rejected image from another user''s folder leaves the dispute unchanged');
select is(
  (select row(success, error_message)::text from public.fn_buyer_submit_return_evidence(
    'f3000000-0000-4000-8000-0000000d0002',
    array['returns/f3000000-0000-4000-8000-0000000b0001/f3000000-0000-4000-8000-000000000001/a.jpg'])),
  '(f,INVALID_EVIDENCE_PATH)', 'the buyer cannot submit an image from another order');
select is(
  (select row(success, error_message)::text from public.fn_buyer_submit_return_evidence(
    'f3000000-0000-4000-8000-0000000d0002',
    array['https://example.test/returns/f3000000-0000-4000-8000-0000000b0002/f3000000-0000-4000-8000-000000000001/a.jpg'])),
  '(f,INVALID_EVIDENCE_PATH)', 'the buyer cannot submit a full URL');
select is(
  (select row(success, error_message)::text from public.fn_buyer_submit_return_evidence(
    'f3000000-0000-4000-8000-0000000d0002',
    array['returns/f3000000-0000-4000-8000-0000000b0002/f3000000-0000-4000-8000-000000000001/a.jpg',
          'disputes/f3000000-0000-4000-8000-0000000b0002/f3000000-0000-4000-8000-000000000001/b.jpg'])),
  '(f,INVALID_EVIDENCE_PATH)', 'one image outside the returns folder rejects the whole submission');
reset role;
select is(pg_temp.dispute_state('f3000000-0000-4000-8000-0000000d0002'),
  'waiting_return {"images": [], "video_url": null} {"images": [], "video_url": null, "tech_checklist": {}}',
  'the rejected buyer submissions leave the dispute unchanged');

select set_config('request.jwt.claims', '{"role": "service_role"}', true);
set local role service_role;
select is(
  (select row(success, error_message)::text from public.fn_buyer_submit_return_evidence(
    'f3000000-0000-4000-8000-0000000d0002',
    array['returns/f3000000-0000-4000-8000-0000000b0002/f3000000-0000-4000-8000-000000000001/a.jpg'])),
  '(f,UNAUTHORIZED)', 'a call without a caller identity is refused');
reset role;
select is(pg_temp.dispute_state('f3000000-0000-4000-8000-0000000d0002'),
  'waiting_return {"images": [], "video_url": null} {"images": [], "video_url": null, "tech_checklist": {}}',
  'the refused call leaves the dispute unchanged');

select set_config('request.jwt.claims',
  '{"sub": "f3000000-0000-4000-8000-000000000001", "role": "service_role"}', true);
set local role service_role;
select is(
  (select row(success, error_message)::text from public.fn_buyer_submit_return_evidence(
    'f3000000-0000-4000-8000-0000000d0002',
    array['returns/f3000000-0000-4000-8000-0000000b0002/f3000000-0000-4000-8000-000000000001/a.jpg'])),
  '(t,)', 'the buyer submits an image from their own returns folder for the order');
reset role;
select is(
  (select buyer_evidence->'return_images' from public.disputes where id = 'f3000000-0000-4000-8000-0000000d0002'),
  '["returns/f3000000-0000-4000-8000-0000000b0002/f3000000-0000-4000-8000-000000000001/a.jpg"]'::jsonb,
  'the buyer''s path is stored');

select * from finish();
rollback;
