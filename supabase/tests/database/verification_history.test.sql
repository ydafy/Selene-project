-- Verification history (odd/tasks/verification-history.md S1-S5, S9): one
-- product_verifications row per submission with its evidence rows. The seller
-- submits only through fn_submit_product_verification; the admin lock and the
-- decision live on the open attempt; a decided attempt never changes. Owners
-- read their own attempts and evidence, admins read all, nobody writes
-- through the client. Runs against the local database only: `supabase start`,
-- then `bun run test:db`.
begin;
select plan(98);

\ir ../fixtures/money.psql

-- Users: 79001 seller A, 79002 seller B, 79003 stranger, 79004 admin,
-- 79005 suspended seller, 79006 second admin.
select pg_temp.money_user(79001);
select pg_temp.money_user(79002);
select pg_temp.money_user(79003);
select pg_temp.money_user(79004, 'admin');
select pg_temp.money_user(79005);
select pg_temp.money_user(79006, 'admin');
update public.profiles_private set status = 'suspended' where id = pg_temp.mu(79005);

-- A listing of p_seller in p_status; p_deleted soft-deletes it, p_hold sets
-- status_before_account_hold.
create function pg_temp.listing(
  p_n integer, p_seller integer, p_status text,
  p_deleted boolean default false, p_hold text default null
) returns uuid language sql as $$
  insert into public.products (
    id, name, description, price_cents, category, condition, usage, images, status,
    specifications, seller_id, shipping_cost_cents, origin_zip, package_preset, deleted_at,
    status_before_account_hold,
    publication_shipping_reserve_cents, publication_commission_rate,
    publication_insurance_rate
  )
  select pg_temp.mu(p_n), 'vh-' || p_n, 'Test listing', 100000, 'GPU', 'used', 'gaming',
    array['https://example.test/p.png'], p_status::public.product_status,
    '{}'::jsonb, pg_temp.mu(p_seller), 10000, '06600', 'gpu_1',
    case when p_deleted then now() end,
    p_hold::public.product_status,
    10000::bigint + s.shipping_buffer_cents
      + ceil(100000::numeric * s.insurance_rate)::bigint,
    s.service_fee_pct,
    s.insurance_rate
  from public.system_settings s where s.id = 1
  returning id
$$;

-- '<listing id>/<file>', the verification bucket path of a listing's file.
create function pg_temp.path(p_n integer, p_file text) returns text language sql as $$
  select pg_temp.mu(p_n)::text || '/' || p_file
$$;
create function pg_temp.store(p_n integer, p_file text, p_bucket text default 'verification')
returns void language sql as $$
  insert into storage.objects (bucket_id, name) values (p_bucket, pg_temp.path(p_n, p_file))
$$;
create function pg_temp.as_user(p_n integer) returns void language sql as $$
  select set_config('request.jwt.claims',
    jsonb_build_object('sub', pg_temp.mu(p_n), 'role', 'authenticated')::text, true)
$$;
-- Attempts of a listing as decision (or 'open') in submission order, and the
-- evidence of one attempt as kind:file.
create function pg_temp.attempts(p_n integer) returns text language sql as $$
  select coalesce(string_agg(coalesce(v.decision::text, 'open'), ',' order by v.submitted_at), '')
  from public.product_verifications v where v.product_id = pg_temp.mu(p_n)
$$;
create function pg_temp.evidence(p_verification uuid) returns text language sql as $$
  select coalesce(string_agg(e.kind::text || ':' || split_part(e.storage_path, '/', 2), ','
    order by e.kind, e.storage_path), '')
  from public.product_verification_evidence e where e.verification_id = p_verification
$$;
create function pg_temp.open_id(p_n integer) returns uuid language sql as $$
  select v.id from public.product_verifications v
  where v.product_id = pg_temp.mu(p_n) and v.decision is null
$$;
-- Everything a submission writes for the given listings: status, attempts and evidence rows.
create function pg_temp.sub_sig(p_ns integer[]) returns text language sql as $$
  select string_agg(n || '=' || (select status::text from public.products where id = pg_temp.mu(n))
    || '|' || pg_temp.attempts(n) || '|' || (
      select count(*) from public.product_verification_evidence e
      join public.product_verifications v on v.id = e.verification_id
      where v.product_id = pg_temp.mu(n)), ' ' order by n)
  from unnest(p_ns) as n
