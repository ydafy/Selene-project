-- Product notices and the seller payment readiness read.
-- product.available: buyers who favorited a listing hear when it becomes
-- purchasable (fn_notify_product_available, trg_product_available_on_verify,
-- trg_product_available_on_connect_complete).
-- product.interest: the seller hears at 1, 5, 10 and 25 favorites while the
-- listing cannot be bought yet (fn_notify_product_interest,
-- trg_product_interest_on_favorite).
-- fn_product_seller_payment_readiness: whether a live VERIFIED listing's seller
-- can be paid.
-- Runs against the local database only: `supabase start`, then `bun run test:db`.
begin;
select plan(44);
\ir ../fixtures/money.psql

-- A seller whose Connect state is set directly; each one breaks one rule.
create function pg_temp.seller(p_n integer, p_acct text, p_onboarding text, p_status text)
returns void language plpgsql as $$
begin
  perform pg_temp.money_user(p_n);
  update public.profiles_private
  set stripe_account_id = p_acct,
    stripe_onboarding_status = p_onboarding::public.stripe_onboarding_status,
    status = p_status::public.account_status
  where id = pg_temp.mu(p_n);
end $$;

-- A listing in p_status. money_product creates it SOLD, and SOLD to anything
-- fires no notice trigger.
create function pg_temp.listing(p_n integer, p_seller integer, p_status text, p_deleted boolean default false)
returns void language plpgsql as $$
begin
  perform pg_temp.money_product(p_n, p_seller);
  update public.products
  set status = p_status::public.product_status_enum,
    deleted_at = case when p_deleted then now() end
  where id = pg_temp.mu(p_n);
end $$;

create function pg_temp.fav(p_user integer, p_product integer) returns void language sql as $$
  insert into public.favorites (user_id, product_id) values (pg_temp.mu(p_user), pg_temp.mu(p_product))
$$;

create function pg_temp.verify(p_products integer[]) returns void language sql as $$
  update public.products set status = 'VERIFIED'
  where id in (select pg_temp.mu(n) from unnest(p_products) as n)
$$;

create function pg_temp.notes(p_kind text, p_product integer) returns bigint language sql as $$
  select count(*) from public.notifications
  where event_kind = p_kind and event_payload ->> 'product_id' = pg_temp.mu(p_product)::text
$$;

create function pg_temp.note(p_key text, p_user integer) returns jsonb language sql as $$
  select jsonb_build_object('title', title, 'message', message, 'type', type, 'read', read,
    'action_path', action_path, 'payload', event_payload, 'kind', event_kind)
  from public.notifications where source_event_key = p_key and user_id = pg_temp.mu(p_user)
$$;

create function pg_temp.milestones(p_product integer) returns text language sql as $$
  select coalesce(string_agg(event_payload ->> 'milestone', ',' order by (event_payload ->> 'milestone')::integer), '')
  from public.notifications
  where event_kind = 'product.interest' and event_payload ->> 'product_id' = pg_temp.mu(p_product)::text
$$;

create function pg_temp.ready_of(p_product integer) returns text language sql as $$
  select coalesce(
    (select r.seller_accepts_payments::text from public.fn_product_seller_payment_readiness(array[pg_temp.mu(p_product)]) r),
    'absent')
$$;

-- Sellers: 7601 can be paid; 7602 no Stripe account; 7603 onboarding pending
-- (completes later); 7604 suspended; 7605 banned; 7606 status NULL (counts as
-- OK); 7607 onboarding rejected. Buyers: 7611-7640.
select pg_temp.seller(7601, 'acct_t6_1', 'complete', 'active');
select pg_temp.seller(7602, null, 'complete', 'active');
select pg_temp.seller(7603, 'acct_t6_3', 'pending', 'active');
select pg_temp.seller(7604, 'acct_t6_4', 'complete', 'suspended');
select pg_temp.seller(7605, 'acct_t6_5', 'complete', 'banned');
select pg_temp.seller(7606, 'acct_t6_6', 'complete', null);
select pg_temp.seller(7607, 'acct_t6_7', 'rejected', 'active');
select pg_temp.money_user(n) from generate_series(7611, 7640) as n;

-- product.available: the verify trigger

select pg_temp.listing(7701, 7601, 'PENDING_VERIFICATION');
select pg_temp.fav(7611, 7701), pg_temp.fav(7612, 7701), pg_temp.fav(7601, 7701);
select pg_temp.verify(array[7701]);

select is(pg_temp.notes('product.available', 7701), 2::bigint,
  'PENDING_VERIFICATION to VERIFIED notifies each favoriter once');
select is((select count(*) from public.notifications where event_kind = 'product.available' and user_id = pg_temp.mu(7601)),
  0::bigint, 'the seller never gets product.available, even with a favorite on the listing');
