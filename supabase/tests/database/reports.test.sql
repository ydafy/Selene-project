-- Reports data model (odd/tasks/reports-data-model.md S1-S5, #653): exactly
-- one existing target, a required reason, one open report per reporter and
-- target, a coherent resolution, insert-only clients and admin-only reads.
-- Runs against the local database only: `supabase start`, then `bun run test:db`.
begin;
select plan(27);
\ir ../fixtures/money.psql

-- 1 reporter, 2 seller of listing 3, 4 admin, 5 another user.
select pg_temp.money_user(1);
select pg_temp.money_user(2);
select pg_temp.money_product(3, 2);
select pg_temp.money_user(4, 'admin');
select pg_temp.money_user(5);

create function pg_temp.act_as(p_n integer) returns void language sql as $$
  select set_config('request.jwt.claims',
    json_build_object('sub', pg_temp.mu(p_n), 'role', 'authenticated')::text, true)
$$;

-- Shape (S1): the polymorphic columns are gone.
select hasnt_column('public', 'reports', 'target_id', 'reports has no target_id');
select hasnt_column('public', 'reports', 'target_type', 'reports has no target_type');

-- Inserts as the reporter.
select pg_temp.act_as(1);
set local role authenticated;

select lives_ok(
  format($$insert into public.reports (reporter_id, target_product_id, reason)
           values (%L, %L, 'fraud')$$, pg_temp.mu(1), pg_temp.mu(3)),
  'a user reports a listing with a reason');
select throws_ok(
  format($$insert into public.reports (reporter_id, target_product_id, reason)
           values (%L, %L, 'spam')$$, pg_temp.mu(1), pg_temp.mu(3)),
  '23505', null, 'a second open report on the same listing is rejected');
select lives_ok(
  format($$insert into public.reports (reporter_id, target_user_id, reason, details)
           values (%L, %L, 'harassment', 'Insults in the listing')$$, pg_temp.mu(1), pg_temp.mu(2)),
  'a user reports another user with details');
select throws_ok(
  format($$insert into public.reports (reporter_id, target_user_id, reason)
           values (%L, %L, 'spam')$$, pg_temp.mu(1), pg_temp.mu(2)),
  '23505', null, 'a second open report on the same user is rejected');
select throws_ok(
  format($$insert into public.reports (reporter_id, target_user_id, reason)
           values (%L, %L, 'spam')$$, pg_temp.mu(1), pg_temp.mu(1)),
  '23514', null, 'a user cannot report themselves');
select throws_ok(
  format($$insert into public.reports (reporter_id, reason) values (%L, 'spam')$$, pg_temp.mu(1)),
  '23514', null, 'a report without a target is rejected');
select throws_ok(
  format($$insert into public.reports (reporter_id, target_product_id, target_user_id, reason)
           values (%L, %L, %L, 'spam')$$, pg_temp.mu(1), pg_temp.mu(3), pg_temp.mu(5)),
  '23514', null, 'a report with two targets is rejected');
select throws_ok(
  format($$insert into public.reports (reporter_id, target_user_id) values (%L, %L)$$,
         pg_temp.mu(1), pg_temp.mu(5)),
  '23502', null, 'a report without a reason is rejected');
select throws_ok(
  format($$insert into public.reports (reporter_id, target_user_id, reason, details)
           values (%L, %L, 'other', repeat('x', 1001))$$, pg_temp.mu(1), pg_temp.mu(5)),
  '23514', null, 'details longer than 1000 characters are rejected');
select throws_ok(
  format($$insert into public.reports (reporter_id, target_product_id, reason)
           values (%L, gen_random_uuid(), 'fraud')$$, pg_temp.mu(1)),
  '23503', null, 'a report on a listing that does not exist is rejected');
select throws_ok(
  format($$insert into public.reports (reporter_id, target_user_id, reason)
           values (%L, %L, 'spam')$$, pg_temp.mu(5), pg_temp.mu(2)),
  '42501', null, 'a user cannot file a report as someone else');
select throws_ok(
  format($$insert into public.reports (reporter_id, target_user_id, reason, status)
           values (%L, %L, 'spam', 'resolved')$$, pg_temp.mu(1), pg_temp.mu(5)),
  '42501', null, 'a user cannot set the status');
select throws_ok(
  format($$insert into public.reports (reporter_id, target_user_id, reason, outcome)
           values (%L, %L, 'spam', 'dismissed')$$, pg_temp.mu(1), pg_temp.mu(5)),
  '42501', null, 'a user cannot set the outcome');
select throws_ok(
  format($$update public.reports set details = 'edited' where reporter_id = %L$$, pg_temp.mu(1)),
  '42501', null, 'a user cannot update a report');
select is((select count(*)::integer from public.reports), 0, 'a user reads no reports, not even their own');

-- The seller cannot report their own listing.
select pg_temp.act_as(2);
select throws_ok(
  format($$insert into public.reports (reporter_id, target_product_id, reason)
           values (%L, %L, 'fraud')$$, pg_temp.mu(2), pg_temp.mu(3)),
  '42501', null, 'a seller cannot report their own listing');

-- The admin reads every report.
select pg_temp.act_as(4);
select is((select count(*)::integer from public.reports), 2, 'an admin reads every report');
reset role;

set local role anon;
select throws_ok(
  format($$insert into public.reports (reporter_id, target_user_id, reason)
           values (%L, %L, 'spam')$$, pg_temp.mu(1), pg_temp.mu(5)),
  '42501', null, 'anon cannot file a report');
reset role;

-- Stored rows (as the table owner): status defaults to open.
select is(
  (select array_agg(status::text order by reason) from public.reports where reporter_id = pg_temp.mu(1)),
  array['open', 'open'], 'new reports are open');

-- Resolution (S3): complete or not at all.
select throws_ok(
  format($$update public.reports set status = 'resolved' where target_product_id = %L$$, pg_temp.mu(3)),
  '23514', null, 'a resolved report needs who, when and the outcome');
select throws_ok(
  format($$update public.reports set outcome = 'dismissed' where target_product_id = %L$$, pg_temp.mu(3)),
  '23514', null, 'an open report has no outcome');
select lives_ok(
  format($$update public.reports set status = 'resolved', resolved_by = %L, resolved_at = now(),
             outcome = 'listing_removed', resolution_note = 'Counterfeit'
           where target_product_id = %L$$, pg_temp.mu(4), pg_temp.mu(3)),
  'an admin resolution records who, when and the outcome');

-- One open report per target: after the resolution the reporter can report again.
select pg_temp.act_as(1);
set local role authenticated;
select lives_ok(
  format($$insert into public.reports (reporter_id, target_product_id, reason)
           values (%L, %L, 'counterfeit_or_misdescribed')$$, pg_temp.mu(1), pg_temp.mu(3)),
  'a resolved report does not block a new one');
reset role;

-- Moderation evidence outlives its targets (S1, S8).
select throws_ok(
  format('delete from public.products where id = %L', pg_temp.mu(3)),
  '23503', null, 'a reported listing cannot be deleted');
select throws_ok(
  format('delete from public.profiles where id = %L', pg_temp.mu(1)),
  '23503', null, 'a reporter''s profile cannot be deleted');

select * from finish();
rollback;
