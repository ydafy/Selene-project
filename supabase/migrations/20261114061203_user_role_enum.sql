SET local check_function_bodies = off;

-- Hand-edited: pg-delta set the user_role default before CREATE TYPE; reordered.
CREATE TYPE "public"."user_role" AS ENUM (
  'user',
  'admin'
);

DROP VIEW "public"."admin_user_directory_view";

ALTER TABLE "public"."profiles_private"
  ALTER COLUMN "role" DROP DEFAULT;

ALTER TABLE "public"."profiles_private"
  ALTER COLUMN "role" TYPE public.user_role USING "role"::public.user_role;

ALTER TABLE "public"."profiles_private"
  ALTER COLUMN "role" SET DEFAULT 'user'::public.user_role;

ALTER TABLE "public"."profiles_private"
  ALTER COLUMN "role" SET NOT NULL;

ALTER TABLE "public"."profiles_private"
  ALTER COLUMN "status" SET NOT NULL;

ALTER TABLE "public"."profiles_private"
  ALTER COLUMN "stripe_onboarding_status" SET NOT NULL;

ALTER TABLE "public"."profiles_private"
  ALTER COLUMN "updated_at" SET NOT NULL;

CREATE OR REPLACE FUNCTION public.is_admin()
  RETURNS boolean
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$

DECLARE
    v_role public.user_role;
    v_status public.account_status;
BEGIN
    SELECT role, status
    INTO v_role, v_status
    FROM public.profiles_private
    WHERE id = auth.uid();

    -- Suspended or banned admins lose admin authority
    RETURN COALESCE(v_role = 'admin' AND COALESCE(v_status, 'active') = 'active', false);
END;
$function$;

CREATE VIEW "public"."admin_user_directory_view" WITH (security_invoker=true) AS  SELECT p.id,
    p.username,
    pp.email,
    p.avatar_url,
    pp.role,
    pp.status,
    p.is_verified_seller,
    p.created_at
   FROM (public.profiles p
     LEFT JOIN public.profiles_private pp ON ((p.id = pp.id)));

REVOKE ALL ON TABLE "public"."admin_user_directory_view" FROM "anon";

REVOKE ALL ON TABLE "public"."admin_user_directory_view" FROM "authenticated";

GRANT SELECT ON TABLE "public"."admin_user_directory_view" TO "authenticated";

REVOKE ALL ON TABLE "public"."admin_user_directory_view" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."admin_user_directory_view" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."admin_user_directory_view" TO "service_role";
