CREATE TABLE "public"."profiles_private" (
  "id"                 uuid NOT NULL,
  "email"              text,
  "role"               text DEFAULT 'user'::text,
  "stripe_customer_id" text,
  "phone_number"       text,
  CONSTRAINT "profiles_private_id_fkey" FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE,
  CONSTRAINT "profiles_private_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."profiles_private"
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."profiles_private"
  ADD COLUMN "status" public.account_status DEFAULT 'active'::public.account_status;

ALTER TABLE "public"."profiles_private"
  ADD COLUMN "status_reason" text;

ALTER TABLE "public"."profiles_private"
  ADD COLUMN "status_updated_at" timestamp WITH time zone;

ALTER TABLE "public"."profiles_private"
  ADD COLUMN "status_updated_by" text;

ALTER TABLE "public"."profiles_private"
  ADD COLUMN "last_sign_in_at" timestamp WITH time zone;

ALTER TABLE "public"."profiles_private"
  ADD COLUMN "updated_at" timestamp WITH time zone DEFAULT now();

ALTER TABLE "public"."profiles_private"
  ADD COLUMN "stripe_account_id" text;

ALTER TABLE "public"."profiles_private"
  ADD COLUMN "stripe_onboarding_status" public.stripe_onboarding_status DEFAULT 'pending'::public.stripe_onboarding_status;

ALTER TABLE "public"."profiles_private"
  ADD COLUMN "stripe_onboarding_refreshed_at" timestamp WITH time zone;

CREATE INDEX idx_profiles_private_stripe_account_id ON public.profiles_private USING btree (stripe_account_id)
  WHERE (stripe_account_id IS NOT NULL);

CREATE TRIGGER trg_product_available_on_connect_complete
  AFTER UPDATE OF stripe_onboarding_status ON public.profiles_private
  FOR EACH ROW
  WHEN
    (((old.stripe_onboarding_status IS DISTINCT FROM 'complete'::public.stripe_onboarding_status) AND (new.stripe_onboarding_status = 'complete'::public.stripe_onboarding_status)))
  EXECUTE FUNCTION public.fn_tr_product_available_on_connect_complete();

CREATE POLICY "profiles_private_access" ON "public"."profiles_private"
  FOR SELECT
  TO "authenticated"
  USING (((( SELECT auth.uid() AS uid) = id) OR ( SELECT public.is_admin() AS is_admin)));

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."profiles_private" TO "service_role";

COMMENT ON COLUMN "public"."profiles_private"."stripe_account_id" IS 'Stripe Connect Account v2 ID (acct_...). NULL until seller starts onboarding.';

COMMENT ON COLUMN "public"."profiles_private"."stripe_onboarding_status" IS 'Stripe Connect onboarding state. Updated by account.updated webhook.';

REVOKE ALL ON TABLE "public"."profiles_private" FROM "authenticated";

GRANT SELECT ON TABLE "public"."profiles_private" TO "authenticated";

REVOKE ALL ON TABLE "public"."profiles_private" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."profiles_private" TO "postgres";

REVOKE ALL ON TABLE "public"."profiles_private" FROM "anon";
