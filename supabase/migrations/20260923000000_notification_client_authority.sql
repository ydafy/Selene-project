-- N4b: legacy client authority cutover. Apply before N4a and N5a.
-- Submit the entire file as one Dashboard transaction only after verifying that
-- execution mode; on uncertainty ROLLBACK and inspect, never blindly retry.
-- Inventory basis: deployed catalog queries 01-11 and trigger query 12 (PG 17.6).
-- This does not certify deployed RPC bodies or older clients: confirm compatibility
-- and deployed privileged writers independently before manual deployment.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

LOCK TABLE public.notifications IN ACCESS EXCLUSIVE MODE;
DO $$
DECLARE
  relation_oid oid := 'public.notifications'::regclass;
  expected_columns text[] := ARRAY['id','created_at','user_id','type','title','message','read','action_path','deleted_at'];
  rpc text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE c.oid = relation_oid AND n.nspname = 'public' AND c.relname = 'notifications'
      AND c.relkind = 'r' AND c.relrowsecurity AND NOT c.relforcerowsecurity
  ) OR (SELECT array_agg(a.attname ORDER BY a.attnum) FROM pg_catalog.pg_attribute a
        WHERE a.attrelid = relation_oid AND a.attnum > 0 AND NOT a.attisdropped)
     IS DISTINCT FROM expected_columns THEN
    RAISE EXCEPTION 'Unexpected legacy notifications relation or column shape';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a WHERE a.attrelid = relation_oid
             AND a.attnum > 0 AND NOT a.attisdropped AND a.attacl IS NOT NULL) THEN
    RAISE EXCEPTION 'Unexpected notification column ACL';
  END IF;
  IF (SELECT count(*) FROM pg_catalog.pg_policy WHERE polrelid = relation_oid) <> 1
     OR NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_policy p WHERE p.polrelid = relation_oid
         AND p.polname = 'notifications_all' AND p.polcmd = '*'
         AND p.polpermissive AND p.polroles = ARRAY[0::oid]
         AND p.polwithcheck IS NULL
         AND pg_catalog.pg_get_expr(p.polqual, p.polrelid) = '(( SELECT auth.uid() AS uid) = user_id)'
     ) THEN
    RAISE EXCEPTION 'Unexpected notification policy';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_class c
    CROSS JOIN LATERAL pg_catalog.aclexplode(c.relacl) acl
    WHERE c.oid = relation_oid AND (
      acl.grantee NOT IN (SELECT oid FROM pg_catalog.pg_roles WHERE rolname IN ('postgres','service_role','anon','authenticated'))
      OR acl.privilege_type NOT IN ('SELECT','INSERT','UPDATE','DELETE','REFERENCES','TRIGGER','TRUNCATE','MAINTAIN')
      OR acl.is_grantable
    )
  ) OR NOT has_schema_privilege('anon','public','USAGE')
     OR NOT has_schema_privilege('authenticated','public','USAGE')
     OR NOT has_table_privilege('service_role', relation_oid, 'INSERT')
     OR NOT has_table_privilege('anon', relation_oid, 'INSERT')
     OR NOT has_table_privilege('authenticated', relation_oid, 'INSERT') THEN
    RAISE EXCEPTION 'Unexpected notification schema or table grants';
  END IF;
  -- Keep every existing RPC EXECUTE ACL unchanged. Verify deployed signatures,
  -- not source bodies; the inventory showed these service-only and two client RPCs.
  FOREACH rpc IN ARRAY ARRAY[
    'fn_cancel_order(uuid,text,text)', 'fn_cancel_shipment(uuid,text,text,bigint)',
    'fn_complete_shipment_refund(uuid)', 'fn_create_order_from_payment(uuid,text,numeric,numeric,uuid,uuid[])',
    'fn_create_shipments_from_single_payment(text,text,bigint,text,jsonb)',
    'fn_cron_dispute_payout_timeout()', 'fn_cron_dispute_shipping_timeout()',
    'fn_cron_return_delivery_timeout()', 'fn_mark_return_delivered(uuid)',
    'fn_request_payout(numeric,uuid)', 'fn_resolve_dispute_to_buyer(uuid,text)',
    'fn_resolve_dispute_to_seller(uuid,text)', 'fn_resolve_product_verdict(uuid,text,text,text)',
    'fn_seller_submit_return_evidence(uuid,text[],text)'
  ] LOOP
    IF to_regprocedure('public.' || rpc) IS NULL
       OR NOT has_function_privilege('service_role', to_regprocedure('public.' || rpc), 'EXECUTE')
       OR has_function_privilege('anon', to_regprocedure('public.' || rpc), 'EXECUTE')
       OR has_function_privilege('authenticated', to_regprocedure('public.' || rpc), 'EXECUTE')
          IS DISTINCT FROM (rpc IN ('fn_request_payout(numeric,uuid)', 'fn_resolve_product_verdict(uuid,text,text,text)')) THEN
      RAISE EXCEPTION 'Notification-relevant RPC EXECUTE differs: %', rpc;
    END IF;
  END LOOP;
