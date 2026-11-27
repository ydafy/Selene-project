-- fn_resolve_product_verdict: an active admin who holds a fresh review lock
-- (10 minutes or less) on the verification attempt they reviewed approves or
-- rejects it, only when that attempt is the listing's open one. It refuses a
-- call without a session, from a non-admin, without that lock, an attempt that
-- is not the listing's open one (unknown, another listing's, or decided while a
-- newer one is open), and a rejection without a public note. A verdict closes
-- the attempt (decision, reviewer, notes), writes the listing status, one admin
-- audit row naming the attempt and one seller notice whose source_event_key
-- ends in the audit row id, even when the listing already has that status.
-- Repeating the decision of an attempt already decided with it writes nothing;
-- another verdict on it is refused. A refusal changes nothing.
-- Runs against the local database only: `supabase start`, then `bun run test:db`.
begin;
select plan(51);

\ir ../fixtures/money.psql

-- Users: 5101 admin, 5102 seller, 5103 second admin, 5104 plain user.
select pg_temp.money_user(5101, 'admin');
select pg_temp.money_user(5102);
select pg_temp.money_user(5103, 'admin');
select pg_temp.money_user(5104);

-- A listing of seller 5102 in p_status, last updated a day ago. With p_open it
-- gets an open attempt pg_temp.mu(p_n + 1000), locked by p_locked_by
-- p_lock_age ago (NULL leaves it unlocked).
create function pg_temp.listing(
  p_n integer, p_status text, p_locked_by integer, p_lock_age interval,
  p_open boolean default true
) returns uuid language plpgsql as $$
begin
  insert into public.products (
    id, name, description, price_cents, category, condition, usage, images, status,
    specifications, seller_id, shipping_cost_cents, origin_zip, package_preset, updated_at,
    publication_shipping_reserve_cents, publication_commission_rate,
    publication_insurance_rate
  )
  select pg_temp.mu(p_n), 'Test GPU', 'Test listing', 100000, 'GPU', 'used', 'gaming',
    array['https://example.test/p.png'], p_status::public.product_status,
    '{}'::jsonb, pg_temp.mu(5102), 10000, '06600', 'gpu_1',
    now() - interval '1 day',
    10000::bigint + s.shipping_buffer_cents
      + ceil(100000::numeric * s.insurance_rate)::bigint,
    s.service_fee_pct,
    s.insurance_rate
  from public.system_settings s where s.id = 1;
  if p_open then
    insert into public.product_verifications (id, product_id, submitted_by, submitted_at, locked_by, locked_at)
    values (pg_temp.mu(p_n + 1000), pg_temp.mu(p_n), pg_temp.mu(5102), now() - interval '1 hour',
      case when p_locked_by is null then null else pg_temp.mu(p_locked_by) end,
      case when p_locked_by is null then null else now() - p_lock_age end);
  end if;
  return pg_temp.mu(p_n);
end $$;

-- status|updated_at of a listing.
create function pg_temp.core(p_n integer) returns text language sql as $$
  select p.status::text || '|' || coalesce(p.updated_at::text, '-')
  from public.products p where p.id = pg_temp.mu(p_n)
$$;
-- locked_by|locked_at of a listing's attempt.
create function pg_temp.lock_of(p_n integer) returns text language sql as $$
  select coalesce(v.locked_by::text, '-') || '|' || coalesce(v.locked_at::text, '-')
  from public.product_verifications v where v.id = pg_temp.mu(p_n + 1000)
$$;
-- decision|decided_by|decided_at is now()|public_note|private note text of a listing's attempt.
create function pg_temp.attempt(p_n integer) returns text language sql as $$
  select coalesce(v.decision::text, 'open') || '|' || coalesce(v.decided_by::text, '-') || '|'
    || coalesce((v.decided_at = now())::text, '-') || '|' || coalesce(v.public_note, '-') || '|'
    || coalesce(n.content, '-')
  from public.product_verifications v
  left join public.admin_user_notes n on n.id = v.private_note_id
  where v.id = pg_temp.mu(p_n + 1000)
