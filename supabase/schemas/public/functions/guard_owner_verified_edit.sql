CREATE OR REPLACE FUNCTION public.guard_owner_verified_edit()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SET search_path TO 'public', 'pg_temp'
  AS $function$
BEGIN
  IF current_user <> 'authenticated'
    OR NEW.status IS DISTINCT FROM 'VERIFIED'
    OR public.is_admin() THEN
    RETURN NEW;
  END IF;

  IF OLD.status IS DISTINCT FROM 'VERIFIED'
    OR (to_jsonb(NEW) - ARRAY['name', 'description', 'condition', 'usage', 'updated_at', 'fts'])
      IS DISTINCT FROM
      (to_jsonb(OLD) - ARRAY['name', 'description', 'condition', 'usage', 'updated_at', 'fts']) THEN
    RAISE EXCEPTION 'VERIFIED_EDIT_REQUIRES_REVIEW' USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$function$;

GRANT EXECUTE ON FUNCTION "public"."guard_owner_verified_edit"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."guard_owner_verified_edit"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."guard_owner_verified_edit"() TO "postgres";

REVOKE ALL ON FUNCTION "public"."guard_owner_verified_edit"() FROM PUBLIC, "anon", "authenticated";
