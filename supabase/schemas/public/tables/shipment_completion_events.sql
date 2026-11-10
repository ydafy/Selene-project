CREATE TABLE "public"."shipment_completion_events" (
  "id"              uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "shipment_id"     uuid                     NOT NULL,
  "order_id"        uuid                     NOT NULL,
  "source"          text                     NOT NULL,
  "actor_id"        uuid,
  "idempotency_key" text                     NOT NULL,
  "completed_at"    timestamp with time zone NOT NULL DEFAULT now(),
  "is_connect"      boolean                  NOT NULL,
  "created_at"      timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "shipment_completion_events_actor_id_fkey" FOREIGN KEY (actor_id) REFERENCES public.profiles(id) ON DELETE RESTRICT,
  CONSTRAINT "shipment_completion_events_actor_source_check" CHECK ((((source = 'buyer'::text) AND (actor_id IS NOT NULL)) OR ((source = 'auto'::text) AND (actor_id IS NULL)))),
  CONSTRAINT "shipment_completion_events_idempotency_key_key" UNIQUE (idempotency_key),
  CONSTRAINT "shipment_completion_events_order_id_fkey" FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE RESTRICT,
  CONSTRAINT "shipment_completion_events_pkey" PRIMARY KEY (id),
  CONSTRAINT "shipment_completion_events_shipment_id_key" UNIQUE (shipment_id),
  CONSTRAINT "shipment_completion_events_source_check" CHECK ((source = ANY (ARRAY['buyer'::text, 'auto'::text]))),
  CONSTRAINT "shipment_completion_events_shipment_id_fkey" FOREIGN KEY (shipment_id) REFERENCES public.shipments(id) ON DELETE RESTRICT
);

ALTER TABLE "public"."shipment_completion_events"
  ENABLE ROW LEVEL SECURITY;

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."shipment_completion_events" TO "service_role";

REVOKE ALL ON TABLE "public"."shipment_completion_events" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."shipment_completion_events" TO "postgres";

REVOKE ALL ON TABLE "public"."shipment_completion_events" FROM "anon", "authenticated";
