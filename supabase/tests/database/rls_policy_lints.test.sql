-- RLS policy lints (#310 T2, S7): the Supabase performance advisor's
-- `auth_rls_initplan` and `multiple_permissive_policies` checks, so CI fails
-- before the advisor does. Reads the catalog only; needs no rows.
-- Runs against the local database only: `supabase start`, then `bun run test:db`.
begin;
select plan(2);

-- (a) A policy calls auth.uid(), auth.jwt(), auth.role(), current_setting()
-- or is_admin() only inside `( SELECT ... )`, so Postgres evaluates it once
-- per statement (an initplan) instead of once per row. Every bare call must
-- be matched by a wrapped one; the deparse writes the wrapper as
-- `( SELECT auth.uid() AS uid)`. The schema prefix of is_admin() depends on
-- the session search_path, so it is optional.
select is(
  (
    select coalesce(array_agg(distinct format('%s.%s: %s', p.schemaname, p.tablename, p.policyname)
             order by format('%s.%s: %s', p.schemaname, p.tablename, p.policyname)), '{}')
    from pg_policies p
    cross join (
      values ('\mauth\.uid\('), ('\mauth\.jwt\('), ('\mauth\.role\('),
             ('\mcurrent_setting\('), ('(\mpublic\.)?\mis_admin\(')
    ) f(pattern)
    cross join lateral (values (coalesce(p.qual, '')), (coalesce(p.with_check, ''))) e(expr)
    where p.schemaname in ('public', 'storage')
      and regexp_count(e.expr, f.pattern) <> regexp_count(e.expr, '\( SELECT \(*' || f.pattern)
  ),
  '{}'::text[],
  'no policy in public or storage calls auth.*(), current_setting() or is_admin() without ( SELECT ... )'
);

-- (b) One permissive policy per table, role and command: Postgres runs every
-- permissive policy for a row, so two of them cost twice. A policy for PUBLIC
-- applies to anon and authenticated; FOR ALL counts as each command.
select is(
  (
    select coalesce(array_agg(format('%s.%s %s %s: %s', schemaname, tablename, role, command, policies)
             order by schemaname, tablename, role, command), '{}')
    from (
      select p.schemaname, p.tablename, r.role, c.command,
             string_agg(p.policyname, ', ' order by p.policyname) as policies
      from pg_policies p
      cross join lateral unnest(
        case when 'public' = any (p.roles) then array['anon', 'authenticated']::name[] else p.roles end
      ) r(role)
      cross join lateral unnest(
        case when p.cmd = 'ALL' then array['SELECT', 'INSERT', 'UPDATE', 'DELETE'] else array[p.cmd] end
      ) c(command)
      where p.schemaname in ('public', 'internal')
        and p.permissive = 'PERMISSIVE'
      group by p.schemaname, p.tablename, r.role, c.command
      having count(*) > 1
    ) d
  ),
  '{}'::text[],
  'no table in public or internal has two permissive policies for the same role and command'
);

select * from finish();
rollback;
