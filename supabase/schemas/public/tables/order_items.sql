CREATE TABLE "public"."order_items" (
  "id"                  uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "created_at"          timestamp with time zone DEFAULT now(),
  "order_id"            uuid                     NOT NULL,
  "product_id"          uuid                     NOT NULL,
  "seller_id"           uuid                     NOT NULL,
  "price_at_purchase"   numeric                  NOT NULL,
  "commission_amount"   numeric                  DEFAULT 0,
  "shipping_amount"     numeric                  DEFAULT 0,
  "insurance_amount"    numeric                  DEFAULT 0,
  "net_payout"          numeric                  DEFAULT 0,
  "shipping_payer"      text                     DEFAULT 'seller'::text,
  "shipment_id"         uuid,
  "sat_tax_withholding" numeric,
  CONSTRAINT "order_items_pkey" PRIMARY KEY (id),
  CONSTRAINT "order_items_seller_id_fkey" FOREIGN KEY (seller_id) REFERENCES auth.users(id),
  CONSTRAINT "order_items_order_id_fkey" FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE,
  CONSTRAINT "order_items_product_id_fkey" FOREIGN KEY (product_id) REFERENCES public.products(id),
  CONSTRAINT "order_items_shipment_id_fkey" FOREIGN KEY (shipment_id) REFERENCES public.shipments(id) ON DELETE RESTRICT
);

ALTER TABLE "public"."order_items"
  ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_order_items_seller_id ON public.order_items USING btree (seller_id);

CREATE INDEX idx_order_items_shipment_id ON public.order_items USING btree (shipment_id);

CREATE INDEX ix_order_items_order_id ON public.order_items USING btree (order_id);

CREATE INDEX ix_order_items_product_id ON public.order_items USING btree (product_id);

CREATE UNIQUE INDEX order_items_order_product_unique ON public.order_items USING btree (order_id, product_id);

CREATE UNIQUE INDEX order_items_shipment_id_unique ON public.order_items USING btree (shipment_id)
  WHERE (shipment_id IS NOT NULL);

CREATE POLICY "order_items_select_v4" ON "public"."order_items"
  FOR SELECT
  TO PUBLIC
  USING (internal.fn_check_order_access(order_id, ( SELECT auth.uid() AS uid)));

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."order_items" TO "service_role";

COMMENT ON COLUMN "public"."order_items"."commission_amount" IS 'Monto retenido por Selene como comisión de plataforma';

COMMENT ON COLUMN "public"."order_items"."net_payout" IS 'Monto final a transferir al vendedor tras todas las deducciones';

COMMENT ON COLUMN "public"."order_items"."sat_tax_withholding" IS 'Monto total de retención SAT (ISR + IVA) para este artículo. Calculado en fn_create_order_from_payment.';

COMMENT ON COLUMN "public"."order_items"."shipping_amount" IS 'Monto descontado al vendedor para cubrir la logística de envío';

REVOKE ALL ON TABLE "public"."order_items" FROM "anon";

GRANT MAINTAIN, SELECT ON TABLE "public"."order_items" TO "anon";

REVOKE ALL ON TABLE "public"."order_items" FROM "authenticated";

GRANT MAINTAIN, SELECT ON TABLE "public"."order_items" TO "authenticated";

REVOKE ALL ON TABLE "public"."order_items" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."order_items" TO "postgres";