$$;

-- Constraints -----------------------------------------------------------------
select pg_temp.listing(79120, 79001, 'in_review');
insert into public.admin_user_notes (id, user_id, admin_id, content)
values (pg_temp.mu(79190), pg_temp.mu(79001), pg_temp.mu(79004), 'Constraint note');
insert into public.product_verifications (id, product_id, submitted_by)
values (pg_temp.mu(79121), pg_temp.mu(79120), pg_temp.mu(79001));

select throws_ok(
  format($$insert into public.product_verifications (product_id, submitted_by) values (%L, %L)$$,
    pg_temp.mu(79120), pg_temp.mu(79001)),
  '23505', null, 'a listing has at most one open attempt');
select throws_ok(
  format($$insert into public.product_verifications (product_id, submitted_by, decision, decided_at)
    values (%L, %L, 'approved', now())$$, pg_temp.mu(79120), pg_temp.mu(79001)),
  '23514', null, 'a decision without decided_by is rejected');
select throws_ok(
  format($$insert into public.product_verifications (product_id, submitted_by, decided_by, decided_at)
    values (%L, %L, %L, now())$$, pg_temp.mu(79120), pg_temp.mu(79001), pg_temp.mu(79004)),
  '23514', null, 'decided_by and decided_at without a decision are rejected');
select throws_ok(
  format($$insert into public.product_verifications (product_id, submitted_by, decision, decided_by, decided_at)
    values (%L, %L, 'rejected', %L, now())$$, pg_temp.mu(79120), pg_temp.mu(79001), pg_temp.mu(79004)),
  '23514', null, 'a rejection without a public note is rejected');
select throws_ok(
  format($$insert into public.product_verifications (product_id, submitted_by, decision, decided_by, decided_at, public_note)
    values (%L, %L, 'rejected', %L, now(), '   ')$$, pg_temp.mu(79120), pg_temp.mu(79001), pg_temp.mu(79004)),
  '23514', null, 'a rejection with a blank public note is rejected');
select throws_ok(
  format($$update public.product_verifications set public_note = 'Early' where id = %L$$, pg_temp.mu(79121)),
  '23514', null, 'an open attempt cannot carry a public note');
select throws_ok(
  format($$update public.product_verifications set private_note_id = %L where id = %L$$,
    pg_temp.mu(79190), pg_temp.mu(79121)),
  '23514', null, 'an open attempt cannot carry a private note');
select throws_ok(
  format($$update public.product_verifications set locked_by = %L where id = %L$$,
    pg_temp.mu(79004), pg_temp.mu(79121)),
  '23514', null, 'locked_by without locked_at is rejected');
select throws_ok(
  format($$update public.product_verifications set benchmark_score = -1 where id = %L$$, pg_temp.mu(79121)),
  '23514', null, 'a negative benchmark score is rejected');
select lives_ok(
  format($$update public.product_verifications set locked_by = %L, locked_at = now() where id = %L$$,
    pg_temp.mu(79004), pg_temp.mu(79121)),
  'an open attempt takes a lock');
select throws_ok(
  format($$update public.product_verifications
    set decision = 'approved', decided_by = %L, decided_at = now() where id = %L$$,
    pg_temp.mu(79004), pg_temp.mu(79121)),
  '23514', null, 'a decided attempt cannot keep a lock');
update public.product_verifications
set decision = 'approved', decided_by = pg_temp.mu(79004), decided_at = now(),
    locked_by = null, locked_at = null, private_note_id = pg_temp.mu(79190)
where id = pg_temp.mu(79121);
select throws_ok(
  format($$update public.product_verifications set public_note = 'Later' where id = %L$$, pg_temp.mu(79121)),
  '23514', null, 'a decided attempt cannot change');
select throws_ok(
  format($$update public.product_verifications
    set decision = null, decided_by = null, decided_at = null, private_note_id = null where id = %L$$,
    pg_temp.mu(79121)),
  '23514', null, 'a decided attempt cannot be reopened');
