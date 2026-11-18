SET local check_function_bodies = off;

CREATE OR REPLACE FUNCTION internal.fn_reports_keep_resolved_closed()
  RETURNS TRIGGER
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

CREATE TRIGGER reports_keep_resolved_closed
  BEFORE UPDATE ON public.reports
  FOR EACH ROW
  EXECUTE FUNCTION internal.fn_reports_keep_resolved_closed();

COMMENT ON TABLE "public"."reports" IS 'User reports of a listing or a user (#653). Exactly one target. Users insert only; admins read; the resolution is written once by the admin workflow (#298), and a resolved report never changes (trigger reports_keep_resolved_closed). Kept forever as moderation evidence, so every foreign key is ON DELETE RESTRICT.';

REVOKE ALL ON FUNCTION "internal"."fn_reports_keep_resolved_closed"() FROM PUBLIC;