select is(pg_temp.note('product.available:' || pg_temp.mu(7701), 7611),
  jsonb_build_object('title', '¡Ya puedes comprarlo!', 'message', 'Test GPU ya está disponible en Selene.',
    'type', 'success', 'read', false, 'action_path', '/product/' || pg_temp.mu(7701),
    'payload', jsonb_build_object('product_id', pg_temp.mu(7701), 'recipient_role', 'buyer'),
    'kind', 'product.available'),
  'the buyer notice has the copy, link, type and payload');

update public.products set status = 'IN_REVIEW' where id = pg_temp.mu(7701);
select lives_ok($$ update public.products set status = 'VERIFIED' where id = pg_temp.mu(7701) $$,
  'verifying the listing again does not fail on the notice key');
select is(pg_temp.notes('product.available', 7701), 2::bigint,
  'verifying again writes no second notice per buyer');

select pg_temp.listing(7702, 7601, 'IN_REVIEW');
select pg_temp.fav(7611, 7702);
select pg_temp.verify(array[7702]);
select is(pg_temp.notes('product.available', 7702), 1::bigint, 'IN_REVIEW to VERIFIED notifies');

select pg_temp.listing(7703, 7601, 'HIDDEN');
select pg_temp.listing(7704, 7601, 'RESERVED');
select pg_temp.listing(7705, 7601, 'REJECTED');
select pg_temp.listing(7706, 7601, 'IN_DISPUTE');
select pg_temp.fav(7611, n) from generate_series(7703, 7706) as n;
select pg_temp.verify(array[7703, 7704, 7705, 7706]);
select is((select sum(pg_temp.notes('product.available', n)) from generate_series(7703, 7706) as n), 0::numeric,
  'HIDDEN, RESERVED, REJECTED or IN_DISPUTE to VERIFIED notifies nobody');

select pg_temp.listing(7707, 7602, 'PENDING_VERIFICATION');
select pg_temp.listing(7708, 7607, 'PENDING_VERIFICATION');
select pg_temp.listing(7709, 7604, 'PENDING_VERIFICATION');
select pg_temp.listing(7710, 7605, 'PENDING_VERIFICATION');
select pg_temp.listing(7711, 7606, 'PENDING_VERIFICATION');
select pg_temp.fav(7611, n) from generate_series(7707, 7711) as n;
select pg_temp.verify(array[7707, 7708, 7709, 7710, 7711]);
select is(pg_temp.notes('product.available', 7707), 0::bigint, 'a seller without a Stripe account: no notice');
select is(pg_temp.notes('product.available', 7708), 0::bigint, 'a seller whose onboarding is not complete: no notice');
select is(pg_temp.notes('product.available', 7709), 0::bigint, 'a suspended seller: no notice');
select is(pg_temp.notes('product.available', 7710), 0::bigint, 'a banned seller: no notice');
select is(pg_temp.notes('product.available', 7711), 1::bigint, 'a seller with a NULL account status is notified for');

-- product.available: the helper filters what it is given

select pg_temp.listing(7712, 7601, 'VERIFIED', true);
select pg_temp.listing(7713, 7601, 'PENDING_VERIFICATION');
select pg_temp.fav(7611, 7712), pg_temp.fav(7611, 7713);
select public.fn_notify_product_available(array[pg_temp.mu(7712), pg_temp.mu(7713)]);
select is(pg_temp.notes('product.available', 7712), 0::bigint, 'a deleted listing notifies nobody');
select is(pg_temp.notes('product.available', 7713), 0::bigint, 'a listing that is not VERIFIED notifies nobody');

-- product.available: the Connect trigger

select pg_temp.listing(7714, 7603, 'VERIFIED');
select pg_temp.fav(7611, 7714);
update public.profiles_private set stripe_onboarding_status = 'complete' where id = pg_temp.mu(7603);
select is(pg_temp.notes('product.available', 7714), 1::bigint,
  'onboarding becoming complete notifies favoriters of the seller''s VERIFIED listings');

select pg_temp.listing(7717, 7601, 'VERIFIED');
select pg_temp.fav(7611, 7717);
update public.profiles_private set stripe_onboarding_status = 'complete' where id = pg_temp.mu(7601);
select is(pg_temp.notes('product.available', 7717), 0::bigint,
  'an onboarding update that was already complete notifies nobody');

-- product.interest