select throws_ok(
  format($$insert into public.product_verification_evidence (verification_id, kind, storage_path)
    values (%L, 'physical', '  ')$$, pg_temp.mu(79121)),
  '23514', null, 'a blank evidence path is rejected');
insert into public.product_verification_evidence (verification_id, kind, storage_path)
values (pg_temp.mu(79121), 'physical', pg_temp.path(79120, 'a.jpg'));
select throws_ok(
  format($$insert into public.product_verification_evidence (verification_id, kind, storage_path)
    values (%L, 'performance', %L)$$, pg_temp.mu(79121), pg_temp.path(79120, 'a.jpg')),
  '23505', null, 'an attempt lists a path once');
select throws_ok(
  format($$delete from public.products where id = %L$$, pg_temp.mu(79120)),
  '23503', null, 'a listing with attempts cannot be deleted');
select throws_ok(
  format($$delete from public.product_verifications where id = %L$$, pg_temp.mu(79121)),
  '23503', null, 'an attempt with evidence cannot be deleted');

-- Read access per role ------------------------------------------------------------
-- 79130 of seller A and 79131 of seller B, each with one open attempt and one proof.
select pg_temp.listing(79130, 79001, 'in_review');
select pg_temp.listing(79131, 79002, 'in_review');
insert into public.product_verifications (id, product_id, submitted_by)
values (pg_temp.mu(79132), pg_temp.mu(79130), pg_temp.mu(79001)),
       (pg_temp.mu(79133), pg_temp.mu(79131), pg_temp.mu(79002));
insert into public.product_verification_evidence (verification_id, kind, storage_path)
values (pg_temp.mu(79132), 'physical', pg_temp.path(79130, 'a.jpg')),
       (pg_temp.mu(79133), 'physical', pg_temp.path(79131, 'b.jpg'));

create function pg_temp.visible() returns text language sql as $$
  select coalesce((select string_agg(right(product_id::text, 5), ',' order by product_id)
    from public.product_verifications where product_id in (pg_temp.mu(79130), pg_temp.mu(79131))), '')
  || '/' || coalesce((select string_agg(split_part(storage_path, '/', 2), ',' order by storage_path)
    from public.product_verification_evidence
    where verification_id in (pg_temp.mu(79132), pg_temp.mu(79133))), '')
$$;

select pg_temp.as_user(79001);
set local role authenticated;
select is(pg_temp.visible(), '79130/a.jpg', 'a seller reads only their own attempts and evidence');
select pg_temp.as_user(79002);
select is(pg_temp.visible(), '79131/b.jpg', 'the other seller reads only theirs');
select pg_temp.as_user(79003);
select is(pg_temp.visible(), '/', 'a stranger reads no attempt and no evidence');
select pg_temp.as_user(79004);
select is(pg_temp.visible(), '79130,79131/a.jpg,b.jpg', 'an admin reads every attempt and its evidence');

select pg_temp.as_user(79001);
select throws_ok(
  format($$insert into public.product_verifications (product_id, submitted_by) values (%L, %L)$$,
    pg_temp.mu(79130), pg_temp.mu(79001)),
  '42501', null, 'a seller cannot insert an attempt');
select throws_ok(
  format($$update public.product_verifications set benchmark_score = 1 where id = %L$$, pg_temp.mu(79132)),
  '42501', null, 'a seller cannot update an attempt');
select throws_ok(
  format($$delete from public.product_verifications where id = %L$$, pg_temp.mu(79132)),
  '42501', null, 'a seller cannot delete an attempt');
select throws_ok(
  format($$insert into public.product_verification_evidence (verification_id, kind, storage_path)
    values (%L, 'physical', %L)$$, pg_temp.mu(79132), pg_temp.path(79130, 'c.jpg')),
  '42501', null, 'a seller cannot insert evidence');
select throws_ok(
  format($$update public.product_verification_evidence set storage_path = 'x' where verification_id = %L$$,
    pg_temp.mu(79132)),
  '42501', null, 'a seller cannot update evidence');
