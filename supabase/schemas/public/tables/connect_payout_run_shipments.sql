CREATE TABLE "public"."connect_payout_run_shipments" (
  "id"                  uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "run_id"              uuid                     NOT NULL,
  "shipment_id"         uuid                     NOT NULL,
  "net_payout"          integer                  NOT NULL,
  "status"              text                     NOT NULL DEFAULT 'pending_reconciliation'::text,
  "created_at"          timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"          timestamp with time zone NOT NULL DEFAULT now(),
  "transfer_started_at" timestamp with time zone,
  "transfer_token"      uuid,
  CONSTRAINT "connect_payout_run_shipments_net_payout_check" CHECK ((net_payout >= 0)),
  CONSTRAINT "connect_payout_run_shipments_pkey" PRIMARY KEY (id),
  CONSTRAINT "connect_payout_run_shipments_run_id_shipment_id_key" UNIQUE (run_id, shipment_id),
  CONSTRAINT "connect_payout_run_shipments_status_check"
    CHECK ((status = ANY (ARRAY['pending_reconciliation'::text, 'paid'::text, 'failed'::text, 'canceled'::text, 'reconciliation_needed'::text]))),
  CONSTRAINT "connect_payout_run_shipments_transfer_start_pair" CHECK (((transfer_started_at IS NULL) = (transfer_token IS NULL))),
  CONSTRAINT "connect_payout_run_shipments_run_id_fkey" FOREIGN KEY (run_id) REFERENCES public.connect_payout_runs(id) ON DELETE CASCADE,
  CONSTRAINT "connect_payout_run_shipments_shipment_id_fkey" FOREIGN KEY (shipment_id) REFERENCES public.shipments(id) ON DELETE RESTRICT
);

ALTER TABLE "public"."connect_payout_run_shipments"
  ENABLE ROW LEVEL SECURITY;

CREATE UNIQUE INDEX idx_connect_payout_run_shipments_active_once ON public.connect_payout_run_shipments USING btree (shipment_id)
  WHERE (status = ANY (ARRAY['pending_reconciliation'::text, 'paid'::text, 'reconciliation_needed'::text]));

CREATE INDEX idx_connect_payout_run_shipments_run_id ON public.connect_payout_run_shipments USING btree (run_id);

CREATE INDEX idx_connect_payout_run_shipments_shipment_id ON public.connect_payout_run_shipments USING btree (shipment_id);

CREATE INDEX idx_connect_payout_run_shipments_transfer_started ON public.connect_payout_run_shipments USING btree (shipment_id)
  WHERE (transfer_started_at IS NOT NULL);

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."connect_payout_run_shipments" TO "service_role";

COMMENT ON COLUMN "public"."connect_payout_run_shipments"."net_payout" IS 'Shipment payout amount in cents captured at release-run creation time.';

COMMENT ON COLUMN "public"."connect_payout_run_shipments"."transfer_started_at" IS 'Write-ahead possible Stripe Transfer effect. Never cleared by TTL, resume, payout failure or cancellation. An uncertain response requires investigation, never another create.';

COMMENT ON COLUMN "public"."connect_payout_run_shipments"."transfer_token" IS 'Opaque immutable ownership of the shipment Transfer attempt within this existing run mapping; conditional identity completion only, not a reclaimable lease.';

COMMENT ON TABLE "public"."connect_payout_run_shipments" IS 'Shipment-to-payout-run mapping for Connect manual release reconciliation.';

REVOKE ALL ON TABLE "public"."connect_payout_run_shipments" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."connect_payout_run_shipments" TO "postgres";

REVOKE ALL ON TABLE "public"."connect_payout_run_shipments" FROM "anon", "authenticated";