select pg_temp.listing(7721, 7601, 'PENDING_VERIFICATION');
select pg_temp.fav(7611, 7721);
select is(pg_temp.note('product.interest:' || pg_temp.mu(7721) || ':1', 7601),
  jsonb_build_object('title', 'Tu producto genera interés',
    'message', 'Alguien guardó tu Test GPU en favoritos. Envía tus pruebas para empezar a venderlo.',
    'type', 'info', 'read', false, 'action_path', '/verify/' || pg_temp.mu(7721),
    'payload', jsonb_build_object('product_id', pg_temp.mu(7721), 'recipient_role', 'seller', 'milestone', 1),
    'kind', 'product.interest'),
  'the first favorite of a PENDING_VERIFICATION listing sends the seller the milestone 1 notice');

select pg_temp.fav(7601, 7721), pg_temp.fav(7612, 7721), pg_temp.fav(7613, 7721), pg_temp.fav(7614, 7721);
select is(pg_temp.milestones(7721), '1', 'four buyers plus the seller''s own favorite do not reach milestone 5');

select pg_temp.fav(7615, 7721);
select is(pg_temp.note('product.interest:' || pg_temp.mu(7721) || ':5', 7601),
  jsonb_build_object('title', '¡Ya son 5 personas interesadas!',
    'message', '5 personas guardaron tu Test GPU en favoritos. Envía tus pruebas para empezar a venderlo.',
    'type', 'info', 'read', false, 'action_path', '/verify/' || pg_temp.mu(7721),
    'payload', jsonb_build_object('product_id', pg_temp.mu(7721), 'recipient_role', 'seller', 'milestone', 5),
    'kind', 'product.interest'),
  'the fifth buyer sends the milestone 5 notice');

delete from public.favorites where product_id = pg_temp.mu(7721) and user_id = pg_temp.mu(7615);
select pg_temp.fav(7615, 7721);
select is(pg_temp.milestones(7721), '1,5', 'crossing a milestone again writes no second notice');

select pg_temp.listing(7722, 7601, 'IN_REVIEW');
insert into public.favorites (user_id, product_id)
select pg_temp.mu(n), pg_temp.mu(7722) from generate_series(7611, 7622) as n;
select is(pg_temp.milestones(7722), '10', 'twelve favorites at once send only the highest milestone crossed');
insert into public.favorites (user_id, product_id)
select pg_temp.mu(n), pg_temp.mu(7722) from generate_series(7623, 7636) as n;
select is(pg_temp.milestones(7722), '10,25', 'reaching 26 favorites adds milestone 25');
select is(pg_temp.note('product.interest:' || pg_temp.mu(7722) || ':10', 7601),
  jsonb_build_object('title', '¡Ya son 10 personas interesadas!',
    'message', '10 personas guardaron tu Test GPU en favoritos. Lo estamos revisando; te avisaremos al terminar.',
    'type', 'info', 'read', false, 'action_path', '/profile/listings',
    'payload', jsonb_build_object('product_id', pg_temp.mu(7722), 'recipient_role', 'seller', 'milestone', 10),
    'kind', 'product.interest'),
  'an IN_REVIEW listing links to the seller''s listings');

select pg_temp.listing(7723, 7602, 'VERIFIED');
select pg_temp.fav(7611, 7723);
select is(pg_temp.note('product.interest:' || pg_temp.mu(7723) || ':1', 7602),
  jsonb_build_object('title', 'Tu producto genera interés',
    'message', 'Alguien guardó tu Test GPU en favoritos. Activa tus pagos para poder venderlo.',
    'type', 'info', 'read', false, 'action_path', '/sell/onboarding',
    'payload', jsonb_build_object('product_id', pg_temp.mu(7723), 'recipient_role', 'seller', 'milestone', 1),
    'kind', 'product.interest'),
  'a VERIFIED listing of a seller without a Stripe account links to onboarding');

select pg_temp.listing(7724, 7607, 'VERIFIED');
select pg_temp.listing(7725, 7604, 'VERIFIED');
select pg_temp.listing(7726, 7605, 'VERIFIED');
select pg_temp.listing(7727, 7601, 'VERIFIED');
select pg_temp.listing(7728, 7606, 'VERIFIED');
select pg_temp.fav(7611, n) from generate_series(7724, 7728) as n;
select is(pg_temp.milestones(7724), '1', 'VERIFIED with onboarding not complete: the seller is notified');
select is(pg_temp.milestones(7725), '1', 'VERIFIED with a suspended seller: the seller is notified');
select is(pg_temp.milestones(7726), '1', 'VERIFIED with a banned seller: the seller is notified');
select is(pg_temp.milestones(7727), '', 'VERIFIED with a seller who can be paid: no notice');
select is(pg_temp.milestones(7728), '', 'VERIFIED with a NULL account status and Connect complete: no notice');