select throws_ok(
  format($$delete from public.product_verification_evidence where verification_id = %L$$, pg_temp.mu(79132)),
  '42501', null, 'a seller cannot delete evidence');
select pg_temp.as_user(79004);
select throws_ok(
  format($$update public.product_verifications set benchmark_score = 1 where id = %L$$, pg_temp.mu(79132)),
  '42501', null, 'an admin cannot update an attempt through the client either');
reset role;
select set_config('request.jwt.claims', '{"role": "anon"}', true);
set local role anon;
select throws_ok($$select count(*) from public.product_verifications$$,
  '42501', null, 'anon cannot read attempts');
select throws_ok($$select count(*) from public.product_verification_evidence$$,
  '42501', null, 'anon cannot read evidence');
reset role;

-- fn_submit_product_verification ---------------------------------------------------
select pg_temp.listing(79101, 79001, 'pending_verification');
select pg_temp.listing(79102, 79002, 'rejected');
select pg_temp.listing(79103, 79001, 'pending_verification');
select pg_temp.listing(79104, 79001, 'verified');
select pg_temp.listing(79105, 79001, 'pending_verification', true);
select pg_temp.listing(79106, 79001, 'hidden', false, 'pending_verification');
select pg_temp.listing(79107, 79005, 'pending_verification');
select pg_temp.listing(79108, 79001, 'rejected');
insert into public.product_verifications (product_id, submitted_by)
values (pg_temp.mu(79103), pg_temp.mu(79001));
select pg_temp.store(79101, 'front.jpg');
select pg_temp.store(79101, 'serial.jpg');
select pg_temp.store(79101, 'bench.png');
select pg_temp.store(79102, 'front.jpg');
select pg_temp.store(79103, 'front.jpg');
select pg_temp.store(79104, 'front.jpg');
select pg_temp.store(79105, 'front.jpg');
select pg_temp.store(79106, 'front.jpg');
select pg_temp.store(79107, 'front.jpg');
select pg_temp.store(79108, 'front.jpg');
select pg_temp.store(79108, 'other-bucket.jpg', 'products');
create table pg_temp.before_sub as
select pg_temp.sub_sig(array[79101, 79102, 79103, 79104, 79105, 79106, 79107, 79108]) as v;

-- Calls fn_submit_product_verification for listing p_n with the given files of its own folder.
create function pg_temp.submit_sql(p_n integer, p_physical text[], p_performance text[] default '{}',
  p_score integer default null) returns text language sql as $$
  select format($f$select public.fn_submit_product_verification(%L, %L::text[], %L::text[], %s)$f$,
    pg_temp.mu(p_n), p_physical, p_performance, coalesce(p_score::text, 'null'))
$$;

select set_config('request.jwt.claims', '{"role": "authenticated"}', true);
set local role authenticated;
select throws_ok(pg_temp.submit_sql(79101, array[pg_temp.path(79101, 'front.jpg')]),
  'P0001', 'UNAUTHORIZED_NO_SESSION', 'a call without a session is refused');
select pg_temp.as_user(79002);
select throws_ok(pg_temp.submit_sql(79101, array[pg_temp.path(79101, 'front.jpg')]),
  'P0001', 'UNAUTHORIZED', 'another seller cannot submit for the listing');
select throws_ok(pg_temp.submit_sql(79199, array[pg_temp.path(79199, 'front.jpg')]),
  'P0001', 'UNAUTHORIZED', 'a missing listing is refused');
select pg_temp.as_user(79001);
select throws_ok(pg_temp.submit_sql(79104, array[pg_temp.path(79104, 'front.jpg')]),
  'P0001', 'INVALID_STATUS_FOR_VERIFICATION', 'a verified listing cannot be submitted');
select throws_ok(pg_temp.submit_sql(79105, array[pg_temp.path(79105, 'front.jpg')]),
  'P0001', 'INVALID_STATUS_FOR_VERIFICATION', 'a deleted listing cannot be submitted');
select throws_ok(pg_temp.submit_sql(79106, array[pg_temp.path(79106, 'front.jpg')]),
  'P0001', 'INVALID_STATUS_FOR_VERIFICATION', 'a listing under an account hold cannot be submitted');
