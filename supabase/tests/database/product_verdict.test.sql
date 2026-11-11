-- fn_resolve_product_verdict: an active admin who holds a fresh review lock
-- (10 minutes or less) approves or rejects a listing. It refuses a call
-- without a session, from a non-admin, or without that lock. APPROVE on a
-- VERIFIED listing or REJECT on a REJECTED one only releases the lock. A
-- verdict writes the listing status, one admin audit row and one seller
-- notice whose source_event_key ends in the audit row id. A refusal changes
-- nothing. Runs against the local database only: `supabase start`, then
-- `bun run test:db`.
begin;
select plan(38);

\ir ../fixtures/money.psql

-- Users: 5101 admin, 5102 seller, 5103 second admin, 5104 plain user.
select pg_temp.money_user(5101, 'admin');
select pg_temp.money_user(5102);
select pg_temp.money_user(5103, 'admin');
select pg_temp.money_user(5104);

-- A listing of seller 5102 in p_status, locked by p_locked_by p_lock_age ago
-- (NULL leaves it unlocked), last updated and verified a day ago.
create function pg_temp.listing(
  p_n integer, p_status text, p_locked_by integer, p_lock_age interval,
  p_rejection_reason text default null
) returns uuid language sql as $$
  insert into public.products (
    id, name, description, price, category, condition, usage, images, status,
    specifications, seller_id, shipping_cost, origin_zip, package_preset,
    rejection_reason, locked_by, locked_at, verified_at, updated_at,
    publication_shipping_reserve_cents, publication_commission_rate,
    publication_insurance_rate
  )
  select pg_temp.mu(p_n), 'Test GPU', 'Test listing', 1000, 'GPU', 'used', 'gaming',
    array['https://example.test/p.png'], p_status::public.product_status_enum,
    '{}'::jsonb, pg_temp.mu(5102), 100, '06600', 'gpu_1', p_rejection_reason,
    case when p_locked_by is null then null else pg_temp.mu(p_locked_by) end,
    case when p_locked_by is null then null else now() - p_lock_age end,
    case when p_status = 'VERIFIED' then now() - interval '1 day' end,
    now() - interval '1 day',
    round(100 * 100)::bigint + s.shipping_buffer_cents
      + ceil(round(1000 * 100)::numeric * public.normalize_publication_rate(s.insurance_rate))::bigint,
    public.normalize_publication_rate(s.service_fee_pct),
    public.normalize_publication_rate(s.insurance_rate)
  from public.system_settings s where s.id = 1
  returning id
$$;

-- status|rejection_reason|verified_at|updated_at of a listing.
create function pg_temp.core(p_n integer) returns text language sql as $$
  select p.status::text || '|' || coalesce(p.rejection_reason, '-') || '|'
    || coalesce(p.verified_at::text, '-') || '|' || coalesce(p.updated_at::text, '-')
  from public.products p where p.id = pg_temp.mu(p_n)
$$;
-- locked_by|locked_at of a listing.
create function pg_temp.lock_of(p_n integer) returns text language sql as $$
  select coalesce(p.locked_by::text, '-') || '|' || coalesce(p.locked_at::text, '-')
  from public.products p where p.id = pg_temp.mu(p_n)
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
  select pg_temp.core(p_n) || '|' || pg_temp.lock_of(p_n) || '|audits:' || pg_temp.audits(p_n)
    || '|notices:' || pg_temp.notices(p_n) || '|notes:' || pg_temp.seller_notes()
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
    'admin_note', p_note, 'verdict', p_verdict)::text
$$;

select pg_temp.listing(5121, 'IN_REVIEW', 5104, interval '1 minute');
select pg_temp.listing(5122, 'IN_REVIEW', 5103, interval '1 minute');
select pg_temp.listing(5123, 'IN_REVIEW', null, null);
select pg_temp.listing(5124, 'IN_REVIEW', 5101, interval '10 minutes 1 second');
select pg_temp.listing(5125, 'IN_REVIEW', 5101, interval '10 minutes');
select pg_temp.listing(5126, 'VERIFIED', 5101, interval '1 minute');
select pg_temp.listing(5127, 'REJECTED', 5101, interval '1 minute', 'Old reason');
select pg_temp.listing(5128, 'IN_REVIEW', 5101, interval '1 minute');
select pg_temp.listing(5129, 'IN_REVIEW', 5101, interval '1 minute', 'Old reason');
select pg_temp.listing(5130, 'IN_REVIEW', 5101, interval '1 minute');
select pg_temp.listing(5131, 'IN_REVIEW', 5101, interval '1 minute');
select pg_temp.listing(5132, 'PENDING_VERIFICATION', 5101, interval '1 minute');
select pg_temp.remember(array[5121, 5122, 5123, 5124, 5128]);
create table pg_temp.before_core as select n, pg_temp.core(n) as v from unnest(array[5126, 5127]) as n;

