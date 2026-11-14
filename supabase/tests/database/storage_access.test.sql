-- Storage bucket limits and storage.objects policies per role.
-- evidence (private): `<disputes|returns|shipments>/<order_id>/<uploader_id>/<file>`.
-- The uploader is the order's buyer or a seller with a shipment in that order
-- (`returns/` is the buyer's, `shipments/` the seller's packing evidence); the
-- uploader and admins read it.
-- products: `<seller_id>/<file>`. Avatars: `<user_id>/avatar.<ext>`.
-- verification: `<product_id>/<file>` (verification_access.test.sql covers the
-- uploads and reads per role; this file covers a first folder that is not a uuid).
-- The policies look up products, orders and shipments by uuid, so the primary
-- key or the shipments order_id index applies.
-- Assertions count only this file's objects (ids starting with f2000000-).
-- Runs against the local database only: `supabase start`, then `bun run test:db`.
begin;
select plan(53);

create function pg_temp.as_user(p_id uuid) returns void language sql as $$
  select set_config('request.jwt.claims',
    jsonb_build_object('sub', p_id, 'role', 'authenticated')::text, true)
$$;

-- Inserts as the current role, the way the Storage API does for an upload.
create function pg_temp.put(p_bucket text, p_name text) returns void language sql as $$
  insert into storage.objects (bucket_id, name, owner, owner_id)
  values (p_bucket, p_name, auth.uid(), auth.uid()::text)
$$;

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change
)
select '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated',
  u.email, '', now(), '{}'::jsonb, jsonb_build_object('username', u.username), now(), now(), '', '', '', ''
from (values
  ('f2000000-0000-4000-8000-000000000001'::uuid, 'sta_buyer@test.local', 'sta_buyer'),
  ('f2000000-0000-4000-8000-000000000002'::uuid, 'sta_seller@test.local', 'sta_seller'),
  ('f2000000-0000-4000-8000-000000000003'::uuid, 'sta_stranger@test.local', 'sta_stranger'),
  ('f2000000-0000-4000-8000-000000000004'::uuid, 'sta_admin@test.local', 'sta_admin')
) as u(id, email, username);
update public.profiles_private set role = 'admin'
where id = 'f2000000-0000-4000-8000-000000000004';

-- Order 1: bought by the buyer, one shipment of the seller.
-- Order 2: bought by the stranger, one shipment of another seller (the admin account).
insert into public.orders (id, buyer_id, total_amount_cents, shipping_address)
values
  ('f2000000-0000-4000-8000-0000000b0001', 'f2000000-0000-4000-8000-000000000001', 100000, '{}'::jsonb),
  ('f2000000-0000-4000-8000-0000000b0002', 'f2000000-0000-4000-8000-000000000003', 100000, '{}'::jsonb);
insert into public.shipments (id, order_id, seller_id, status, stripe_payment_intent_id)
values
  ('f2000000-0000-4000-8000-0000000c0001', 'f2000000-0000-4000-8000-0000000b0001', 'f2000000-0000-4000-8000-000000000002', 'paid', 'pi_test_sta_1'),
  ('f2000000-0000-4000-8000-0000000c0002', 'f2000000-0000-4000-8000-0000000b0002', 'f2000000-0000-4000-8000-000000000004', 'paid', 'pi_test_sta_2');

-- A listing of the seller, with one verification file in its folder and one file
-- whose first folder is not a uuid.
insert into public.products (
  id, name, description, price_cents, category, condition, usage, images,
  specifications, seller_id, shipping_cost_cents, origin_zip, package_preset,
  publication_shipping_reserve_cents, publication_commission_rate, publication_insurance_rate
)
select 'f2000000-0000-4000-8000-0000000d0001', 'sta-listing', 'Test listing', 100000, 'GPU', 'used',
  'gaming', array['https://example.test/p.png'], '{}'::jsonb, 'f2000000-0000-4000-8000-000000000002',
  10000, '06600', 'gpu_1',
  10000::bigint + s.shipping_buffer_cents + ceil(100000::numeric * s.insurance_rate)::bigint,
  s.service_fee_pct, s.insurance_rate
