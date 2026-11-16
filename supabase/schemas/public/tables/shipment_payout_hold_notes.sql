CREATE TABLE "public"."shipment_payout_hold_notes" (
  "id"          uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "shipment_id" uuid                     NOT NULL,
  "admin_id"    uuid                     NOT NULL,
  "note"        text                     NOT NULL,
  "created_at"  timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "shipment_payout_hold_notes_note_check" CHECK (((note = btrim(note, E' \t\n\r'::text)) AND ((char_length(note) >= 1) AND (char_length(note) <= 1000)))),
  CONSTRAINT "shipment_payout_hold_notes_pkey" PRIMARY KEY (id),
  CONSTRAINT "shipment_payout_hold_notes_admin_id_fkey" FOREIGN KEY (admin_id) REFERENCES public.profiles(id) ON DELETE RESTRICT,
  CONSTRAINT "shipment_payout_hold_notes_shipment_id_fkey" FOREIGN KEY (shipment_id) REFERENCES public.shipments(id) ON DELETE RESTRICT
);

ALTER TABLE "public"."shipment_payout_hold_notes"
  ENABLE ROW LEVEL SECURITY;

CREATE INDEX ix_shipment_payout_hold_notes_admin_id ON public.shipment_payout_hold_notes USING btree (admin_id);

CREATE INDEX ix_shipment_payout_hold_notes_shipment_created ON public.shipment_payout_hold_notes USING btree (shipment_id, created_at DESC);

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."shipment_payout_hold_notes" TO "service_role";

COMMENT ON TABLE "public"."shipment_payout_hold_notes" IS 'Append-only notes an admin writes when keeping an overdue held payout on hold (#549). Written only by fn_admin_record_payout_hold_note, which also writes the admin_audit_logs row; clients have no grants and no policy.';

REVOKE ALL ON TABLE "public"."shipment_payout_hold_notes" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."shipment_payout_hold_notes" TO "postgres";

REVOKE ALL ON TABLE "public"."shipment_payout_hold_notes" FROM "anon", "authenticated";
