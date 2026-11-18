CREATE OR REPLACE FUNCTION internal.fn_reports_keep_resolved_closed()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
BEGIN
  -- A resolution is written once (odd/tasks/reports-data-model.md S3): a
  -- resolved report is moderation evidence and is never reopened or edited,
  -- whoever runs the update. A new problem with the same target is a new report.
  IF OLD.status = 'resolved'::public.report_status THEN
    RAISE EXCEPTION 'a resolved report cannot change'
      USING ERRCODE = '23514', DETAIL = format('report %s', OLD.id);
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION "internal"."fn_reports_keep_resolved_closed"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "internal"."fn_reports_keep_resolved_closed"() TO "postgres";

REVOKE ALL ON FUNCTION "internal"."fn_reports_keep_resolved_closed"() FROM PUBLIC, "anon", "authenticated";
