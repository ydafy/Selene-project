CREATE TABLE "public"."mexico_zips" (
  "id"         bigint NOT NULL DEFAULT nextval('public.mexico_zips_id_seq'::regclass),
  "zip_code"   text,
  "district"   text,
  "city"       text,
  "state_name" text,
  "state_code" text,
  CONSTRAINT "mexico_zips_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."mexico_zips"
  ENABLE ROW LEVEL SECURITY;

ALTER SEQUENCE "public"."mexico_zips_id_seq" OWNED BY "public"."mexico_zips"."id";

CREATE INDEX idx_mexico_zips_code ON public.mexico_zips USING btree (zip_code);

CREATE POLICY "mexico_zips_read" ON "public"."mexico_zips"
  FOR SELECT
  TO PUBLIC
  USING (true);

REVOKE ALL ON TABLE "public"."mexico_zips" FROM "anon", "authenticated";

GRANT SELECT ON TABLE "public"."mexico_zips" TO "anon";

GRANT SELECT ON TABLE "public"."mexico_zips" TO "authenticated";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."mexico_zips" TO "service_role";

REVOKE ALL ON TABLE "public"."mexico_zips" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."mexico_zips" TO "postgres";