select pg_temp.listing(7729, 7602, 'SOLD');
select pg_temp.listing(7730, 7602, 'REJECTED');
select pg_temp.listing(7731, 7602, 'HIDDEN');
select pg_temp.listing(7732, 7602, 'RESERVED');
select pg_temp.listing(7733, 7602, 'IN_DISPUTE');
select pg_temp.listing(7734, 7602, 'PENDING_VERIFICATION', true);
select pg_temp.fav(7611, n) from generate_series(7729, 7734) as n;
select is((select string_agg(pg_temp.milestones(n), '') from generate_series(7729, 7733) as n), '',
  'SOLD, REJECTED, HIDDEN, RESERVED and IN_DISPUTE listings send no interest notice');
select is(pg_temp.milestones(7734), '', 'a deleted listing sends no interest notice');

select is((
  select count(*) from public.notifications n
  join public.favorites f on f.product_id::text = n.event_payload ->> 'product_id'
  join public.profiles pr on pr.id = f.user_id and f.user_id <> n.user_id
  where n.event_kind = 'product.interest' and n.user_id in (pg_temp.mu(7601), pg_temp.mu(7602))
    and concat_ws('|', n.title, n.message, n.action_path, n.event_payload::text)
      ~ (f.user_id::text || '|' || pr.username)
), 0::bigint, 'no interest notice names a favoriter by id or username');

-- A failing seller notice never blocks the buyer's favorite. The failure is a
-- trigger on notifications created inside a subtransaction that is rolled
-- back (with its lock) before the assertions.
select pg_temp.listing(7735, 7601, 'PENDING_VERIFICATION');
create temp table interest_failure (error text, favorites bigint, notices bigint);
do $$
declare
  v_favorites bigint;
  v_notices bigint;
begin
  begin
    create function public.t6_fail_interest_notice() returns trigger language plpgsql as $f$
    begin
      if new.event_kind = 'product.interest' then raise exception 't6 notice failure'; end if;
      return new;
    end $f$;
    create trigger t6_fail_interest_notice before insert on public.notifications
      for each row execute function public.t6_fail_interest_notice();
    perform pg_temp.fav(7611, 7735);
    select count(*) into v_favorites from public.favorites where product_id = pg_temp.mu(7735);
    v_notices := pg_temp.notes('product.interest', 7735);
    raise exception 't6 undo';
  exception when others then
    insert into interest_failure values (sqlerrm, v_favorites, v_notices);
  end;
end $$;
select is((select error from interest_failure), 't6 undo', 'the favorite insert succeeds while the notice fails');
select is((select favorites || '/' || notices from interest_failure), '1/0',
  'the favorite is stored and the failed notice is not');

-- fn_product_seller_payment_readiness

select pg_temp.listing(7741, 7601, 'VERIFIED');
select pg_temp.listing(7742, 7602, 'VERIFIED');
select pg_temp.listing(7743, 7607, 'VERIFIED');
select pg_temp.listing(7744, 7604, 'VERIFIED');
select pg_temp.listing(7745, 7605, 'VERIFIED');
select pg_temp.listing(7746, 7606, 'VERIFIED');
select pg_temp.listing(7747, 7601, 'PENDING_VERIFICATION');
select pg_temp.listing(7748, 7601, 'IN_REVIEW');
select pg_temp.listing(7749, 7601, 'SOLD');
select pg_temp.listing(7750, 7601, 'RESERVED');
select pg_temp.listing(7751, 7601, 'VERIFIED', true);

select is(pg_temp.ready_of(7741), 'true', 'a seller with Connect complete and an active account accepts payments');
select is(pg_temp.ready_of(7742), 'false', 'a seller without a Stripe account does not');
select is(pg_temp.ready_of(7743), 'false', 'a seller whose onboarding is not complete does not');
select is(pg_temp.ready_of(7744), 'false', 'a suspended seller does not');
select is(pg_temp.ready_of(7745), 'false', 'a banned seller does not');
select is(pg_temp.ready_of(7746), 'true', 'a NULL account status counts as active');
select is((select count(*) from public.fn_product_seller_payment_readiness(
    array[pg_temp.mu(7747), pg_temp.mu(7748), pg_temp.mu(7749), pg_temp.mu(7750)])),
  0::bigint, 'listings that are not VERIFIED get no row');
select is(pg_temp.ready_of(7751), 'absent', 'a deleted listing gets no row');
select is((select count(*) from public.fn_product_seller_payment_readiness(
    array(select gen_random_uuid() from generate_series(1, 49)) || pg_temp.mu(7741))),
  1::bigint, 'the 50th id is read');
select is((select count(*) from public.fn_product_seller_payment_readiness(
    array(select gen_random_uuid() from generate_series(1, 50)) || pg_temp.mu(7741))),
  0::bigint, 'ids past the 50th are ignored without an error');

select * from finish();
rollback;