select throws_ok(pg_temp.submit_sql(79103, array[pg_temp.path(79103, 'front.jpg')]),
  'P0001', 'VERIFICATION_ALREADY_OPEN', 'a listing with an open attempt cannot be submitted again');
select throws_ok(pg_temp.submit_sql(79108, '{}'::text[]),
  'P0001', 'PHYSICAL_PROOF_REQUIRED', 'a submission without a physical proof is refused');
select throws_ok(pg_temp.submit_sql(79108, null),
  'P0001', 'PHYSICAL_PROOF_REQUIRED', 'a NULL physical proof list is refused');
select throws_ok(pg_temp.submit_sql(79108, array[pg_temp.path(79101, 'front.jpg')]),
  'P0001', 'INVALID_EVIDENCE_PATH', 'a physical proof in another listing''s folder is refused');
select throws_ok(pg_temp.submit_sql(79108, array[pg_temp.path(79108, 'front.jpg')],
    array[pg_temp.path(79101, 'bench.png')]),
  'P0001', 'INVALID_EVIDENCE_PATH', 'a performance proof in another listing''s folder is refused');
select throws_ok(pg_temp.submit_sql(79108, array[pg_temp.path(79108, '../' || pg_temp.mu(79101)::text || '/front.jpg')]),
  'P0001', 'INVALID_EVIDENCE_PATH', 'a path with .. is refused');
select throws_ok(pg_temp.submit_sql(79108, array[pg_temp.path(79108, 'front.jpg'), pg_temp.path(79108, 'front.jpg')]),
  'P0001', 'DUPLICATE_EVIDENCE_PATH', 'a path listed twice is refused');
select throws_ok(pg_temp.submit_sql(79108, array[pg_temp.path(79108, 'missing.jpg')]),
  'P0001', 'EVIDENCE_NOT_FOUND', 'a path with no stored file is refused');
select throws_ok(pg_temp.submit_sql(79108, array[pg_temp.path(79108, 'other-bucket.jpg')]),
  'P0001', 'EVIDENCE_NOT_FOUND', 'a file stored in another bucket is refused');
select throws_ok(pg_temp.submit_sql(79108, array[pg_temp.path(79108, 'front.jpg')], '{}', -1),
  'P0001', 'INVALID_BENCHMARK_SCORE', 'a negative benchmark score is refused');
select pg_temp.as_user(79005);
select throws_ok(pg_temp.submit_sql(79107, array[pg_temp.path(79107, 'front.jpg')]),
  'P0001', 'ACCOUNT_NOT_ACTIVE', 'a suspended seller cannot submit');
reset role;
select is(pg_temp.sub_sig(array[79101, 79102, 79103, 79104, 79105, 79106, 79107, 79108]),
  (select v from pg_temp.before_sub),
  'the refused submissions changed no status and wrote no attempt or evidence');
select set_config('request.jwt.claims', '{"role": "anon"}', true);
set local role anon;
select throws_ok(pg_temp.submit_sql(79101, array[pg_temp.path(79101, 'front.jpg')]),
  '42501', null, 'anon cannot execute the submission');
reset role;

-- Happy path: seller A submits listing 79101.
select pg_temp.as_user(79001);
set local role authenticated;
create table pg_temp.submitted as
select public.fn_submit_product_verification(pg_temp.mu(79101),
  array[pg_temp.path(79101, 'serial.jpg'), pg_temp.path(79101, 'front.jpg')],
  array[pg_temp.path(79101, 'bench.png')], 12345) as id;
reset role;
select is((select id from pg_temp.submitted), pg_temp.open_id(79101),
  'the submission returns the id of the new open attempt');
select is(
  (select v.submitted_by::text || '|' || v.benchmark_score || '|' || (v.submitted_at = now())::text
     || '|' || coalesce(v.decision::text, '-') || '|' || coalesce(v.locked_by::text, '-')
   from public.product_verifications v where v.id = pg_temp.open_id(79101)),
  pg_temp.mu(79001)::text || '|12345|true|-|-',
  'the attempt records the seller, the time and the benchmark score, open and unlocked');
