-- Catalog-wide schema invariants (remaining-sql-pgtap T2): no secret embedded in
-- schema objects, the legacy wallet is gone, client roles hold no TRUNCATE,
-- REFERENCES or TRIGGER, every order link names its shipment, the admin payout
-- view's integer cents, and the client grants on notifications,
-- shipment_tracking_events and shipments. scripts/guards/migration-secrets.ts
-- scans the migration files and seed.sql for the same secret patterns.
-- Runs against the local database only: `supabase start`, then `bun run test:db`.
begin;
select plan(31);

-- Same patterns as scripts/guards/migration-secrets.ts: a JWT, Stripe secret,
-- restricted and webhook keys, and a Supabase secret key.
create function pg_temp.looks_secret(p_text text) returns boolean language sql as $$
  select coalesce(p_text, '') ~ (
    'eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}'
    || '|sk_(live|test)_[A-Za-z0-9]|rk_(live|test)_[A-Za-z0-9]'
    || '|whsec_[A-Za-z0-9]|sb_secret_[A-Za-z0-9]')
$$;

-- Our functions in public and internal; extension members are not ours.
create temporary view own_functions as
select p.oid, n.nspname, p.proname, p.prosrc
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname in ('public', 'internal')
  and not exists (
    select 1 from pg_depend d
    where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e'
  );

-- Embedded secrets -------------------------------------------------------------

select is_empty(
  $$select nspname || '.' || proname from own_functions
    where pg_temp.looks_secret(prosrc) order by 1$$,
  'no function body in public or internal carries a secret');
select is_empty(
  $$select tgrelid::regclass::text || '.' || tgname from pg_trigger
    where not tgisinternal and pg_temp.looks_secret(encode(tgargs, 'escape'))
    order by 1$$,
  'no trigger argument carries a secret');
select is_empty(
  $$select srvname from pg_foreign_server
    where pg_temp.looks_secret(array_to_string(srvoptions, ',')) order by 1$$,
  'no foreign server option carries a secret');
select hasnt_schema('stripe', 'the Stripe foreign data wrapper schema is gone');
select is_empty(
  $$select tgrelid::regclass::text from pg_trigger
    where tgname = 'tr_webhook_order_completed'$$,
  'the order webhook trigger that carried a service_role JWT is gone');
select is_empty(
  $$select srvname from pg_foreign_server where srvname = 'stripe_server'$$,
  'the stripe_server foreign server is gone');

-- Legacy wallet ----------------------------------------------------------------

select hasnt_table('public', 'wallets', 'wallets is gone');
select hasnt_table('public', 'wallet_transactions', 'wallet_transactions is gone');
select hasnt_table('public', 'payout_requests', 'payout_requests is gone');
select hasnt_table('public', 'seller_bank_accounts', 'seller_bank_accounts is gone');
select hasnt_table('public', 'mexico_banks', 'mexico_banks is gone');
select hasnt_type('public', 'wallet_transaction_type', 'wallet_transaction_type is gone');
select hasnt_view('public', 'admin_payments_overview', 'admin_payments_overview is gone');
select hasnt_function('public', 'fn_request_payout', 'fn_request_payout is gone');
select hasnt_function('public', 'fn_save_bank_account', 'fn_save_bank_account is gone');
select hasnt_function('public', 'fn_cron_release_shipment_funds',
  'fn_cron_release_shipment_funds is gone');
select hasnt_column('public', 'system_settings', 'connect_enabled',
  'system_settings.connect_enabled is gone');
-- Identifiers only: the result code CONNECT_SHIPMENT_SKIPPED_WALLET and log
-- text such as "deprecated wallet release" do not match.
select is_empty(
  $$select kind || ' ' || name from (
      select 'function' as kind, nspname || '.' || proname as name, prosrc as body
      from own_functions
      union all
      select 'view', schemaname || '.' || viewname, definition
      from pg_views where schemaname in ('public', 'internal')
    ) objects
    where body ~ ('\m(wallets|wallet_transactions|wallet_transaction_type'
      || '|payout_requests|seller_bank_accounts|mexico_banks|fn_request_payout'
      || '|fn_save_bank_account|fn_cron_release_shipment_funds'
      || '|admin_payments_overview|connect_enabled)\M')
    order by 1$$,
  'no function or view in public or internal references a wallet object');

-- Client table privileges -------------------------------------------------------

-- #305 revoked the default grants (#122); client_grants.test.sql holds the
-- exact client matrix.
select is_empty(
  $$select r.rolname || ' ' || c.relname || ' ' || p.privilege
    from pg_class c
    cross join (values ('anon'), ('authenticated')) r(rolname)
    cross join (values ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) p(privilege)
    where c.relnamespace = 'public'::regnamespace
      and c.relkind in ('r', 'p', 'v', 'm', 'f')
      and has_table_privilege(r.rolname, c.oid, p.privilege)
    order by 1$$,
  'anon and authenticated hold no TRUNCATE, REFERENCES or TRIGGER on any public relation');