$$;
create function pg_temp.attempts(p_n integer) returns bigint language sql as $$
  select count(*) from public.product_verifications where product_id = pg_temp.mu(p_n)
$$;
create function pg_temp.audits(p_n integer) returns bigint language sql as $$
  select count(*) from public.admin_audit_logs where target_id = pg_temp.mu(p_n)
$$;
create function pg_temp.notices(p_n integer) returns bigint language sql as $$
  select count(*) from public.notifications where event_payload->>'product_id' = pg_temp.mu(p_n)::text
$$;
create function pg_temp.seller_notes() returns bigint language sql as $$
  select count(*) from public.admin_user_notes where user_id = pg_temp.mu(5102)
$$;
-- Everything a verdict can write for a listing, to prove a refusal wrote nothing.
create function pg_temp.sig_of(p_n integer) returns text language sql as $$
  select pg_temp.core(p_n) || '|' || coalesce(pg_temp.lock_of(p_n), 'no attempt') || '|'
    || coalesce(pg_temp.attempt(p_n), 'no attempt') || '|attempts:' || pg_temp.attempts(p_n)
    || '|audits:' || pg_temp.audits(p_n) || '|notices:' || pg_temp.notices(p_n)
    || '|notes:' || pg_temp.seller_notes()
$$;
create table pg_temp.sig (n integer primary key, v text);
create function pg_temp.remember(p_ns integer[]) returns void language sql as $$
  insert into pg_temp.sig select n, pg_temp.sig_of(n) from unnest(p_ns) as n
  on conflict (n) do update set v = excluded.v
$$;
create function pg_temp.unchanged(p_n integer) returns boolean language sql as $$
  select pg_temp.sig_of(p_n) = (select v from pg_temp.sig where n = p_n)
$$;
-- The one audit row of a listing, without its id and timestamp.
create function pg_temp.audit_row(p_n integer) returns text language sql as $$
  select string_agg(a.admin_id::text || '|' || a.action_type || '|' || a.details::text, ' ; ')
  from public.admin_audit_logs a where a.target_id = pg_temp.mu(p_n)
$$;
-- The one notice of a listing; key_ok says its source_event_key is
-- <event_kind>:<listing id>:<audit row id>.
create function pg_temp.notice_row(p_n integer) returns text language sql as $$
  select string_agg(
    n.user_id::text || '|' || n.event_kind || '|' || n.type || '|' || n.title || '|'
      || n.message || '|' || n.action_path || '|read:' || n.read::text || '|'
      || n.event_payload::text || '|key_ok:'
      || (n.source_event_key = n.event_kind || ':' || pg_temp.mu(p_n)::text || ':'
          || (select a.id::text from public.admin_audit_logs a where a.target_id = pg_temp.mu(p_n)))::text,
    ' ; ')
  from public.notifications n where n.event_payload->>'product_id' = pg_temp.mu(p_n)::text
$$;
create function pg_temp.payload(p_n integer) returns text language sql as $$
  select jsonb_build_object('product_id', pg_temp.mu(p_n), 'recipient_role', 'seller')::text
$$;
create function pg_temp.details(p_n integer, p_note text, p_verdict text) returns text language sql as $$
  select jsonb_build_object('product_name', 'Test GPU', 'seller_id', pg_temp.mu(5102),
    'admin_note', p_note, 'verdict', p_verdict, 'verification_id', pg_temp.mu(p_n + 1000))::text
$$;