select is(pg_temp.evidence(pg_temp.open_id(79101)),
  'physical:front.jpg,physical:serial.jpg,performance:bench.png',
  'the attempt has one evidence row per path with its kind');
select is((select status::text from public.products where id = pg_temp.mu(79101)), 'in_review',
  'the listing moves to in_review');
select pg_temp.as_user(79001);
set local role authenticated;
select throws_ok(pg_temp.submit_sql(79101, array[pg_temp.path(79101, 'front.jpg')]),
  'P0001', 'INVALID_STATUS_FOR_VERIFICATION', 'a listing in review cannot be submitted again');
reset role;

-- Admin queue ---------------------------------------------------------------------
create function pg_temp.queue_row(p_n integer) returns text language sql as $$
  select q.name || '|' || (q.verification_id = pg_temp.open_id(p_n))::text || '|'
    || coalesce(q.benchmark_score::text, '-') || '|' || (q.submitted_at = now())::text || '|'
    || coalesce(q.locked_by::text, '-') || '|' || q.evidence::text
  from public.admin_product_queue_view q where q.id = pg_temp.mu(p_n)
$$;
select pg_temp.as_user(79004);
set local role authenticated;
select is(pg_temp.queue_row(79101),
  'vh-79101|true|12345|true|-|' || jsonb_build_array(
    jsonb_build_object('kind', 'physical', 'storage_path', pg_temp.path(79101, 'front.jpg')),
    jsonb_build_object('kind', 'physical', 'storage_path', pg_temp.path(79101, 'serial.jpg')),
    jsonb_build_object('kind', 'performance', 'storage_path', pg_temp.path(79101, 'bench.png')))::text,
  'the admin queue shows the open attempt with its benchmark and ordered evidence');
select pg_temp.as_user(79001);
select is((select count(*) from public.admin_product_queue_view where id = pg_temp.mu(79101)), 0::bigint,
  'the seller sees no row in the admin queue');
reset role;
-- Every call in this file runs at the same now(); the first attempt moves an
-- hour back so the history below has an order.
update public.product_verifications set submitted_at = now() - interval '1 hour'
where id = pg_temp.open_id(79101);

-- Lock on the open attempt ----------------------------------------------------------
select pg_temp.as_user(79004);
set local role authenticated;
select is((select success from public.fn_lock_product(pg_temp.mu(79101))), true, 'the admin locks the open attempt');
reset role;
select is(
  (select v.locked_by::text || '|' || (v.locked_at = now())::text from public.product_verifications v
   where v.id = pg_temp.open_id(79101)),
  pg_temp.mu(79004)::text || '|true', 'the lock is stored on the attempt');
select pg_temp.as_user(79006);
set local role authenticated;
select is(
  (select success::text || '|' || locked_by_username || '|' || (locked_at = now())::text
   from public.fn_lock_product(pg_temp.mu(79101))),
  'false|money_79004|true', 'a second admin cannot take a fresh lock and learns who holds it');
select throws_ok(
  format($$select public.fn_resolve_product_verdict(%L, 'APPROVE')$$, pg_temp.mu(79101)),
  'P0001', 'LOCK_EXPIRED_OR_STOLEN', 'a second admin cannot decide an attempt locked by another');
reset role;
select is((select locked_by from public.product_verifications where id = pg_temp.open_id(79101)),
  pg_temp.mu(79004), 'the refused lock and verdict leave the first admin''s lock');
select pg_temp.as_user(79004);
set local role authenticated;
select throws_ok(format($$select * from public.fn_lock_product(%L)$$, pg_temp.mu(79104)),
  'P0001', 'VERIFICATION_NOT_OPEN', 'a listing without an open attempt cannot be locked');

-- Rejection -----------------------------------------------------------------------
select throws_ok(
  format($$select public.fn_resolve_product_verdict(%L, 'REJECT', '   ')$$, pg_temp.mu(79101)),
  'P0001', 'REJECTION_NOTE_REQUIRED', 'a rejection without a public note is refused');
select is(public.fn_resolve_product_verdict(pg_temp.mu(79101), 'REJECT', '  Serial unreadable  ', '  Watch this seller  '),
  true, 'the admin rejects the attempt');
