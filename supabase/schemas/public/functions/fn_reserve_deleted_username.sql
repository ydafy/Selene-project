CREATE OR REPLACE FUNCTION public.fn_reserve_deleted_username()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SET search_path TO 'public', 'pg_temp'
  AS $function$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.username IS NOT DISTINCT FROM OLD.username THEN
    RETURN NEW;
  END IF;

  IF NEW.username ILIKE 'deleted\_%' THEN
    IF TG_OP = 'UPDATE'
       AND current_user NOT IN ('anon', 'authenticated')
       AND OLD.deleted_at IS NULL
       AND NEW.deleted_at IS NOT NULL THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Username "%" is reserved', NEW.username
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$function$;

GRANT EXECUTE ON FUNCTION "public"."fn_reserve_deleted_username"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."fn_reserve_deleted_username"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."fn_reserve_deleted_username"() TO "postgres";

REVOKE ALL ON FUNCTION "public"."fn_reserve_deleted_username"() FROM PUBLIC, "anon", "authenticated";
