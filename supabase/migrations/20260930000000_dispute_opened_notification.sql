-- N5f: apply after N5e, N4b and N4a. Deploy create-dispute Edge cutover
-- in a coordinated window: SQL-first may temporarily double-write legacy notices;
-- Edge-first may temporarily produce no notice. Neither order is zero downtime.
-- Submit this whole file as one Dashboard transaction; inspect deployed state before retrying.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $preflight$
DECLARE
  relation_name text;
  v_column_name text;
  expected_type text;
BEGIN
  IF NOT has_table_privilege('service_role', 'public.notifications', 'INSERT')
     OR has_table_privilege('anon', 'public.notifications', 'INSERT')
     OR has_table_privilege('authenticated', 'public.notifications', 'INSERT')
     OR has_table_privilege('anon', 'public.notifications', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.notifications', 'UPDATE')
     OR EXISTS (
       SELECT 1 FROM (VALUES ('anon'), ('authenticated')) AS roles(name)
       CROSS JOIN (VALUES ('event_kind'), ('source_event_key'), ('event_payload')) AS columns(name)
       WHERE has_column_privilege(roles.name, 'public.notifications', columns.name, 'INSERT')
          OR has_column_privilege(roles.name, 'public.notifications', columns.name, 'UPDATE')
     ) THEN
    RAISE EXCEPTION 'N4b restrictive notification grants required before N5f';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_index i
    JOIN pg_catalog.pg_class c ON c.oid = i.indexrelid
    JOIN pg_catalog.pg_attribute key_column ON key_column.attrelid = i.indrelid AND key_column.attnum = i.indkey[0]
    JOIN pg_catalog.pg_attribute recipient_column ON recipient_column.attrelid = i.indrelid AND recipient_column.attnum = i.indkey[1]
    WHERE i.indrelid = 'public.notifications'::regclass
      AND c.relname = 'notifications_source_event_key_user_id_uidx'
      AND i.indisunique AND i.indisvalid AND i.indisready AND i.indimmediate
      AND i.indnkeyatts = 2 AND i.indnatts = 2
      AND key_column.attname = 'source_event_key' AND recipient_column.attname = 'user_id'
      AND pg_catalog.pg_get_expr(i.indpred, i.indrelid) = '(source_event_key IS NOT NULL)'
  ) THEN
    RAISE EXCEPTION 'Expected N4a partial unique notification arbiter is absent or incompatible';
  END IF;
  FOR relation_name, v_column_name, expected_type IN
    SELECT * FROM (VALUES
      ('disputes', 'id', 'uuid'), ('disputes', 'order_id', 'uuid'),
      ('disputes', 'shipment_id', 'uuid'), ('disputes', 'buyer_id', 'uuid'),
      ('disputes', 'seller_id', 'uuid'), ('disputes', 'status', 'dispute_status'),
      ('orders', 'id', 'uuid'), ('orders', 'buyer_id', 'uuid'),
      ('shipments', 'id', 'uuid'), ('shipments', 'order_id', 'uuid'),
      ('shipments', 'seller_id', 'uuid'), ('notifications', 'event_kind', 'text'),
      ('notifications', 'source_event_key', 'text'), ('notifications', 'event_payload', 'jsonb'),
      ('notifications', 'user_id', 'uuid')
    ) AS required(table_name, field_name, field_type)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns c
      WHERE c.table_schema = 'public' AND c.table_name = relation_name
        AND c.column_name = v_column_name AND c.udt_name = expected_type
    ) THEN
      RAISE EXCEPTION 'Required column %.% with type % is absent', relation_name, v_column_name, expected_type;
    END IF;
  END LOOP;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger t
    WHERE t.tgrelid = 'public.disputes'::regclass
      AND t.tgname = 'set_product_in_dispute' AND NOT t.tgisinternal
      AND t.tgenabled = 'O'
      AND t.tgfoid = 'public.fn_set_product_in_dispute()'::regprocedure
      AND (t.tgtype & 5) = 5 AND (t.tgtype & 2) = 0
  ) THEN
    RAISE EXCEPTION 'Existing set_product_in_dispute AFTER INSERT trigger differs';
  END IF;
  IF to_regprocedure('public.fn_notify_dispute_opened()') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_trigger WHERE tgrelid = 'public.disputes'::regclass AND tgname = 'notify_dispute_opened') THEN
    RAISE EXCEPTION 'Dispute opened producer already exists; inspect before retry';
  END IF;
END;
$preflight$;

CREATE FUNCTION public.fn_notify_dispute_opened()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_buyer_id uuid;
  v_seller_id uuid;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     OR NEW.status IS DISTINCT FROM 'open'
     OR NEW.shipment_id IS NULL THEN
    RAISE EXCEPTION 'Invalid dispute opened notification authority or state';
  END IF;

  SELECT o.buyer_id, s.seller_id INTO v_buyer_id, v_seller_id
  FROM public.orders o
  JOIN public.shipments s ON s.order_id = o.id
  WHERE o.id = NEW.order_id AND s.id = NEW.shipment_id;

  IF NOT FOUND OR v_buyer_id IS NULL OR v_seller_id IS NULL
     OR NEW.buyer_id IS DISTINCT FROM v_buyer_id
     OR NEW.seller_id IS DISTINCT FROM v_seller_id THEN
    RAISE EXCEPTION 'Dispute order, shipment, buyer or seller relationship invalid';
  END IF;

  IF v_seller_id IS DISTINCT FROM v_buyer_id THEN
    INSERT INTO public.notifications (
      user_id, type, title, message, action_path,
      event_kind, source_event_key, event_payload
    ) VALUES (
      v_seller_id, 'warning', 'Disputa abierta',
      'Se abrió una disputa sobre una de tus ventas. Consulta los detalles del caso.',
      '/profile/orders/' || NEW.order_id::text,
      'dispute.opened', 'dispute.opened:' || NEW.id::text,
      jsonb_build_object('dispute_id', NEW.id, 'order_id', NEW.order_id, 'recipient_role', 'seller')
    ) ON CONFLICT (source_event_key, user_id) WHERE source_event_key IS NOT NULL DO NOTHING;
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.fn_notify_dispute_opened() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER notify_dispute_opened
  AFTER INSERT ON public.disputes
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_notify_dispute_opened();

COMMIT;
