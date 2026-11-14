CREATE TABLE "public"."profiles" (
  "id"                 uuid                     NOT NULL,
  "created_at"         timestamp with time zone NOT NULL DEFAULT now(),
  "username"           text,
  "avatar_url"         text,
  "is_verified_seller" boolean                  DEFAULT false,
  "average_rating"     numeric(3,1)             NOT NULL DEFAULT 0.0,
  "total_reviews"      integer                  NOT NULL DEFAULT 0,
  "total_sales"        integer                  NOT NULL DEFAULT 0,
  "updated_at"         timestamp with time zone DEFAULT now(),
  "deleted_at"         timestamp with time zone,
  CONSTRAINT "fk_auth_users" FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE,
  CONSTRAINT "profiles_pkey" PRIMARY KEY (id),
  CONSTRAINT "profiles_username_key" UNIQUE (username),
  CONSTRAINT "username_length" CHECK (((char_length(username) >= 3) AND (char_length(username) <= 20)))
);

ALTER TABLE "public"."profiles"
  ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER tr_profiles_reserve_deleted_username
  BEFORE INSERT OR UPDATE OF username ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_reserve_deleted_username();

CREATE POLICY "profiles_public_read" ON "public"."profiles"
  FOR SELECT
  TO "anon", "authenticated"
  USING (true);

CREATE POLICY "profiles_update" ON "public"."profiles"
  FOR UPDATE
  TO "authenticated"
  USING ((( SELECT auth.uid() AS uid) = id));

REVOKE ALL ON TABLE "public"."profiles" FROM "authenticated";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."profiles" TO "service_role";

COMMENT ON COLUMN "public"."profiles"."deleted_at" IS 'When the account was anonymized and closed by fn_close_account. NULL for live accounts.';

COMMENT ON COLUMN "public"."profiles"."id" IS 'References auth.users.id';

COMMENT ON TABLE "public"."profiles" IS 'Public profile information for each user.';

REVOKE ALL ON TABLE "public"."profiles" FROM "anon";

GRANT SELECT ON TABLE "public"."profiles" TO "anon";

REVOKE ALL ("avatar_url") ON TABLE "public"."profiles" FROM "authenticated";

GRANT UPDATE ("avatar_url") ON TABLE "public"."profiles" TO "authenticated";

REVOKE ALL ("updated_at") ON TABLE "public"."profiles" FROM "authenticated";

GRANT UPDATE ("updated_at") ON TABLE "public"."profiles" TO "authenticated";

REVOKE ALL ("username") ON TABLE "public"."profiles" FROM "authenticated";

GRANT UPDATE ("username") ON TABLE "public"."profiles" TO "authenticated";

GRANT SELECT ON TABLE "public"."profiles" TO "authenticated";

REVOKE ALL ON TABLE "public"."profiles" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."profiles" TO "postgres";
