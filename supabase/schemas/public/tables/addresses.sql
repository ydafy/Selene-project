CREATE TABLE "public"."addresses" (
  "id"            uuid                     NOT NULL DEFAULT extensions.uuid_generate_v4(),
  "created_at"    timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  "user_id"       uuid                     NOT NULL,
  "full_name"     text                     NOT NULL,
  "phone"         text                     NOT NULL,
  "street_line1"  text                     NOT NULL,
  "street_line2"  text,
  "city"          text                     NOT NULL,
  "state"         text                     NOT NULL,
  "zip_code"      text                     NOT NULL,
  "country"       text                     NOT NULL DEFAULT 'MX'::text,
  "latitude"      double precision,
  "longitude"     double precision,
  "is_default"    boolean                  DEFAULT false,
  "instructions"  text,
  "label"         text                     NOT NULL,
  "district"      text,
  "deleted_at"    timestamp with time zone,
  "street_number" text,
  CONSTRAINT "addresses_pkey" PRIMARY KEY (id),
  CONSTRAINT "addresses_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
);

ALTER TABLE "public"."addresses"
  ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_addresses_user_id ON public.addresses USING btree (user_id);

CREATE POLICY "addresses_delete_policy" ON "public"."addresses"
  FOR DELETE
  TO "authenticated"
  USING ((auth.uid() = user_id));

CREATE POLICY "addresses_insert_policy" ON "public"."addresses"
  FOR INSERT
  TO "authenticated"
  WITH CHECK ((auth.uid() = user_id));

CREATE POLICY "addresses_select_policy" ON "public"."addresses"
  FOR SELECT
  TO "authenticated"
  USING (((auth.uid() = user_id) OR public.is_admin()));

CREATE POLICY "addresses_update_policy" ON "public"."addresses"
  FOR UPDATE
  TO "authenticated"
  USING ((auth.uid() = user_id))
  WITH CHECK ((auth.uid() = user_id));

REVOKE ALL ON TABLE "public"."addresses" FROM "anon", "authenticated";

GRANT INSERT, SELECT, UPDATE ON TABLE "public"."addresses" TO "authenticated";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."addresses" TO "service_role";

REVOKE ALL ON TABLE "public"."addresses" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."addresses" TO "postgres";
