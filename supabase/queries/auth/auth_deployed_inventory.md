# Export deployed auth authorization catalogs

Use [`auth_deployed_inventory.sql`](auth_deployed_inventory.sql) to collect the block-1 prerequisite: a single JSONB `inventory` row, not behavioral proof of secure auth. The original Dashboard execution failed with `42725` (`text || "char"`) in the default-ACL sort key; its catalog identifiers now use explicit `::text` casts. A subsequent Dashboard execution failed with `22023` (`ACL arrays must be one-dimensional`); both ACL expansion sites now pass NULL for empty arrays. This latest corrected diagnostic has **not executed** against PostgreSQL. No deployment, migration, function invocation, grant change, `db:types`, or runtime auth change is part of this handoff.

## Maintainer quick path

1. Confirm the intended Supabase project in Dashboard. Open SQL Editor with an authorized catalog-reading role; do not provide credentials to an agent.
2. Paste the entire SQL file and run its single SELECT. It reads catalogs only, never `auth.users`, `auth.sessions`, or business records. No transaction/deployment procedure is being tested.
3. Export the complete JSONB cell, preserving section names and empty arrays. If execution fails, return the exact error instead; missing output is not an empty/clean inventory. Check for Dashboard truncation before sharing.
4. Review and **sanitize** the output locally before sharing it through the approved private channel. Function/view/trigger definitions, defaults, constraints, policy expressions, role names and actual function settings can contain embedded secrets or personal literals even though no data tables are read. Redact values, mark redactions, and preserve signatures and structural evidence where safe. Never share credentials or unscreened output.

## Read the evidence

| Section | Meaning |
| --- | --- |
| `expected_objects` | Explicit presence flags for requested roles, schemas, public relations and `auth.users` catalog identity; helper overload counts (zero means missing within scope). |
| `roles`, `memberships`, `schemas` | Client and selected relation/function-owner capabilities, recursive parent-role memberships, schema owners and ACLs. Membership edges are evidence, not an implementation of version-specific role inheritance/SET ROLE rules. |
| `relations`, `columns`, `constraints`, `policies` | Named identity/account-boundary relations and RLS flags; their column types/defaults/ACLs; profile constraints; all policies on these named relations, including orders/shipments/disputes. No financial records. |
| `functions` | Every overload of the explicit helpers in `public`/`private`, static source matches for `profiles_private`, `is_admin`, `account_status`, and functions referenced by included triggers. Includes definitions, owner, SECURITY DEFINER, argument defaults, return type and actual `proconfig`/`search_path`. |
| `views`, `triggers` | Project views directly dependent on public `profiles_private` via rewrite catalogs plus `admin_user_directory_view`; all triggers on `auth.users` and public profiles/private profiles, including internal/disabled triggers and their function definitions. |
| `raw_acls`, `effective_privileges`, `default_acls` | Shared ACL expansion and per-client schema/table/column/EXECUTE checks for anon/authenticated/service_role. View privileges use the same relation/column sections. Default ACL entries cover selected owners/ancestor roles globally and in selected schemas. |

## Limits and next step

- Empty sections are `[]`; missing roles/objects have explicit flags/counts. Missing clients have no effective-check rows, not implied denial. Private-schema absence is reported, not an execution error. Missing provisioning/email-sync triggers must be assessed against the complete trigger list and explicit helper counts, not guessed trigger names.
- `PUBLIC` ACL grants apply to everyone; PostgreSQL built-in defaults are expanded when an object ACL is null. Column ACL null means no additional column grant; effective checks include table grants. Empty explicit ACLs are preserved in the object's raw field; expansion passes NULL to `aclexplode` when cardinality is zero, producing no grants rather than inventing default grants. Configured default ACLs describe future creations, not retroactive permissions. No synthetic PUBLIC login/effective check is attempted.
- Effective privilege checks use PostgreSQL builtins and include inherited/PUBLIC privileges. Schema USAGE is reported separately: EXECUTE/table privilege alone does not prove reachability. RLS, API schema exposure, JWT identity, account-state enforcement and function logic require separate behavioral tests. An absent function-local search_path does not prove a safe ambient path.
- Static matching is **incomplete** discovery, not an exhaustive dynamic-dependency graph: dynamic SQL, indirect helpers, other schemas, parsed SQL bodies not represented by `prosrc`, Edge Functions and external callers can be missed. Source comments can create false positives. Text discovery scans only `public` and `private`, not system routines; trigger-linked functions are explicit exceptions. Views include direct dependencies only, not transitive chains.
- Local Bun tests are additive source guards, not a SQL parser or PostgreSQL execution proof. A compatible isolated PostgreSQL runner and maintainer-provided remote output remain required evidence; do not install/start infrastructure or use alternate remote credential paths for this task.

Return sanitized inventory and any errors to the block-1 audit for deployed/source reconciliation before proposing forward SQL or runtime changes. This diagnostic does not complete S4 or establish production readiness.