-- Refusals ---------------------------------------------------------------------
-- No session: the claims carry no sub. Listing 5121 is locked by plain user
-- 5104, so without the admin check their call would go through.
select set_config('request.jwt.claims', '{"role": "authenticated"}', true);
set local role authenticated;
select throws_ok(
  format($$select public.fn_resolve_product_verdict(%L, 'APPROVE')$$, pg_temp.mu(5121)),
  'P0001', 'UNAUTHORIZED_NO_SESSION', 'a call without a session is refused');
reset role;
select set_config('request.jwt.claims', format('{"sub": "%s", "role": "authenticated"}', pg_temp.mu(5104)), true);
set local role authenticated;
select throws_ok(
  format($$select public.fn_resolve_product_verdict(%L, 'APPROVE')$$, pg_temp.mu(5121)),
  'P0001', 'UNAUTHORIZED_ADMIN_ONLY', 'a non-admin is refused, even holding the lock');
reset role;
select ok(pg_temp.unchanged(5121),
  'the no-session and non-admin calls leave the listing, audit rows, notices and notes unchanged');

select set_config('request.jwt.claims', format('{"sub": "%s", "role": "authenticated"}', pg_temp.mu(5101)), true);
set local role authenticated;
select throws_ok(
  format($$select public.fn_resolve_product_verdict(%L, 'APPROVE')$$, pg_temp.mu(5122)),
  'P0001', 'LOCK_EXPIRED_OR_STOLEN', 'a lock held by another admin is refused');
reset role;
select ok(pg_temp.unchanged(5122), 'a refused stolen lock changes nothing');

set local role authenticated;
select throws_ok(
  format($$select public.fn_resolve_product_verdict(%L, 'APPROVE')$$, pg_temp.mu(5123)),
  'P0001', 'LOCK_EXPIRED_OR_STOLEN', 'an unlocked listing is refused');
reset role;
select ok(pg_temp.unchanged(5123), 'a refused unlocked listing changes nothing');

set local role authenticated;
select throws_ok(
  format($$select public.fn_resolve_product_verdict(%L, 'APPROVE')$$, pg_temp.mu(5124)),
  'P0001', 'LOCK_EXPIRED_OR_STOLEN', 'the caller''s own lock older than 10 minutes is refused');
reset role;
select ok(pg_temp.unchanged(5124), 'a refused expired lock changes nothing');

set local role authenticated;
select throws_ok(
  format($$select public.fn_resolve_product_verdict(%L, 'MAYBE', 'Note', 'Private note')$$, pg_temp.mu(5128)),
  'P0001', 'INVALID_VERDICT_VALUE', 'an unknown verdict is refused');
reset role;
select ok(pg_temp.unchanged(5128), 'an unknown verdict writes no status, audit row, notice or private note');

-- The 10-minute boundary: a lock exactly 10 minutes old is still valid ---------
set local role authenticated;
select is(public.fn_resolve_product_verdict(pg_temp.mu(5125), 'APPROVE'), true,
  'a lock exactly 10 minutes old still allows the verdict');
reset role;
select is((select status::text from public.products where id = pg_temp.mu(5125)), 'VERIFIED',
  'the verdict under a 10-minute-old lock is written');

-- Same-status guard: only the lock is released ---------------------------------
set local role authenticated;
select is(public.fn_resolve_product_verdict(pg_temp.mu(5126), 'APPROVE', 'Note'), true,
  'APPROVE on a VERIFIED listing returns true');
reset role;
select is(pg_temp.lock_of(5126), '-|-', 'APPROVE on a VERIFIED listing releases the lock');
select is(pg_temp.core(5126), (select v from pg_temp.before_core where n = 5126),
  'APPROVE on a VERIFIED listing keeps its status, verified_at and updated_at');
