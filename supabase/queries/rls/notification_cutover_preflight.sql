-- Supplemental, read-only catalog evidence; not an authorization to migrate.
SELECT jsonb_build_object(
  'relation', (SELECT jsonb_build_object('exists', true, 'kind', c.relkind,
    'rls', c.relrowsecurity, 'force_rls', c.relforcerowsecurity,
    'estimated_rows', c.reltuples::bigint, 'table_bytes', pg_catalog.pg_relation_size(c.oid))
    FROM pg_catalog.pg_class c WHERE c.oid = to_regclass('public.notifications')),
  'columns', (SELECT coalesce(jsonb_agg(jsonb_build_object('name', a.attname,
    'type', pg_catalog.format_type(a.atttypid,a.atttypmod), 'not_null', a.attnotnull,
    'has_default', d.oid IS NOT NULL) ORDER BY a.attnum), '[]'::jsonb)
    FROM pg_catalog.pg_attribute a LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
    WHERE a.attrelid=to_regclass('public.notifications') AND a.attnum>0 AND NOT a.attisdropped),
  'metadata_columns', (SELECT jsonb_object_agg(v.name, EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute a WHERE a.attrelid=to_regclass('public.notifications')
    AND a.attname=v.name AND a.attnum>0 AND NOT a.attisdropped))
    FROM (VALUES ('event_kind'),('source_event_key'),('event_payload')) v(name)),
  'policies', (SELECT coalesce(jsonb_agg(jsonb_build_object('name',p.polname,'command',p.polcmd,
    'permissive',p.polpermissive,'roles',CASE WHEN 0=ANY(p.polroles) THEN ARRAY['PUBLIC']::text[]
    ELSE ARRAY(SELECT r.rolname::text FROM pg_catalog.pg_roles r WHERE r.oid=ANY(p.polroles) ORDER BY r.rolname) END)
    ORDER BY p.polname),'[]'::jsonb) FROM pg_catalog.pg_policy p WHERE p.polrelid=to_regclass('public.notifications')),
  'client_table_privileges', (SELECT coalesce(jsonb_agg(jsonb_build_object('role',r.role_name,'privilege',a.privilege,
    'effective',has_table_privilege(r.role_name,to_regclass('public.notifications'),a.privilege)) ORDER BY r.role_name,a.privilege),'[]'::jsonb)
    FROM (VALUES ('anon'),('authenticated'),('service_role')) r(role_name)
    CROSS JOIN (VALUES ('SELECT'),('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE'),('REFERENCES'),('TRIGGER')) a(privilege)
    WHERE to_regclass('public.notifications') IS NOT NULL),
  'client_column_privileges', (SELECT coalesce(jsonb_agg(jsonb_build_object('role',r.role_name,'column',a.attname,
    'privilege',v.privilege,'effective',has_column_privilege(r.role_name,a.attrelid,a.attname,v.privilege))
    ORDER BY r.role_name,a.attnum,v.privilege),'[]'::jsonb)
    FROM (VALUES ('anon'),('authenticated')) r(role_name)
    JOIN pg_catalog.pg_attribute a ON a.attrelid=to_regclass('public.notifications') AND a.attnum>0 AND NOT a.attisdropped
    CROSS JOIN (VALUES ('SELECT'),('INSERT'),('UPDATE'),('REFERENCES')) v(privilege)),
  'indexes', (SELECT coalesce(jsonb_agg(jsonb_build_object('name',c.relname,'unique',i.indisunique,
    'valid',i.indisvalid,'ready',i.indisready) ORDER BY c.relname),'[]'::jsonb)
    FROM pg_catalog.pg_index i JOIN pg_catalog.pg_class c ON c.oid=i.indexrelid
    WHERE i.indrelid=to_regclass('public.notifications')),
  'rpcs', (SELECT coalesce(jsonb_agg(jsonb_build_object('expected_signature',v.signature,
    'missing',p.oid IS NULL,'security_definer',p.prosecdef,'default_count',p.pronargdefaults,
    'n5h_default_one',CASE WHEN v.signature='fn_seller_submit_return_evidence(uuid,text[],text)' THEN p.pronargdefaults = 1 END,
    'n5h_exact_search_path',CASE WHEN v.signature='fn_seller_submit_return_evidence(uuid,text[],text)' THEN p.proconfig = ARRAY['search_path=public']::text[] END,
    'anon_execute',CASE WHEN p.oid IS NOT NULL THEN has_function_privilege('anon',p.oid,'EXECUTE') END,
    'authenticated_execute',CASE WHEN p.oid IS NOT NULL THEN has_function_privilege('authenticated',p.oid,'EXECUTE') END,
    'service_execute',CASE WHEN p.oid IS NOT NULL THEN has_function_privilege('service_role',p.oid,'EXECUTE') END)
    ORDER BY v.signature),'[]'::jsonb)
    FROM (VALUES
      ('fn_cancel_order(uuid,text,text)'),('fn_cancel_shipment(uuid,text,text,bigint)'),
      ('fn_complete_shipment_refund(uuid)'),('fn_create_order_from_payment(uuid,text,numeric,numeric,uuid,uuid[])'),
      ('fn_create_shipments_from_single_payment(text,text,bigint,text,jsonb)'),
      ('fn_cron_dispute_payout_timeout()'),('fn_cron_dispute_shipping_timeout()'),
      ('fn_cron_return_delivery_timeout()'),('fn_mark_return_delivered(uuid)'),
      ('fn_request_payout(numeric,uuid)'),('fn_resolve_dispute_to_buyer(uuid,text)'),
      ('fn_resolve_dispute_to_seller(uuid,text)'),('fn_resolve_product_verdict(uuid,text,text,text)'),
      ('fn_seller_submit_return_evidence(uuid,text[],text)')
    ) v(signature) LEFT JOIN pg_catalog.pg_proc p ON p.oid=to_regprocedure('public.' || v.signature)),
  'n4a_constraints', (SELECT jsonb_object_agg(v.name, jsonb_build_object(
    'present', c.oid IS NOT NULL, 'validated', c.convalidated))
    FROM (VALUES ('notifications_event_payload_object_chk'),('notifications_event_identity_pair_chk'),
      ('notifications_source_event_key_nonempty_chk'),('notifications_event_kind_catalogue_chk')) v(name)
    LEFT JOIN pg_catalog.pg_constraint c ON c.conrelid=to_regclass('public.notifications') AND c.conname=v.name),
  'n5a_arbiter_matches', EXISTS (SELECT 1 FROM pg_catalog.pg_index i
    JOIN pg_catalog.pg_class c ON c.oid=i.indexrelid
    JOIN pg_catalog.pg_attribute key_column ON key_column.attrelid=i.indrelid AND key_column.attnum=i.indkey[0]
    JOIN pg_catalog.pg_attribute recipient_column ON recipient_column.attrelid=i.indrelid AND recipient_column.attnum=i.indkey[1]
    WHERE i.indrelid=to_regclass('public.notifications') AND c.relname='notifications_source_event_key_user_id_uidx'
      AND i.indisunique AND i.indisvalid AND i.indisready AND i.indimmediate
      AND i.indnkeyatts=2 AND i.indnatts=2
      AND key_column.attname='source_event_key' AND recipient_column.attname='user_id'
      AND pg_catalog.pg_get_expr(i.indpred, i.indrelid)='(source_event_key IS NOT NULL)'),
  'n5f_function_present', to_regprocedure('public.fn_notify_dispute_opened()') IS NOT NULL,
  'triggers', (SELECT coalesce(jsonb_agg(jsonb_build_object('name',t.tgname,'enabled',t.tgenabled,
    'function_identity',t.tgfoid::regprocedure::text,
    'after_insert', (t.tgtype & 5) = 5 AND (t.tgtype & 2) = 0 AND (t.tgtype & 64) = 0)
    ORDER BY t.tgname),'[]'::jsonb)
    FROM pg_catalog.pg_trigger t WHERE t.tgrelid=to_regclass('public.disputes')
      AND t.tgname IN ('set_product_in_dispute','notify_dispute_opened','tr_on_dispute_opened') AND NOT t.tgisinternal)
) AS preflight;