select pg_temp.listing(5121, 'in_review', 5104, interval '1 minute');
select pg_temp.listing(5122, 'in_review', 5103, interval '1 minute');
select pg_temp.listing(5123, 'in_review', null, null);
select pg_temp.listing(5124, 'in_review', 5101, interval '10 minutes 1 second');
select pg_temp.listing(5125, 'in_review', 5101, interval '10 minutes');
select pg_temp.listing(5126, 'verified', 5101, interval '1 minute');
select pg_temp.listing(5127, 'rejected', 5101, interval '1 minute');
select pg_temp.listing(5128, 'in_review', 5101, interval '1 minute');
select pg_temp.listing(5129, 'in_review', 5101, interval '1 minute');
select pg_temp.listing(5130, 'in_review', 5101, interval '1 minute');
select pg_temp.listing(5131, 'in_review', 5101, interval '1 minute');
select pg_temp.listing(5132, 'pending_verification', 5101, interval '1 minute');
select pg_temp.listing(5133, 'in_review', null, null, false);
-- 5134: a rejected first attempt pg_temp.mu(7134) and a newer open attempt
-- pg_temp.mu(6134) locked by admin 5101.
select pg_temp.listing(5134, 'in_review', 5101, interval '1 minute');
insert into public.product_verifications (
  id, product_id, submitted_by, submitted_at, decision, decided_by, decided_at, public_note
) values (pg_temp.mu(7134), pg_temp.mu(5134), pg_temp.mu(5102), now() - interval '3 hours',
  'rejected', pg_temp.mu(5101), now() - interval '2 hours', 'Old reason');
create function pg_temp.old_attempt() returns text language sql as $$
  select v.decision::text || '|' || v.decided_by::text || '|' || v.decided_at::text || '|' || v.public_note
    || '|' || coalesce(v.private_note_id::text, '-') || '|' || coalesce(v.locked_by::text, '-')
  from public.product_verifications v where v.id = pg_temp.mu(7134)
$$;
create table pg_temp.old_attempt_before as select pg_temp.old_attempt() as v;
select pg_temp.remember(array[5121, 5122, 5123, 5124, 5126, 5127, 5128, 5132, 5133, 5134]);

-- Refusals ---------------------------------------------------------------------
-- No session: the claims carry no sub. Listing 5121 is locked by plain user
-- 5104, so without the admin check their call would go through.
select set_config('request.jwt.claims', '{"role": "authenticated"}', true);
set local role authenticated;
select throws_ok(
  format($$select public.fn_resolve_product_verdict(%L, %L, 'APPROVE')$$, pg_temp.mu(5121), pg_temp.mu(6121)),
  'P0001', 'UNAUTHORIZED_NO_SESSION', 'a call without a session is refused');
reset role;
select set_config('request.jwt.claims', format('{"sub": "%s", "role": "authenticated"}', pg_temp.mu(5104)), true);
set local role authenticated;
select throws_ok(
  format($$select public.fn_resolve_product_verdict(%L, %L, 'APPROVE')$$, pg_temp.mu(5121), pg_temp.mu(6121)),
  'P0001', 'UNAUTHORIZED_ADMIN_ONLY', 'a non-admin is refused, even holding the lock');
reset role;
select ok(pg_temp.unchanged(5121),
  'the no-session and non-admin calls leave the listing, attempt, audit rows, notices and notes unchanged');

select set_config('request.jwt.claims', format('{"sub": "%s", "role": "authenticated"}', pg_temp.mu(5101)), true);
set local role authenticated;
select throws_ok(
  format($$select public.fn_resolve_product_verdict(%L, %L, 'APPROVE')$$, pg_temp.mu(5122), pg_temp.mu(6122)),
  'P0001', 'LOCK_EXPIRED_OR_STOLEN', 'a lock held by another admin is refused');
reset role;
select ok(pg_temp.unchanged(5122), 'a refused stolen lock changes nothing');

set local role authenticated;
select throws_ok(
  format($$select public.fn_resolve_product_verdict(%L, %L, 'APPROVE')$$, pg_temp.mu(5123), pg_temp.mu(6123)),
  'P0001', 'LOCK_EXPIRED_OR_STOLEN', 'an unlocked attempt is refused');
reset role;
select ok(pg_temp.unchanged(5123), 'a refused unlocked attempt changes nothing');

