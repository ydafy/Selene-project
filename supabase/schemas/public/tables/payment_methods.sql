CREATE TABLE "public"."payment_methods" (
  "id"                       uuid                     NOT NULL DEFAULT extensions.uuid_generate_v4(),
  "user_id"                  uuid                     NOT NULL,
  "stripe_payment_method_id" text                     NOT NULL,
  "brand"                    text                     NOT NULL,
  "last4"                    text                     NOT NULL,
  "exp_month"                integer                  NOT NULL,
  "exp_year"                 integer                  NOT NULL,
  "is_default"               boolean                  DEFAULT false,
  "created_at"               timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  "deleted_at"               timestamp with time zone,
  CONSTRAINT "payment_methods_pkey" PRIMARY KEY (id),
  CONSTRAINT "payment_methods_stripe_payment_method_id_key" UNIQUE (stripe_payment_method_id),
  CONSTRAINT "payment_methods_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
);

ALTER TABLE "public"."payment_methods"
  ENABLE ROW LEVEL SECURITY;

CREATE INDEX ix_payment_methods_user_id ON public.payment_methods USING btree (user_id);

CREATE TRIGGER trigger_check_max_cards
  BEFORE INSERT ON public.payment_methods
  FOR EACH ROW
  EXECUTE FUNCTION public.check_max_payment_methods();

CREATE POLICY "payment_methods_manage" ON "public"."payment_methods"
  FOR ALL
  TO "authenticated"
  USING ((( SELECT auth.uid() AS uid) = user_id));

REVOKE ALL ON TABLE "public"."payment_methods" FROM "anon", "authenticated";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."payment_methods" TO "service_role";

REVOKE ALL ON TABLE "public"."payment_methods" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."payment_methods" TO "postgres";