select is(pg_temp.audits(5126), 0::bigint, 'APPROVE on a VERIFIED listing writes no audit row');
select is(pg_temp.notices(5126), 0::bigint, 'APPROVE on a VERIFIED listing sends no notice');

set local role authenticated;
select is(public.fn_resolve_product_verdict(pg_temp.mu(5127), 'REJECT', 'New reason'), true,
  'REJECT on a REJECTED listing returns true');
reset role;
select is(pg_temp.lock_of(5127), '-|-', 'REJECT on a REJECTED listing releases the lock');
select is(pg_temp.core(5127), (select v from pg_temp.before_core where n = 5127),
  'REJECT on a REJECTED listing keeps its rejection reason and updated_at');
select is(pg_temp.audits(5127) + pg_temp.notices(5127), 0::bigint,
  'REJECT on a REJECTED listing writes no audit row and sends no notice');

-- APPROVE without a public note; a blank private note is not stored -------------
select pg_temp.remember(array[5129]);
set local role authenticated;
select is(public.fn_resolve_product_verdict(pg_temp.mu(5129), 'APPROVE', null, '   '), true,
  'APPROVE returns true');
reset role;
select is(pg_temp.core(5129) || '|' || pg_temp.lock_of(5129),
  'VERIFIED|-|' || now()::text || '|' || now()::text || '|-|-',
  'APPROVE sets VERIFIED, clears the rejection reason and the lock, stamps verified_at and updated_at');
select is(pg_temp.audit_row(5129),
  pg_temp.mu(5101)::text || '|PRODUCT_APPROVE|' || pg_temp.details(5129, null, 'APPROVE'),
  'APPROVE writes one PRODUCT_APPROVE audit row for the admin');
select is(pg_temp.notices(5129), 1::bigint, 'APPROVE sends exactly one notice');
select is(pg_temp.notice_row(5129),
  pg_temp.mu(5102)::text || '|product.approved|success|Producto Verificado|'
    || '¡Felicidades! Tu producto "Test GPU" ha sido aprobado por moderación.|/product/'
    || pg_temp.mu(5129)::text || '|read:false|' || pg_temp.payload(5129) || '|key_ok:true',
  'APPROVE without a note sends the seller an unread product.approved notice keyed by the audit row');
select is(pg_temp.seller_notes(), (select substring(v from 'notes:(\d+)$')::bigint from pg_temp.sig where n = 5129),
  'a blank private note is not stored');

-- APPROVE with a public note and a private note --------------------------------
set local role authenticated;
select is(public.fn_resolve_product_verdict(pg_temp.mu(5130), 'APPROVE', '  Check the fan  ', '  Blurry photos  '), true,
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

-- REJECT with and without a public note ----------------------------------------
set local role authenticated;
select is(public.fn_resolve_product_verdict(pg_temp.mu(5131), 'REJECT', '  Serial number missing  '), true,
  'REJECT returns true');
reset role;
select is(pg_temp.core(5131) || '|' || pg_temp.lock_of(5131),
  'REJECTED|Serial number missing|-|' || now()::text || '|-|-',
  'REJECT sets REJECTED with the trimmed reason, clears the lock and stamps updated_at');
select is(pg_temp.audit_row(5131),
  pg_temp.mu(5101)::text || '|PRODUCT_REJECT|' || pg_temp.details(5131, 'Serial number missing', 'REJECT'),
  'REJECT writes one PRODUCT_REJECT audit row for the admin');
select is(pg_temp.notice_row(5131),
  pg_temp.mu(5102)::text || '|product.rejected|error|Producto Rechazado|'
    || 'Tu producto "Test GPU" ha sido rechazado. Motivo: Serial number missing|/verify/'
    || pg_temp.mu(5131)::text || '|read:false|' || pg_temp.payload(5131) || '|key_ok:true',
  'REJECT sends the seller a product.rejected notice pointing at the verification screen');

set local role authenticated;
select is(public.fn_resolve_product_verdict(pg_temp.mu(5132), 'REJECT'), true,
  'REJECT without a note returns true');
reset role;
select is(
  (select coalesce(p.rejection_reason, '-') || '|' || n.message
   from public.products p join public.notifications n on n.event_payload->>'product_id' = p.id::text
   where p.id = pg_temp.mu(5132)),
  '-|Tu producto "Test GPU" ha sido rechazado. Motivo: No especificado por el administrador.',
  'REJECT without a note leaves no reason and says so in the notice');

select * from finish();
rollback;