set local role authenticated;
select throws_ok(
  format($$select public.fn_resolve_product_verdict(%L, %L, 'APPROVE')$$, pg_temp.mu(5124), pg_temp.mu(6124)),
  'P0001', 'LOCK_EXPIRED_OR_STOLEN', 'the caller''s own lock older than 10 minutes is refused');
reset role;
select ok(pg_temp.unchanged(5124), 'a refused expired lock changes nothing');

set local role authenticated;
select throws_ok(
  format($$select public.fn_resolve_product_verdict(%L, %L, 'APPROVE')$$, pg_temp.mu(5133), pg_temp.mu(6133)),
  'P0001', 'VERIFICATION_NOT_OPEN', 'a listing in review without an open attempt is refused');
reset role;
select ok(pg_temp.unchanged(5133), 'a refused listing without an open attempt changes nothing');

set local role authenticated;
select throws_ok(
  format($$select public.fn_resolve_product_verdict(%L, %L, 'MAYBE', 'Note', 'Private note')$$, pg_temp.mu(5128), pg_temp.mu(6128)),
  'P0001', 'INVALID_VERDICT_VALUE', 'an unknown verdict is refused');
reset role;
select ok(pg_temp.unchanged(5128), 'an unknown verdict writes no status, decision, audit row, notice or private note');

set local role authenticated;
select throws_ok(
  format($$select public.fn_resolve_product_verdict(%L, %L, 'REJECT')$$, pg_temp.mu(5132), pg_temp.mu(6132)),
  'P0001', 'REJECTION_NOTE_REQUIRED', 'REJECT without a public note is refused');
select throws_ok(
  format($$select public.fn_resolve_product_verdict(%L, %L, 'REJECT', '   ', 'Private note')$$, pg_temp.mu(5132), pg_temp.mu(6132)),
  'P0001', 'REJECTION_NOTE_REQUIRED', 'REJECT with a blank public note is refused');
reset role;
select ok(pg_temp.unchanged(5132), 'a refused rejection without a note writes nothing');

-- A stale queue shows the first attempt while a newer one is open and locked by
-- the same admin; another listing's open attempt is locked by the caller too.
set local role authenticated;
select throws_ok(
  format($$select public.fn_resolve_product_verdict(%L, %L, 'REJECT', 'Stale')$$, pg_temp.mu(5134), pg_temp.mu(7134)),
  'P0001', 'VERIFICATION_NOT_OPEN',
  'repeating the decided first attempt''s rejection is refused while a newer attempt is open');
select throws_ok(
  format($$select public.fn_resolve_product_verdict(%L, %L, 'APPROVE')$$, pg_temp.mu(5128), pg_temp.mu(6134)),
  'P0001', 'VERIFICATION_NOT_OPEN', 'a verdict through another listing''s open attempt is refused');
reset role;
select ok(pg_temp.unchanged(5134) and pg_temp.unchanged(5128),
  'the refused verdicts leave both listings, the newer attempt and its lock, audit rows, notices and notes unchanged');
select is(pg_temp.old_attempt(), (select v from pg_temp.old_attempt_before),
  'the refused stale verdict leaves the decided first attempt unchanged');

-- The 10-minute boundary: a lock exactly 10 minutes old is still valid ---------
set local role authenticated;
select is(public.fn_resolve_product_verdict(pg_temp.mu(5125), pg_temp.mu(6125), 'APPROVE'), true,
  'a lock exactly 10 minutes old still allows the verdict');
reset role;
select is((select status::text from public.products where id = pg_temp.mu(5125)), 'verified',
  'the verdict under a 10-minute-old lock is written');

-- A listing that already has the verdict's status: the open attempt still closes
set local role authenticated;
select is(public.fn_resolve_product_verdict(pg_temp.mu(5126), pg_temp.mu(6126), 'APPROVE', 'Note'), true,
  'APPROVE on a verified listing with an open attempt returns true');
reset role;
select is(pg_temp.core(5126), 'verified|' || now()::text,
  'APPROVE on a verified listing keeps verified and stamps updated_at');