END;
$$;

REVOKE ALL ON TABLE public.notifications FROM PUBLIC, anon, authenticated;
DROP POLICY notifications_all ON public.notifications;
GRANT SELECT ON TABLE public.notifications TO authenticated;
GRANT UPDATE (read, deleted_at) ON public.notifications TO authenticated;
CREATE POLICY notifications_owner_select ON public.notifications FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);
CREATE POLICY notifications_owner_update ON public.notifications FOR UPDATE TO authenticated USING ((SELECT auth.uid()) = user_id) WITH CHECK ((SELECT auth.uid()) = user_id);

DO $$
DECLARE
  role_name text;
  privilege_name text;
  column_name text;
BEGIN
  IF NOT has_table_privilege('service_role', 'public.notifications', 'INSERT')
     OR NOT has_function_privilege('service_role', 'public.fn_create_shipments_from_single_payment(text,text,bigint,text,jsonb)', 'EXECUTE')
     OR (SELECT count(*) FROM pg_catalog.pg_policy WHERE polrelid = 'public.notifications'::regclass) <> 2
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_policy WHERE polrelid = 'public.notifications'::regclass
                AND (polname NOT IN ('notifications_owner_select','notifications_owner_update')
                     OR polroles <> ARRAY[(SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'authenticated')])) THEN
    RAISE EXCEPTION 'Notification authority postcondition failed';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_policy p WHERE p.polrelid = 'public.notifications'::regclass
    AND p.polname = 'notifications_owner_select' AND p.polcmd = 'r' AND p.polpermissive
    AND pg_catalog.pg_get_expr(p.polqual, p.polrelid) = '(( SELECT auth.uid() AS uid) = user_id)'
    AND p.polwithcheck IS NULL)
    OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_policy p WHERE p.polrelid = 'public.notifications'::regclass
    AND p.polname = 'notifications_owner_update' AND p.polcmd = 'w' AND p.polpermissive
    AND pg_catalog.pg_get_expr(p.polqual, p.polrelid) = '(( SELECT auth.uid() AS uid) = user_id)'
    AND pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid) = '(( SELECT auth.uid() AS uid) = user_id)') THEN
    RAISE EXCEPTION 'Notification owner policies differ';
  END IF;
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
    FOREACH privilege_name IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE','REFERENCES','TRIGGER','TRUNCATE','MAINTAIN'] LOOP
      IF has_table_privilege(role_name, 'public.notifications', privilege_name)
         IS DISTINCT FROM (role_name = 'authenticated' AND privilege_name = 'SELECT') THEN
        RAISE EXCEPTION 'Unexpected effective table privilege: % %', role_name, privilege_name;
      END IF;
    END LOOP;
    FOR column_name IN SELECT attname FROM pg_catalog.pg_attribute
      WHERE attrelid = 'public.notifications'::regclass AND attnum > 0 AND NOT attisdropped
    LOOP
      FOREACH privilege_name IN ARRAY ARRAY['SELECT','INSERT','UPDATE','REFERENCES'] LOOP
        IF has_column_privilege(role_name, 'public.notifications', column_name, privilege_name)
           IS DISTINCT FROM (role_name = 'authenticated' AND
             (privilege_name = 'SELECT' OR (privilege_name = 'UPDATE' AND column_name IN ('read','deleted_at')))) THEN
          RAISE EXCEPTION 'Unexpected effective column privilege: % % %', role_name, column_name, privilege_name;
        END IF;
      END LOOP;
    END LOOP;
  END LOOP;
END;
$$;
COMMIT;