-- Order links -------------------------------------------------------------------

-- fn_create_shipments_from_single_payment sends order.payment_confirmed for the
-- whole multi-seller order, to the buyer and every seller, so its link names
-- the order only. Reported to the maintainer in remaining-sql-pgtap T2.
select is_empty(
  $$select proname from own_functions
    where nspname = 'public'
      and proname <> 'fn_create_shipments_from_single_payment'
      and (select count(*) from regexp_matches(prosrc, '/profile/orders/', 'g'))
        > (select count(*) from regexp_matches(prosrc, '\?shipment_id=', 'g'))
    order by 1$$,
  'every /profile/orders/ link in a function body names its shipment');

-- Admin payout view ------------------------------------------------------------

select col_type_is('public', 'admin_connect_payout_release_view', 'release_amount_cents',
  'integer', 'admin_connect_payout_release_view.release_amount_cents is integer cents');

-- Client grants on notifications and shipment_tracking_events -------------------

select results_eq(
  $$select r.rolname, a.attname::text collate "default"
    from pg_attribute a
    cross join (values ('anon'), ('authenticated')) r(rolname)
    where a.attrelid = 'public.notifications'::regclass
      and a.attnum > 0 and not a.attisdropped
      and has_column_privilege(r.rolname, a.attrelid, a.attnum, 'UPDATE')
    order by 1, 2$$,
  $$values ('authenticated', 'deleted_at'), ('authenticated', 'read')$$,
  'authenticated may update only notifications.read and deleted_at; anon none');
select results_eq(
  $$select r.rolname, p.privilege
    from (values ('anon'), ('authenticated')) r(rolname)
    cross join (values ('DELETE'), ('INSERT'), ('SELECT')) p(privilege)
    where case p.privilege
      when 'DELETE' then has_table_privilege(r.rolname, 'public.notifications', 'DELETE')
      else has_any_column_privilege(r.rolname, 'public.notifications', p.privilege)
    end
    order by 1, 2$$,
  $$values ('authenticated', 'SELECT')$$,
  'on notifications, client roles only read, and only authenticated');
select results_eq(
  $$select r.rolname, p.privilege
    from (values ('anon'), ('authenticated')) r(rolname)
    cross join (values ('DELETE'), ('INSERT'), ('SELECT'), ('UPDATE')) p(privilege)
    where case p.privilege
      when 'DELETE' then has_table_privilege(r.rolname, 'public.shipment_tracking_events', 'DELETE')
      else has_any_column_privilege(r.rolname, 'public.shipment_tracking_events', p.privilege)
    end
    order by 1, 2$$,
  $$values ('authenticated', 'SELECT')$$,
  'on shipment_tracking_events, only authenticated reads and no client role writes');

-- Shipments are written by server functions only --------------------------------

select is_empty(
  $$select r.rolname || ' ' || p.privilege
    from (values ('anon'), ('authenticated')) r(rolname)
    cross join (values ('DELETE'), ('INSERT'), ('UPDATE')) p(privilege)
    where case p.privilege
      when 'DELETE' then has_table_privilege(r.rolname, 'public.shipments', 'DELETE')
      else has_any_column_privilege(r.rolname, 'public.shipments', p.privilege)
    end
    order by 1$$,
  'anon and authenticated cannot insert, update or delete shipments');
select ok(
  has_table_privilege('authenticated', 'public.shipments', 'SELECT'),
  'authenticated keeps SELECT on shipments');
select ok(
  (select relrowsecurity from pg_class where oid = 'public.shipments'::regclass),
  'shipments has row level security enabled');
-- The live shipments_insert_block and shipments_delete_block policies are
-- permissive with a constant false expression; they let nothing through.
select is_empty(
  $$select policyname from pg_policies
    where schemaname = 'public' and tablename = 'shipments'
      and permissive = 'PERMISSIVE'
      and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
      and (coalesce(qual, 'false') <> 'false'
        or coalesce(with_check, 'false') <> 'false')
    order by 1$$,
  'no shipments write policy lets a row through');

-- Cron flags replaced by expiring leases ----------------------------------------

select hasnt_column('public', 'system_settings', 'auto_cancel_orders_running',
  'system_settings.auto_cancel_orders_running is gone (lease since B3)');
select hasnt_column('public', 'system_settings', 'auto_cancel_preparing_running',
  'system_settings.auto_cancel_preparing_running is gone (lease since B3)');
select hasnt_column('public', 'system_settings', 'checkout_recovery_running',
  'system_settings.checkout_recovery_running is gone (lease since BL13)');

select * from finish();
rollback;