select is(pg_temp.attempt(5126) || '|' || pg_temp.lock_of(5126),
  'approved|' || pg_temp.mu(5101)::text || '|true|Note|-|-|-',
  'APPROVE on a verified listing closes the attempt with the reviewer and the note and clears its lock');
select is(pg_temp.audit_row(5126),
  pg_temp.mu(5101)::text || '|PRODUCT_APPROVE|' || pg_temp.details(5126, 'Note', 'APPROVE'),
  'APPROVE on a verified listing writes one PRODUCT_APPROVE audit row naming the attempt');
select is(pg_temp.notice_row(5126),
  pg_temp.mu(5102)::text || '|product.approved_with_note|warning|Producto Verificado|'
    || '¡Listo! Tu producto "Test GPU" ya está a la venta. Nota del administrador: Note|/product/'
    || pg_temp.mu(5126)::text || '|read:false|' || pg_temp.payload(5126) || '|key_ok:true',
  'APPROVE on a verified listing sends the seller one notice keyed by the audit row');

set local role authenticated;
select is(public.fn_resolve_product_verdict(pg_temp.mu(5127), pg_temp.mu(6127), 'REJECT', 'New reason'), true,
  'REJECT on a rejected listing with an open attempt returns true');
reset role;
select is(pg_temp.core(5127) || '|' || pg_temp.attempt(5127) || '|' || pg_temp.lock_of(5127),
  'rejected|' || now()::text || '|rejected|' || pg_temp.mu(5101)::text || '|true|New reason|-|-|-',
  'REJECT on a rejected listing stamps updated_at and closes the attempt with the reason and no lock');
select is(pg_temp.audit_row(5127),
  pg_temp.mu(5101)::text || '|PRODUCT_REJECT|' || pg_temp.details(5127, 'New reason', 'REJECT'),
  'REJECT on a rejected listing writes one PRODUCT_REJECT audit row naming the attempt');
select is(pg_temp.notice_row(5127),
  pg_temp.mu(5102)::text || '|product.rejected|error|Producto Rechazado|'
    || 'Tu producto "Test GPU" ha sido rechazado. Motivo: New reason|/verify/'
    || pg_temp.mu(5127)::text || '|read:false|' || pg_temp.payload(5127) || '|key_ok:true',
  'REJECT on a rejected listing sends the seller one product.rejected notice');

-- APPROVE without a public note; a blank private note is not stored -------------
select pg_temp.remember(array[5129]);
set local role authenticated;
select is(public.fn_resolve_product_verdict(pg_temp.mu(5129), pg_temp.mu(6129), 'APPROVE', null, '   '), true,
  'APPROVE returns true');
reset role;
select is(pg_temp.core(5129), 'verified|' || now()::text,
  'APPROVE sets verified and stamps updated_at');
select is(pg_temp.attempt(5129) || '|' || pg_temp.lock_of(5129),
  'approved|' || pg_temp.mu(5101)::text || '|true|-|-|-|-',
  'APPROVE closes the attempt with the reviewer and clears its lock');
select is(pg_temp.audit_row(5129),
  pg_temp.mu(5101)::text || '|PRODUCT_APPROVE|' || pg_temp.details(5129, null, 'APPROVE'),
  'APPROVE writes one PRODUCT_APPROVE audit row for the admin, naming the attempt');
select is(pg_temp.notices(5129), 1::bigint, 'APPROVE sends exactly one notice');
select is(pg_temp.notice_row(5129),
  pg_temp.mu(5102)::text || '|product.approved|success|Producto Verificado|'
    || '¡Felicidades! Tu producto "Test GPU" ha sido aprobado por moderación.|/product/'
    || pg_temp.mu(5129)::text || '|read:false|' || pg_temp.payload(5129) || '|key_ok:true',
  'APPROVE without a note sends the seller an unread product.approved notice keyed by the audit row');
