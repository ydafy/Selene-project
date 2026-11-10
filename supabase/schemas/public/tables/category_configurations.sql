CREATE TABLE "public"."category_configurations" (
  "category_name" text                     NOT NULL,
  "sell_fields"   jsonb                    NOT NULL,
  "filter_fields" jsonb                    NOT NULL,
  "updated_at"    timestamp with time zone DEFAULT now(),
  CONSTRAINT "category_configurations_pkey" PRIMARY KEY (category_name)
);

ALTER TABLE "public"."category_configurations"
  ENABLE ROW LEVEL SECURITY;

CREATE POLICY "category_config_select" ON "public"."category_configurations"
  FOR SELECT
  TO PUBLIC
  USING (true);

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."category_configurations" TO "anon", "authenticated";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."category_configurations" TO "service_role";

REVOKE ALL ON TABLE "public"."category_configurations" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."category_configurations" TO "postgres";