reset role;
create table pg_temp.first_attempt as
select v.id from public.product_verifications v where v.product_id = pg_temp.mu(79101);
select is(
  (select v.decision::text || '|' || v.decided_by::text || '|' || (v.decided_at = now())::text || '|'
     || v.public_note || '|' || n.content || '|' || coalesce(v.locked_by::text, '-') || '|'
     || coalesce(v.locked_at::text, '-')
   from public.product_verifications v join public.admin_user_notes n on n.id = v.private_note_id
   where v.id = (select id from pg_temp.first_attempt)),
  'rejected|' || pg_temp.mu(79004)::text || '|true|Serial unreadable|Watch this seller|-|-',
  'the rejection closes the attempt with the reviewer, the trimmed notes and no lock');
select is((select status::text from public.products where id = pg_temp.mu(79101)), 'rejected',
  'the rejected listing is rejected');
select is(
  (select a.action_type || '|' || (a.details->>'verification_id')
   from public.admin_audit_logs a where a.target_id = pg_temp.mu(79101)),
  'PRODUCT_REJECT|' || (select id from pg_temp.first_attempt)::text,
  'the rejection audit row names the attempt');
select is(
  (select string_agg(n.event_kind, ',') from public.notifications n
   where n.user_id = pg_temp.mu(79001) and n.event_payload->>'product_id' = pg_temp.mu(79101)::text),
  'product.rejected', 'the seller gets the rejection notice');

-- Resubmission and approval ---------------------------------------------------------
select pg_temp.as_user(79001);
set local role authenticated;
select isnt(
  public.fn_submit_product_verification(pg_temp.mu(79101), array[pg_temp.path(79101, 'front.jpg')]),
  null::uuid, 'the seller resubmits a rejected listing, reusing an unchanged proof');
reset role;
select is(pg_temp.attempts(79101), 'rejected,open', 'the rejected attempt stays next to the new open one');
select is(pg_temp.evidence(pg_temp.open_id(79101)), 'physical:front.jpg',
  'the new attempt has its own evidence row for the reused path');
create table pg_temp.second_attempt as select pg_temp.open_id(79101) as id;

select pg_temp.as_user(79004);
set local role authenticated;
select is((select success from public.fn_lock_product(pg_temp.mu(79101))), true, 'the admin locks the new attempt');
select is(public.fn_resolve_product_verdict(pg_temp.mu(79101), 'APPROVE', '  Clean card  '), true,
  'the admin approves the new attempt');
reset role;
select is(
  (select v.decision::text || '|' || v.decided_by::text || '|' || v.public_note || '|'
     || coalesce(v.private_note_id::text, '-') || '|' || coalesce(v.locked_by::text, '-')
   from public.product_verifications v where v.id = (select id from pg_temp.second_attempt)),
  'approved|' || pg_temp.mu(79004)::text || '|Clean card|-|-',
  'the approval closes the attempt with the reviewer and the public note');
select is((select status::text from public.products where id = pg_temp.mu(79101)), 'verified',
  'the approved listing is verified');
select is(
  (select a.details->>'verification_id' from public.admin_audit_logs a
   where a.target_id = pg_temp.mu(79101) and a.action_type = 'PRODUCT_APPROVE'),
  (select id from pg_temp.second_attempt)::text, 'the approval audit row names the attempt');
select is(
  (select string_agg(n.event_kind, ',' order by n.event_kind) from public.notifications n
   where n.user_id = pg_temp.mu(79001) and n.event_payload->>'product_id' = pg_temp.mu(79101)::text),
  'product.approved_with_note,product.rejected', 'the seller gets the approval notice');
select is(pg_temp.attempts(79101), 'rejected,approved', 'both decisions are kept');

-- A repeated identical verdict after the decision writes nothing.
select pg_temp.as_user(79004);
set local role authenticated;
select is(public.fn_resolve_product_verdict(pg_temp.mu(79101), 'APPROVE'), true,
  'repeating APPROVE on the decided listing returns true');
select throws_ok(
  format($$select public.fn_resolve_product_verdict(%L, 'REJECT', 'Late')$$, pg_temp.mu(79101)),
  'P0001', 'LOCK_EXPIRED_OR_STOLEN', 'a different verdict without an open attempt is refused');