select is(pg_temp.seller_notes(), (select substring(v from 'notes:(\d+)$')::bigint from pg_temp.sig where n = 5129),
  'a blank private note is not stored');

-- Repeated on the decided attempt: nothing written ------------------------------
select pg_temp.remember(array[5129]);
set local role authenticated;
select is(public.fn_resolve_product_verdict(pg_temp.mu(5129), pg_temp.mu(6129), 'APPROVE', 'Again', 'Again'), true,
  'APPROVE repeated on the approved attempt returns true');
reset role;
select ok(pg_temp.unchanged(5129), 'the repeated APPROVE writes no attempt, status, audit row, notice or note');
set local role authenticated;
select throws_ok(
  format($$select public.fn_resolve_product_verdict(%L, %L, 'REJECT', 'Too late')$$, pg_temp.mu(5129), pg_temp.mu(6129)),
  'P0001', 'VERIFICATION_NOT_OPEN', 'a different verdict on the approved attempt is refused');
reset role;
select ok(pg_temp.unchanged(5129), 'the refused different verdict writes nothing');

-- APPROVE with a public note and a private note --------------------------------
set local role authenticated;
select is(public.fn_resolve_product_verdict(pg_temp.mu(5130), pg_temp.mu(6130), 'APPROVE', '  Check the fan  ', '  Blurry photos  '), true,
  'APPROVE with notes returns true');
reset role;
select is(pg_temp.audit_row(5130),
  pg_temp.mu(5101)::text || '|PRODUCT_APPROVE|' || pg_temp.details(5130, 'Check the fan', 'APPROVE'),
  'APPROVE stores the trimmed public note in the audit row');
select is(pg_temp.notice_row(5130),
  pg_temp.mu(5102)::text || '|product.approved_with_note|warning|Producto Verificado|'
    || '¡Listo! Tu producto "Test GPU" ya está a la venta. Nota del administrador: Check the fan|/product/'
    || pg_temp.mu(5130)::text || '|read:false|' || pg_temp.payload(5130) || '|key_ok:true',
  'APPROVE with a public note sends a product.approved_with_note notice with the trimmed note');
select is(
  (select string_agg(admin_id::text || '|' || content, ' ; ') from public.admin_user_notes
   where user_id = pg_temp.mu(5102)),
  pg_temp.mu(5101)::text || '|Blurry photos',
  'the trimmed private note is stored once on the seller, by the admin');
select is(pg_temp.attempt(5130), 'approved|' || pg_temp.mu(5101)::text || '|true|Check the fan|Blurry photos',
  'the attempt keeps the trimmed public note and points at the private note');

-- REJECT with a public note ----------------------------------------------------
set local role authenticated;
select is(public.fn_resolve_product_verdict(pg_temp.mu(5131), pg_temp.mu(6131), 'REJECT', '  Serial number missing  '), true,
  'REJECT returns true');
reset role;
select is(pg_temp.core(5131) || '|' || pg_temp.attempt(5131) || '|' || pg_temp.lock_of(5131),
  'rejected|' || now()::text || '|rejected|' || pg_temp.mu(5101)::text
    || '|true|Serial number missing|-|-|-',
  'REJECT sets rejected, stamps updated_at and closes the attempt with the trimmed reason and no lock');
select is(pg_temp.audit_row(5131),
  pg_temp.mu(5101)::text || '|PRODUCT_REJECT|' || pg_temp.details(5131, 'Serial number missing', 'REJECT'),
  'REJECT writes one PRODUCT_REJECT audit row for the admin, naming the attempt');
select is(pg_temp.notice_row(5131),
  pg_temp.mu(5102)::text || '|product.rejected|error|Producto Rechazado|'
    || 'Tu producto "Test GPU" ha sido rechazado. Motivo: Serial number missing|/verify/'
    || pg_temp.mu(5131)::text || '|read:false|' || pg_temp.payload(5131) || '|key_ok:true',
  'REJECT sends the seller a product.rejected notice pointing at the verification screen');

select * from finish();
rollback;
