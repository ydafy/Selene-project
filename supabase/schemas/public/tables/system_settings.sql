CREATE TABLE "public"."system_settings" (
  "id"                                         integer                  NOT NULL,
  "is_maintenance"                             boolean                  DEFAULT false,
  "min_version_android"                        text                     DEFAULT '1.0.0'::text,
  "min_version_ios"                            text                     DEFAULT '1.0.0'::text,
  "service_fee_pct"                            numeric                  DEFAULT 0.05,
  "service_fee_fixed_cents"                    integer                  DEFAULT 500,
  "insurance_rate"                             numeric                  DEFAULT 0.012,
  "payout_fee_fixed_cents"                     integer                  DEFAULT 2000,
  "currency"                                   text                     DEFAULT 'MXN'::text,
  "updated_at"                                 timestamp with time zone DEFAULT now(),
  "shipping_buffer_cents"                      integer                  DEFAULT 5000,
  "package_presets"                            jsonb                    DEFAULT
    '{"cpu_1": {"width": 15, "height": 15, "length": 15, "weight": 1}, "cpu_2": {"width": 15, "height": 10, "length": 20, "weight": 1}, "gpu_1": {"width": 30, "height": 20, "length": 41, "weight": 5}, "ram_1": {"width": 15, "height": 15, "length": 15, "weight": 1}, "ram_2": {"width": 15, "height": 10, "length": 20, "weight": 1}, "mobo_1": {"width": 30, "height": 15, "length": 46, "weight": 5}}'::jsonb,
  "return_label_fee_cents"                     integer                  DEFAULT 20000,
  "order_expiration_hours"                     integer                  DEFAULT 48,
  "min_payout_amount_cents"                    integer                  DEFAULT 10000,
  "preparing_expiration_hours"                 integer                  DEFAULT 96,
  "return_delivery_timeout_running"            boolean                  DEFAULT false,
  "release_funds_running"                      boolean                  DEFAULT false,
  "isr_withholding_pct"                        numeric                  DEFAULT 0.01,
  "iva_withholding_pct"                        numeric                  DEFAULT 0.08,
  "novice_completed_threshold"                 integer                  DEFAULT 3,
  "novice_active_limit"                        integer                  DEFAULT 3,
  "trusted_active_limit"                       integer                  DEFAULT 10,
  "envia_carrier"                              text,
  "envia_service"                              text,
  "envia_print_format"                         text,
  "envia_print_size"                           text,
  "listing_quote_reference_destination"        jsonb,
  "checkout_recovery_enabled"                  boolean                  NOT NULL DEFAULT false,
  "track_shipments_preparing_lease_id"         uuid,
  "track_shipments_preparing_lease_expires_at" timestamp with time zone,
  "track_shipments_shipped_lease_id"           uuid,
  "track_shipments_shipped_lease_expires_at"   timestamp with time zone,
  "auto_cancel_orders_lease_id"                uuid,
  "auto_cancel_orders_lease_expires_at"        timestamp with time zone,
  "auto_cancel_preparing_lease_id"             uuid,
  "auto_cancel_preparing_lease_expires_at"     timestamp with time zone,
  "checkout_recovery_lease_id"                 uuid,
  "checkout_recovery_lease_expires_at"         timestamp with time zone,
  CONSTRAINT "system_settings_envia_tuple_check"
    CHECK
    ((((envia_carrier IS NULL) AND (envia_service IS NULL) AND (envia_print_format IS NULL) AND (envia_print_size IS NULL) AND (listing_quote_reference_destination IS NULL)) OR
    ((envia_carrier = 'paquetexpress'::text) AND (lower(regexp_replace(btrim(envia_service), '\s+'::text, ' '::text, 'g'::text)) = 'ground'::text) AND (length(TRIM(BOTH FROM
    envia_print_format)) > 0) AND (length(TRIM(BOTH FROM envia_print_size)) > 0) AND (jsonb_typeof(listing_quote_reference_destination) = 'object'::text) AND
    (listing_quote_reference_destination ?& ARRAY['name'::text, 'phone'::text, 'street'::text, 'number'::text, 'district'::text, 'city'::text, 'state'::text, 'country'::text,
    'postalCode'::text]) AND (length(TRIM(BOTH FROM (listing_quote_reference_destination ->> 'name'::text))) > 0) AND
    (length(TRIM(BOTH FROM (listing_quote_reference_destination ->> 'phone'::text))) > 0) AND (length(TRIM(BOTH FROM (listing_quote_reference_destination ->> 'street'::text))) > 0)
    AND (length(TRIM(BOTH FROM (listing_quote_reference_destination ->> 'number'::text))) > 0) AND
    (length(TRIM(BOTH FROM (listing_quote_reference_destination ->> 'district'::text))) > 0) AND
    (length(TRIM(BOTH FROM (listing_quote_reference_destination ->> 'city'::text))) > 0) AND (length(TRIM(BOTH FROM (listing_quote_reference_destination ->> 'state'::text))) > 0)
    AND (upper((listing_quote_reference_destination ->> 'state'::text)) <> 'MX'::text) AND ((listing_quote_reference_destination ->> 'country'::text) = 'MX'::text) AND
    ((listing_quote_reference_destination ->> 'postalCode'::text) ~ '^[0-9]{5}$'::text)))),
  CONSTRAINT "system_settings_id_check" CHECK ((id = 1)),
  CONSTRAINT "system_settings_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."system_settings"
  ENABLE ROW LEVEL SECURITY;

CREATE POLICY "system_settings_read" ON "public"."system_settings"
  FOR SELECT
  TO PUBLIC
  USING (true);

REVOKE ALL ON TABLE "public"."system_settings" FROM "anon", "authenticated";

-- Clients read only the columns the app selects (useSystemConfig and the
-- publish flow; id is the filter). One cached query serves the guest guard and
-- signed-in screens, so anon gets the same list. Leases and the Envia
-- reference address stay server-only (#305, #309).
GRANT SELECT ("id", "insurance_rate", "is_maintenance", "min_version_android", "min_version_ios", "order_expiration_hours", "package_presets", "preparing_expiration_hours", "service_fee_pct", "shipping_buffer_cents") ON TABLE "public"."system_settings" TO "anon";

GRANT SELECT ("id", "insurance_rate", "is_maintenance", "min_version_android", "min_version_ios", "order_expiration_hours", "package_presets", "preparing_expiration_hours", "service_fee_pct", "shipping_buffer_cents") ON TABLE "public"."system_settings" TO "authenticated";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."system_settings" TO "service_role";

COMMENT ON COLUMN "public"."system_settings"."isr_withholding_pct" IS 'Porcentaje de retención ISR (Art. 113-A LISR). Default: 1% = 0.01';

COMMENT ON COLUMN "public"."system_settings"."iva_withholding_pct" IS 'Porcentaje de retención IVA para plataformas tecnológicas. Default: 8% = 0.08';

COMMENT ON COLUMN "public"."system_settings"."service_fee_fixed_cents" IS 'Legacy fixed buyer service fee in centavos. Do not use for Stripe Connect buyer totals; v1 Connect checkout charges buyer subtotal + Seguro Selene only.';

COMMENT ON COLUMN "public"."system_settings"."service_fee_pct" IS 'Legacy/Selene marketplace commission percentage. In Stripe Connect checkout this is a seller-side deduction, not a buyer charge.';

COMMENT ON COLUMN "public"."system_settings"."shipping_buffer_cents" IS 'Seller-side logistics buffer in centavos used by seller earnings estimates. Buyer does not pay seller shipping in Stripe Connect checkout.';

REVOKE ALL ON TABLE "public"."system_settings" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."system_settings" TO "postgres";
