-- Extensions live outside `public` (Supabase advisor lint `extension_in_public`).
-- pg_net is not relocatable, so it is installed in `extensions`; its objects
-- stay in its own `net` schema, so cron commands keep calling net.http_post.
begin;
select plan(3);

select is(
  (select n.nspname::text from pg_extension e join pg_namespace n on n.oid = e.extnamespace
   where e.extname = 'pg_net'),
  'extensions',
  'pg_net is installed in the extensions schema');

select is(
  array(select e.extname::text from pg_extension e join pg_namespace n on n.oid = e.extnamespace
        where n.nspname = 'public' order by 1),
  array[]::text[],
  'no extension is installed in public');

select has_function('net', 'http_post', array['text', 'jsonb', 'jsonb', 'jsonb', 'integer'],
  'net.http_post keeps the signature the cron jobs call');

select * from finish();
rollback;