from public.system_settings s where s.id = 1;
insert into storage.objects (bucket_id, name)
values
  ('verification', 'f2000000-0000-4000-8000-0000000d0001/sta-front.jpg'),
  ('verification', 'not-a-uuid/sta-front.jpg');

-- Each user's avatar, stored as the Storage API would.
insert into storage.objects (bucket_id, name, owner, owner_id)
values
  ('Avatars', 'f2000000-0000-4000-8000-000000000001/avatar.jpg', 'f2000000-0000-4000-8000-000000000001', 'f2000000-0000-4000-8000-000000000001'),
  ('Avatars', 'f2000000-0000-4000-8000-000000000003/avatar.jpg', 'f2000000-0000-4000-8000-000000000003', 'f2000000-0000-4000-8000-000000000003');

-- Bucket configuration.
select is(
  (select count(*) from storage.buckets where id = 'public-assets'),
  0::bigint,
  'the unused public-assets bucket does not exist');
select is(
  (select row(public, file_size_limit, allowed_mime_types)::text from storage.buckets where id = 'evidence'),
  row(false, 52428800::bigint, array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif',
    'video/mp4', 'video/quicktime', 'video/x-m4v']::text[])::text,
  'evidence is private, limited to 50 MiB and to photo and video types');
select is(
  (select row(public, file_size_limit, allowed_mime_types)::text from storage.buckets where id = 'products'),
  row(true, 10485760::bigint, array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']::text[])::text,
  'products is public, limited to 10 MiB and to photo types');
select is(
  (select row(public, file_size_limit, allowed_mime_types)::text from storage.buckets where id = 'Avatars'),
  row(true, 2097152::bigint, array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']::text[])::text,
  'Avatars is public, limited to 2 MiB and to photo types');

select is(
  (select string_agg(policyname || ':' || cmd || ':' || roles::text, ', ' order by policyname)
   from pg_policies where schemaname = 'storage' and tablename = 'objects'),
  'Admins can view all avatars:SELECT:{authenticated}, '
  || 'Allow Select Own Files 1ahc6qj_0:SELECT:{authenticated}, '
  || 'Allow Uploads 1ahc6qj_0:INSERT:{authenticated}, '
  || 'Products Visual Access:SELECT:{anon,authenticated}, '
  || 'Users can upload their own avatar h0za56_0:INSERT:{authenticated}, '
  || 'Users can upload their own avatar h0za56_1:UPDATE:{authenticated}, '
  || 'Users can upload their own avatar h0za56_2:SELECT:{authenticated}, '
  || 'evidence_insert_order_participant:INSERT:{authenticated}, '
  || 'evidence_select_uploader_or_admin:SELECT:{authenticated}, '
  || 'evidence_update_order_participant:UPDATE:{authenticated}, '
  || 'products_insert_own_folder:INSERT:{authenticated}',
  'storage.objects has exactly the expected policies');

-- Evidence uploads: the buyer of order 1.
select pg_temp.as_user('f2000000-0000-4000-8000-000000000001');
set local role authenticated;
select lives_ok(
  $$select pg_temp.put('evidence', 'disputes/f2000000-0000-4000-8000-0000000b0001/f2000000-0000-4000-8000-000000000001/defect.jpg')$$,
  'the buyer uploads dispute evidence for their order into their folder');
select lives_ok(
  $$select pg_temp.put('evidence', 'returns/f2000000-0000-4000-8000-0000000b0001/f2000000-0000-4000-8000-000000000001/return.jpg')$$,
  'the buyer uploads return evidence for their order into their folder');
select throws_ok(
  $$select pg_temp.put('evidence', 'shipments/f2000000-0000-4000-8000-0000000b0001/f2000000-0000-4000-8000-000000000001/box.jpg')$$,
  '42501', null, 'the buyer cannot upload packing evidence');
select throws_ok(
  $$select pg_temp.put('evidence', 'disputes/f2000000-0000-4000-8000-0000000b0001/f2000000-0000-4000-8000-000000000002/defect.jpg')$$,
  '42501', null, 'the buyer cannot upload into another user''s folder');
select throws_ok(
  $$select pg_temp.put('evidence', 'disputes/f2000000-0000-4000-8000-0000000b0002/f2000000-0000-4000-8000-000000000001/defect.jpg')$$,
  '42501', null, 'the buyer cannot upload for an order they are not part of');
select throws_ok(
  $$select pg_temp.put('evidence', 'disputes/not-a-uuid/f2000000-0000-4000-8000-000000000001/defect.jpg')$$,
  '42501', null, 'an order segment that is not a uuid is denied by the policy');
select throws_ok(
  $$select pg_temp.put('evidence', 'disputes/F2000000-0000-4000-8000-0000000B0001/f2000000-0000-4000-8000-000000000001/defect.jpg')$$,
  '42501', null, 'the evidence order segment matches only the lowercase order id');
select throws_ok(
  $$select pg_temp.put('evidence', 'other/f2000000-0000-4000-8000-0000000b0001/f2000000-0000-4000-8000-000000000001/defect.jpg')$$,
  '42501', null, 'an unknown top folder is denied');
select throws_ok(
  $$select pg_temp.put('evidence', 'disputes/f2000000-0000-4000-8000-0000000b0001/defect.jpg')$$,
  '42501', null, 'a path without the uploader folder is denied');

-- The seller of the shipment in order 1.
select pg_temp.as_user('f2000000-0000-4000-8000-000000000002');
select lives_ok(
  $$select pg_temp.put('evidence', 'disputes/f2000000-0000-4000-8000-0000000b0001/f2000000-0000-4000-8000-000000000002/reply.jpg')$$,
  'the seller uploads dispute evidence for an order they ship into their folder');
select lives_ok(
  $$select pg_temp.put('evidence', 'shipments/f2000000-0000-4000-8000-0000000b0001/f2000000-0000-4000-8000-000000000002/box.jpg')$$,
  'the seller uploads packing evidence for an order they ship');
select throws_ok(
  $$select pg_temp.put('evidence', 'returns/f2000000-0000-4000-8000-0000000b0001/f2000000-0000-4000-8000-000000000002/x.jpg')$$,
  '42501', null, 'the seller cannot upload return evidence, even for an order they ship');
select throws_ok(
  $$select pg_temp.put('evidence', 'disputes/f2000000-0000-4000-8000-0000000b0002/f2000000-0000-4000-8000-000000000002/reply.jpg')$$,
  '42501', null, 'the seller cannot upload for an order they do not ship');
select throws_ok(
  $$select pg_temp.put('verification', 'F2000000-0000-4000-8000-0000000D0001/sta-upper.jpg')$$,
  '42501', null, 'the verification folder matches only the lowercase product id of the owner''s listing');

-- A user with no part in order 1.
select pg_temp.as_user('f2000000-0000-4000-8000-000000000003');
select throws_ok(
  $$select pg_temp.put('evidence', 'disputes/f2000000-0000-4000-8000-0000000b0001/f2000000-0000-4000-8000-000000000003/defect.jpg')$$,
  '42501', null, 'a stranger cannot upload evidence for the order');
reset role;

select set_config('request.jwt.claims', '{"role": "anon"}', true);
set local role anon;
select throws_ok(
  $$insert into storage.objects (bucket_id, name)
    values ('evidence', 'disputes/f2000000-0000-4000-8000-0000000b0001/f2000000-0000-4000-8000-000000000001/anon.jpg')$$,
  '42501', null, 'anon cannot upload evidence');
reset role;

select is(
  (select string_agg(name, ', ' order by name) from storage.objects where bucket_id = 'evidence' and name like '%/f2000000-%'),
  'disputes/f2000000-0000-4000-8000-0000000b0001/f2000000-0000-4000-8000-000000000001/defect.jpg, '
  || 'disputes/f2000000-0000-4000-8000-0000000b0001/f2000000-0000-4000-8000-000000000002/reply.jpg, '
  || 'returns/f2000000-0000-4000-8000-0000000b0001/f2000000-0000-4000-8000-000000000001/return.jpg, '
  || 'shipments/f2000000-0000-4000-8000-0000000b0001/f2000000-0000-4000-8000-000000000002/box.jpg',
  'only the allowed evidence uploads are stored');

-- Evidence reads.
select pg_temp.as_user('f2000000-0000-4000-8000-000000000001');
set local role authenticated;
select is(
  (select string_agg(name, ', ' order by name) from storage.objects where bucket_id = 'evidence' and name like '%/f2000000-%'),
  'disputes/f2000000-0000-4000-8000-0000000b0001/f2000000-0000-4000-8000-000000000001/defect.jpg, '
  || 'returns/f2000000-0000-4000-8000-0000000b0001/f2000000-0000-4000-8000-000000000001/return.jpg',
  'the buyer reads only the evidence they uploaded');
select pg_temp.as_user('f2000000-0000-4000-8000-000000000002');
select is(
  (select string_agg(name, ', ' order by name) from storage.objects where bucket_id = 'evidence' and name like '%/f2000000-%'),
  'disputes/f2000000-0000-4000-8000-0000000b0001/f2000000-0000-4000-8000-000000000002/reply.jpg, '
  || 'shipments/f2000000-0000-4000-8000-0000000b0001/f2000000-0000-4000-8000-000000000002/box.jpg',
  'the seller reads only the evidence they uploaded, not the buyer''s');
select pg_temp.as_user('f2000000-0000-4000-8000-000000000003');
select is((select count(*) from storage.objects where bucket_id = 'evidence' and name like '%/f2000000-%'), 0::bigint,
  'a stranger reads no evidence');
select pg_temp.as_user('f2000000-0000-4000-8000-000000000004');
select is((select count(*) from storage.objects where bucket_id = 'evidence' and name like '%/f2000000-%'), 4::bigint,
  'an admin reads all evidence');
reset role;
select set_config('request.jwt.claims', '{"role": "anon"}', true);
set local role anon;
select is((select count(*) from storage.objects where bucket_id = 'evidence' and name like '%/f2000000-%'), 0::bigint,
  'anon reads no evidence');
reset role;

-- Evidence overwrite (the app uploads with upsert): only the uploader, inside the same rule.
select pg_temp.as_user('f2000000-0000-4000-8000-000000000001');
set local role authenticated;
select lives_ok(
  $$update storage.objects set metadata = '{"v": 2}'::jsonb
    where bucket_id = 'evidence'
      and name = 'disputes/f2000000-0000-4000-8000-0000000b0001/f2000000-0000-4000-8000-000000000001/defect.jpg'$$,
  'the buyer overwrites their own evidence');
select throws_ok(
  $$update storage.objects
    set name = 'disputes/f2000000-0000-4000-8000-0000000b0001/f2000000-0000-4000-8000-000000000002/moved.jpg'
    where bucket_id = 'evidence'
      and name = 'returns/f2000000-0000-4000-8000-0000000b0001/f2000000-0000-4000-8000-000000000001/return.jpg'$$,
  '42501', null, 'the buyer cannot move their evidence into another user''s folder');
select throws_ok(
  $$update storage.objects
    set name = 'disputes/not-a-uuid/f2000000-0000-4000-8000-000000000001/moved.jpg'
    where bucket_id = 'evidence'
      and name = 'returns/f2000000-0000-4000-8000-0000000b0001/f2000000-0000-4000-8000-000000000001/return.jpg'$$,
  '42501', null, 'moving evidence to an order segment that is not a uuid is denied by the policy');
select pg_temp.as_user('f2000000-0000-4000-8000-000000000002');
select lives_ok(
  $$update storage.objects set metadata = '{"v": 3}'::jsonb
    where bucket_id = 'evidence'
      and name = 'disputes/f2000000-0000-4000-8000-0000000b0001/f2000000-0000-4000-8000-000000000001/defect.jpg'$$,
  'the seller''s update of the buyer''s evidence runs');
reset role;
select is(
  (select metadata from storage.objects where bucket_id = 'evidence'
     and name = 'disputes/f2000000-0000-4000-8000-0000000b0001/f2000000-0000-4000-8000-000000000001/defect.jpg'),
  '{"v": 2}'::jsonb,
  'the uploader''s overwrite is stored and the seller''s update changed nothing');
select is(
  (select count(*) from storage.objects where bucket_id = 'evidence'
     and name = 'returns/f2000000-0000-4000-8000-0000000b0001/f2000000-0000-4000-8000-000000000001/return.jpg'),
  1::bigint,
  'the evidence the buyer tried to move is still in place');

-- Clients do not delete evidence. The Storage API deletes with this setting on.
set local storage.allow_delete_query = 'true';
select pg_temp.as_user('f2000000-0000-4000-8000-000000000001');
set local role authenticated;
select lives_ok(
  $$delete from storage.objects where bucket_id = 'evidence' and name like '%/f2000000-%'$$,
  'the buyer''s delete of their evidence runs');
reset role;
set local storage.allow_delete_query = 'false';
select is((select count(*) from storage.objects where bucket_id = 'evidence' and name like '%/f2000000-%'), 4::bigint,
  'the buyer''s delete removed no evidence');

-- Product photos: the seller uploads into their own folder only.
select pg_temp.as_user('f2000000-0000-4000-8000-000000000002');
set local role authenticated;
select lives_ok(
  $$select pg_temp.put('products', 'f2000000-0000-4000-8000-000000000002/photo.jpg')$$,
  'a seller uploads a product photo into their folder');
select throws_ok(
  $$select pg_temp.put('products', 'f2000000-0000-4000-8000-000000000001/photo.jpg')$$,
  '42501', null, 'a seller cannot upload a product photo into another user''s folder');
select throws_ok(
  $$select pg_temp.put('products', 'photo.jpg')$$,
  '42501', null, 'a product photo outside any folder is denied');
reset role;
select set_config('request.jwt.claims', '{"role": "anon"}', true);
set local role anon;
select throws_ok(
  $$insert into storage.objects (bucket_id, name) values ('products', 'f2000000-0000-4000-8000-000000000002/anon.jpg')$$,
  '42501', null, 'anon cannot upload a product photo');
reset role;
select is(
  (select string_agg(name, ', ' order by name) from storage.objects where bucket_id = 'products'
     and name like 'f2000000-%'),
  'f2000000-0000-4000-8000-000000000002/photo.jpg',
  'only the seller''s own product photo is stored');
select pg_temp.as_user('f2000000-0000-4000-8000-000000000003');
set local role authenticated;
select is(
  (select count(*) from storage.objects where bucket_id = 'products' and name like 'f2000000-%'),
  1::bigint,
  'product photos stay readable');
reset role;

-- Verification files: the listing's seller reads its folder; a first folder that
-- is not a uuid matches no listing and reads as nothing, without an error.
select pg_temp.as_user('f2000000-0000-4000-8000-000000000002');
set local role authenticated;
select is(
  (select string_agg(name, ', ' order by name) from storage.objects where bucket_id = 'verification'
     and name like '%sta-front.jpg'),
  'f2000000-0000-4000-8000-0000000d0001/sta-front.jpg',
  'the seller reads their listing''s verification file and not the file outside a listing folder');
reset role;

-- Avatars: users read their own object row; the files stay public through the bucket.
select pg_temp.as_user('f2000000-0000-4000-8000-000000000001');
set local role authenticated;
select is(
  (select string_agg(name, ', ' order by name) from storage.objects where bucket_id = 'Avatars'
     and name like 'f2000000-%'),
  'f2000000-0000-4000-8000-000000000001/avatar.jpg',
  'a user reads only their own avatar row');
select lives_ok(
  $$update storage.objects set metadata = '{"v": 2}'::jsonb
    where bucket_id = 'Avatars' and name = 'f2000000-0000-4000-8000-000000000001/avatar.jpg'$$,
  'a user overwrites their own avatar');
select lives_ok(
  $$update storage.objects set metadata = '{"v": 9}'::jsonb
    where bucket_id = 'Avatars' and name = 'f2000000-0000-4000-8000-000000000003/avatar.jpg'$$,
  'a user''s update of another avatar runs');
select throws_ok(
  $$select pg_temp.put('Avatars', 'f2000000-0000-4000-8000-000000000003/avatar.png')$$,
  '42501', null, 'a user cannot upload into another user''s avatar folder');
select pg_temp.as_user('f2000000-0000-4000-8000-000000000004');
select is(
  (select count(*) from storage.objects where bucket_id = 'Avatars' and name like 'f2000000-%'),
  2::bigint,
  'an admin reads every avatar row');
reset role;
select is(
  (select string_agg(name || '=' || coalesce(metadata::text, 'null'), ', ' order by name)
   from storage.objects where bucket_id = 'Avatars' and name like 'f2000000-%'),
  'f2000000-0000-4000-8000-000000000001/avatar.jpg={"v": 2}, f2000000-0000-4000-8000-000000000003/avatar.jpg=null',
  'only the owner''s avatar overwrite is stored');

-- Index use. The plan of a policy's check, evaluated for one object path, finds
-- the folder's row through the primary key of products or orders, or the
-- shipments order_id index. The owner-column indexes are dropped (rolled back
-- with the file) so the folder's row is the only indexed way in.
create function pg_temp.policy_plan(p_policy text, p_bucket text, p_name text)
returns text language plpgsql as $$
declare
  v_check text;
  v_line text;
  v_plan text := '';
begin
  select coalesce(with_check, qual) into strict v_check from pg_policies
  where schemaname = 'storage' and tablename = 'objects' and policyname = p_policy;
  for v_line in execute format(
    'explain (costs off) select 1 from (values (%L::text, %L::text)) as objects(bucket_id, name) where %s',
    p_bucket, p_name, v_check)
  loop
    v_plan := v_plan || v_line || E'\n';
  end loop;
  return v_plan;
end
$$;

drop index public.ix_products_seller_id;
drop index public.ix_orders_buyer_id;
drop index public.idx_shipments_seller_id;
set local enable_seqscan = off;
select matches(
  pg_temp.policy_plan('Allow Select Own Files 1ahc6qj_0', 'verification',
    'f2000000-0000-4000-8000-0000000d0001/x.jpg'),
  'products_pkey[^\n]*\n\s+Index Cond: \(id = ',
  'the verification read policy finds the listing through the products primary key');
select matches(
  pg_temp.policy_plan('Allow Uploads 1ahc6qj_0', 'verification',
    'f2000000-0000-4000-8000-0000000d0001/x.jpg'),
  'products_pkey[^\n]*\n\s+Index Cond: \(id = ',
  'the verification upload policy finds the listing through the products primary key');
select matches(
  pg_temp.policy_plan('evidence_insert_order_participant', 'evidence',
    'disputes/f2000000-0000-4000-8000-0000000b0001/f2000000-0000-4000-8000-000000000001/x.jpg'),
  'orders_pkey[^\n]*\n\s+Index Cond: \(id = .*idx_shipments_order_id[^\n]*\n\s+Index Cond: \(order_id = ',
  'the evidence upload policy finds the order through its primary key and the shipments order_id index');
select matches(
  pg_temp.policy_plan('evidence_update_order_participant', 'evidence',
    'disputes/f2000000-0000-4000-8000-0000000b0001/f2000000-0000-4000-8000-000000000001/x.jpg'),
  'orders_pkey[^\n]*\n\s+Index Cond: \(id = .*idx_shipments_order_id[^\n]*\n\s+Index Cond: \(order_id = ',
  'the evidence overwrite policy finds the order through its primary key and the shipments order_id index');
-- The planner folds a folder known at plan time to a constant; one that is not a
-- uuid still plans without an error (22P02).
select lives_ok(
  $$select pg_temp.policy_plan('Allow Uploads 1ahc6qj_0', 'verification', 'not-a-uuid/x.jpg'),
      pg_temp.policy_plan('evidence_insert_order_participant', 'evidence',
        'disputes/not-a-uuid/f2000000-0000-4000-8000-000000000001/x.jpg')$$,
  'a folder that is not a uuid plans without an error');
reset enable_seqscan;

select * from finish();
rollback;