reset role;
select is(
  pg_temp.attempts(79101) || '|' || (select count(*) from public.admin_audit_logs where target_id = pg_temp.mu(79101))
    || '|' || (select count(*) from public.notifications where event_payload->>'product_id' = pg_temp.mu(79101)::text),
  'rejected,approved|2|2', 'the repeated verdict adds no attempt, audit row or notice');

-- Seller B's rejected listing 79102 goes back to review through the RPC.
select pg_temp.as_user(79002);
set local role authenticated;
select isnt(public.fn_submit_product_verification(pg_temp.mu(79102), array[pg_temp.path(79102, 'front.jpg')]),
  null::uuid, 'a rejected listing can be submitted');
reset role;
select is((select status::text from public.products where id = pg_temp.mu(79102)) || '|' || pg_temp.attempts(79102),
  'in_review|open', 'the rejected listing is in review with one open attempt');

-- S3: the owner can no longer put a listing in review with a plain UPDATE.
select pg_temp.listing(79170, 79001, 'pending_verification');
select pg_temp.listing(79171, 79001, 'rejected');
select pg_temp.as_user(79001);
set local role authenticated;
select throws_ok(
  format($$update public.products set status = 'in_review' where id = %L$$, pg_temp.mu(79170)),
  '42501', null, 'the owner cannot move a pending listing to in_review with an UPDATE');
select throws_ok(
  format($$update public.products set status = 'in_review' where id = %L$$, pg_temp.mu(79171)),
  '42501', null, 'the owner cannot move a rejected listing to in_review with an UPDATE');
reset role;
select is(
  (select string_agg(status::text, ',' order by name) from public.products
   where id in (pg_temp.mu(79170), pg_temp.mu(79171))) || '|'
    || (select count(*) from public.product_verifications
        where product_id in (pg_temp.mu(79170), pg_temp.mu(79171))),
  'pending_verification,rejected|0', 'the refused updates leave both listings and their attempts unchanged');

-- S7: products no longer keeps the verification columns.
select hasnt_column('public', 'products', c, 'products has no column ' || c)
from unnest(array['verification_data', 'rejection_reason', 'verified_at', 'locked_by', 'locked_at']) as c;

-- Schema shape --------------------------------------------------------------------
select enum_has_labels('public', 'product_verification_decision', array['approved', 'rejected'],
  'product_verification_decision holds approved and rejected');
select enum_has_labels('public', 'verification_evidence_kind', array['physical', 'performance'],
  'verification_evidence_kind holds physical and performance');
select is(
  (select obj_description('public.product_verifications'::regclass, 'pg_class') ~ 'kept forever'
     and obj_description('public.product_verification_evidence'::regclass, 'pg_class') ~ 'kept forever'),
  true, 'both tables state their retention class');
select is(
  (select string_agg(relname || ':' || relrowsecurity::text, ',' order by relname) from pg_class
   where oid in ('public.product_verifications'::regclass, 'public.product_verification_evidence'::regclass)),
  'product_verification_evidence:true,product_verifications:true', 'both tables have RLS on');
select is(
  (select pg_get_expr(i.indpred, i.indrelid) from pg_index i
   where i.indrelid = 'public.product_verifications'::regclass and i.indisunique and i.indpred is not null),
  '(decision IS NULL)', 'the one-open-attempt index covers open attempts only');
select ok(
  (select p.prosecdef and not has_function_privilege('anon', p.oid, 'EXECUTE')
     and has_function_privilege('authenticated', p.oid, 'EXECUTE')
   from pg_proc p where p.oid = 'public.fn_submit_product_verification(uuid, text[], text[], integer)'::regprocedure),
  'the submission is SECURITY DEFINER, executable by authenticated and not by anon');
select is(
  (select p.prosecdef::text || '|' || array_to_string(p.proconfig, ',')
   from pg_proc p where p.oid = 'internal.fn_product_verifications_keep_decided_closed()'::regprocedure),
  'false|search_path=""', 'the immutability trigger function runs as invoker with an empty search_path');

select * from finish();
rollback;
