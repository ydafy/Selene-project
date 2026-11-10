CREATE TABLE "public"."shipment_cancellation_operations" (
  "shipment_id"                      uuid                     NOT NULL,
  "order_id"                         uuid                     NOT NULL,
  "operation_key"                    text                     GENERATED ALWAYS AS (('cancel_shipment_'::text || (shipment_id)::text)) STORED,
  "source"                           text                     NOT NULL,
  "actor_id"                         uuid,
  "reason"                           text                     NOT NULL,
  "claim_token"                      uuid                     NOT NULL,
  "claim_expires_at"                 timestamp with time zone NOT NULL,
  "external_started_at"              timestamp with time zone,
  "created_at"                       timestamp with time zone NOT NULL DEFAULT now(),
  "refund_request"                   jsonb,
  "cancellation_loss_cents"          bigint,
  "refund_id"                        text,
  "refund_status"                    text,
  "refund_failure_reason"            text,
  "refund_status_updated_at"         timestamp with time zone,
  "recovery_escalated_at"            timestamp with time zone,
  "recovery_escalation_reason"       text,
  "refund_resolved_at"               timestamp with time zone,
  "refund_resolved_by"               uuid,
  "refund_resolution_reference"      text,
  "carrier_cancellation_outcome"     text,
  "carrier_cancellation_recorded_at" timestamp with time zone,
  "carrier_balance_returned"         boolean,
  "carrier_balance_returned_at"      timestamp with time zone,
  "label_cost_loss_cents"            bigint,
  "review_reason"                    text,
  "review_required_at"               timestamp with time zone,
  "review_resolution"                text,
  "review_resolved_at"               timestamp with time zone,
  "review_resolved_by"               uuid,
  "review_resolution_note"           text,
  "late_carrier_activity_at"         timestamp with time zone,
  CONSTRAINT "shipment_cancellation_operat_carrier_cancellation_outcome_check"
    CHECK ((carrier_cancellation_outcome = ANY (ARRAY['accepted'::text, 'refused'::text, 'ambiguous'::text]))),
  CONSTRAINT "shipment_cancellation_operatio_recovery_escalation_reason_check"
    CHECK ((recovery_escalation_reason = ANY (ARRAY['refund_not_found'::text, 'refund_ambiguous'::text]))),
  CONSTRAINT "shipment_cancellation_operations_cancellation_loss_cents_check" CHECK ((cancellation_loss_cents >= 0)),
  CONSTRAINT "shipment_cancellation_operations_carrier_balance_consistent"
    CHECK
    ((((carrier_cancellation_outcome IS DISTINCT FROM 'accepted'::text) AND (carrier_balance_returned IS NULL) AND (carrier_balance_returned_at IS NULL) AND ((label_cost_loss_cents
    IS NULL) OR (NOT (review_resolution IS DISTINCT FROM 'refund_approved'::text)))) OR
    ((NOT (carrier_cancellation_outcome IS DISTINCT FROM 'accepted'::text)) AND (carrier_balance_returned IS NOT NULL)))),
  CONSTRAINT "shipment_cancellation_operations_carrier_balance_date" CHECK (((carrier_balance_returned_at IS NULL) OR (carrier_balance_returned IS TRUE))),
  CONSTRAINT "shipment_cancellation_operations_carrier_balance_no_loss" CHECK (((carrier_balance_returned IS NOT TRUE) OR (label_cost_loss_cents = 0))),
  CONSTRAINT "shipment_cancellation_operations_carrier_outcome_recorded" CHECK (((carrier_cancellation_outcome IS NULL) = (carrier_cancellation_recorded_at IS NULL))),
  CONSTRAINT "shipment_cancellation_operations_check" CHECK ((((source = ANY (ARRAY['buyer'::text, 'seller'::text])) AND (actor_id IS
    NOT NULL)) OR ((source = ANY (ARRAY['paid_timeout'::text, 'preparing_timeout'::text])) AND (actor_id IS NULL)))),
  CONSTRAINT "shipment_cancellation_operations_escalation_recorded" CHECK (((recovery_escalated_at IS NULL) = (recovery_escalation_reason IS NULL))),
  CONSTRAINT "shipment_cancellation_operations_label_cost_loss_cents_check" CHECK ((label_cost_loss_cents >= 0)),
  CONSTRAINT "shipment_cancellation_operations_late_activity_after_start" CHECK (((late_carrier_activity_at IS NULL) OR (external_started_at IS NOT NULL))),
  CONSTRAINT "shipment_cancellation_operations_order_id_fkey" FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE RESTRICT,
  CONSTRAINT "shipment_cancellation_operations_pkey" PRIMARY KEY (shipment_id),
  CONSTRAINT "shipment_cancellation_operations_reason_check" CHECK ((length(btrim(reason)) > 0)),
  CONSTRAINT "shipment_cancellation_operations_refund_recorded"
    CHECK ((((refund_id IS NULL) = (refund_status IS NULL)) AND ((refund_status IS NULL) = (refund_status_updated_at IS NULL)))),
  CONSTRAINT "shipment_cancellation_operations_refund_resolution_recorded"
    CHECK ((((refund_resolved_at IS NULL) = (refund_resolved_by IS NULL)) AND ((refund_resolved_at IS NULL) = (refund_resolution_reference IS NULL)))),
  CONSTRAINT "shipment_cancellation_operations_refund_resolution_reference"
    CHECK
    (((refund_resolution_reference IS NULL) OR ((refund_resolution_reference = btrim(refund_resolution_reference)) AND ((char_length(refund_resolution_reference) >= 1) AND
    (char_length(refund_resolution_reference) <= 200))))),
  CONSTRAINT "shipment_cancellation_operations_refund_resolution_status"
    CHECK
    (((refund_resolved_at IS NULL) OR COALESCE((refund_status = ANY (ARRAY['failed'::text, 'canceled'::text])), false) OR ((refund_id IS NULL) AND (refund_status IS NULL) AND
    (recovery_escalated_at IS NOT NULL)))),
  CONSTRAINT "shipment_cancellation_operations_refund_status_check"
    CHECK ((refund_status = ANY (ARRAY['pending'::text, 'requires_action'::text, 'succeeded'::text, 'failed'::text, 'canceled'::text]))),
  CONSTRAINT "shipment_cancellation_operations_review_note_format"
    CHECK
    (((review_resolution_note IS NULL) OR ((review_resolution_note = btrim(review_resolution_note)) AND ((char_length(review_resolution_note) >= 1) AND
    (char_length(review_resolution_note) <= 500))))),
  CONSTRAINT "shipment_cancellation_operations_review_reason_check"
    CHECK ((review_reason = ANY (ARRAY['tracking_unknown'::text, 'carrier_refused'::text, 'carrier_ambiguous'::text]))),
  CONSTRAINT "shipment_cancellation_operations_review_recorded" CHECK (((review_reason IS NULL) = (review_required_at IS NULL))),
  CONSTRAINT "shipment_cancellation_operations_review_resolution_after_requir" CHECK (((review_resolution IS NULL) OR (review_required_at IS NOT NULL))),
  CONSTRAINT "shipment_cancellation_operations_review_resolution_check" CHECK ((review_resolution = ANY (ARRAY['refund_approved'::text, 'closed_no_refund'::text]))),
  CONSTRAINT "shipment_cancellation_operations_review_resolution_recorded"
    CHECK
    ((((review_resolution IS NULL) = (review_resolved_at IS NULL)) AND ((review_resolution IS NULL) = (review_resolved_by IS NULL)) AND ((review_resolution IS NULL) =
    (review_resolution_note IS NULL)))),
  CONSTRAINT "shipment_cancellation_operations_source_check" CHECK ((source = ANY (ARRAY['buyer'::text, 'seller'::text, 'paid_timeout'::text, 'preparing_timeout'::text]))),
  CONSTRAINT "shipment_cancellation_operations_shipment_id_fkey" FOREIGN KEY (shipment_id) REFERENCES public.shipments(id) ON DELETE RESTRICT
);

ALTER TABLE "public"."shipment_cancellation_operations"
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."shipment_cancellation_operations"
  ADD COLUMN "late_carrier_activity_event_type" public.shipment_tracking_event_type;

ALTER TABLE "public"."shipment_cancellation_operations"
  ADD COLUMN "late_carrier_activity_acknowledged_at" timestamp WITH time zone;

ALTER TABLE "public"."shipment_cancellation_operations"
  ADD COLUMN "late_carrier_activity_acknowledged_by" uuid;

ALTER TABLE "public"."shipment_cancellation_operations"
  ADD COLUMN "late_carrier_activity_acknowledged_note" text;

ALTER TABLE "public"."shipment_cancellation_operations"
  ADD CONSTRAINT "shipment_cancellation_operations_late_activity_ack_after_activi" CHECK (((late_carrier_activity_acknowledged_at IS NULL) OR (late_carrier_activity_at IS
    NOT NULL)));

ALTER TABLE "public"."shipment_cancellation_operations"
  ADD CONSTRAINT "shipment_cancellation_operations_late_activity_ack_note_format"
    CHECK
    (((late_carrier_activity_acknowledged_note IS NULL) OR ((late_carrier_activity_acknowledged_note = btrim(late_carrier_activity_acknowledged_note)) AND
    ((char_length(late_carrier_activity_acknowledged_note) >= 1) AND (char_length(late_carrier_activity_acknowledged_note) <= 200)))));

ALTER TABLE "public"."shipment_cancellation_operations"
  ADD CONSTRAINT "shipment_cancellation_operations_late_activity_ack_recorded"
    CHECK
    ((((late_carrier_activity_acknowledged_at IS NULL) = (late_carrier_activity_acknowledged_by IS NULL)) AND ((late_carrier_activity_acknowledged_at IS NULL) =
    (late_carrier_activity_acknowledged_note IS NULL))));

ALTER TABLE "public"."shipment_cancellation_operations"
  ADD CONSTRAINT "shipment_cancellation_operations_late_activity_recorded" CHECK (((late_carrier_activity_at IS NULL) = (late_carrier_activity_event_type IS NULL)));

CREATE UNIQUE INDEX shipment_cancellation_operations_refund_id_key ON public.shipment_cancellation_operations USING btree (refund_id)
  WHERE (refund_id IS NOT NULL);

COMMENT ON COLUMN "public"."shipment_cancellation_operations"."cancellation_loss_cents" IS 'Frozen proportional actual Stripe fee loss for the later DB cancellation. NULL means reconciliation was unavailable, not zero.';

COMMENT ON COLUMN "public"."shipment_cancellation_operations"."carrier_balance_returned" IS 'Whether the carrier returned the label cost (Envia balanceReturned). Only set with an accepted outcome; label cancellation and label money returned are separate facts.';

COMMENT ON COLUMN "public"."shipment_cancellation_operations"."carrier_balance_returned_at" IS 'When the carrier returned the label cost (Envia balanceReturnDate). Only with carrier_balance_returned true; may stay NULL if the carrier gave no date.';

COMMENT ON COLUMN "public"."shipment_cancellation_operations"."carrier_cancellation_outcome" IS 'What the carrier answered to the label cancellation: accepted, refused or ambiguous. NULL means no carrier cancellation was recorded. Set once by fn_record_shipment_carrier_cancellation; only accepted lets a preparing-timeout refund start.';

COMMENT ON COLUMN "public"."shipment_cancellation_operations"."carrier_cancellation_recorded_at" IS 'When the carrier outcome was recorded. NULL together with carrier_cancellation_outcome.';

COMMENT ON COLUMN "public"."shipment_cancellation_operations"."external_started_at" IS 'Write-ahead fence set before a possible external call. Not proof of Stripe success. Once set, no claim or repeated start authorizes another call, regardless of lease expiry.';

COMMENT ON COLUMN "public"."shipment_cancellation_operations"."label_cost_loss_cents" IS 'Label cost Selene lost on this cancellation, in cents, computed by SQL: 0 when the balance was returned, shipments.label_provider_cost_cents when it was not. NULL means unknown or label not cancelled, not zero. Separate from cancellation_loss_cents (Stripe fee loss) and from the buyer refund.';

COMMENT ON COLUMN "public"."shipment_cancellation_operations"."late_carrier_activity_acknowledged_at" IS 'When an admin acknowledged the carrier activity recorded after the refund started. Set once by fn_acknowledge_shipment_late_carrier_activity; NULL together with the by and note columns.';

COMMENT ON COLUMN "public"."shipment_cancellation_operations"."late_carrier_activity_acknowledged_by" IS 'Admin profile that acknowledged it. Kept together with late_carrier_activity_acknowledged_at.';

COMMENT ON COLUMN "public"."shipment_cancellation_operations"."late_carrier_activity_acknowledged_note" IS 'Admin-provided note, 1-200 characters, trimmed. Kept together with late_carrier_activity_acknowledged_at.';

COMMENT ON COLUMN "public"."shipment_cancellation_operations"."late_carrier_activity_at" IS 'When the first carrier scan that would have advanced the shipment arrived after the refund started. Set once by fn_record_tracking_event; NULL together with late_carrier_activity_event_type. The shipment status is not changed by the scan.';

COMMENT ON COLUMN "public"."shipment_cancellation_operations"."late_carrier_activity_event_type" IS 'Event type of that first scan. Kept together with late_carrier_activity_at.';

COMMENT ON COLUMN "public"."shipment_cancellation_operations"."recovery_escalated_at" IS 'When automatic recovery gave up on this operation (no or several Stripe refunds found). Set once by fn_escalate_shipment_cancellation; clearing it is admin work.';

COMMENT ON COLUMN "public"."shipment_cancellation_operations"."recovery_escalation_reason" IS 'Why recovery escalated: refund_not_found or refund_ambiguous. Kept together with recovery_escalated_at.';

COMMENT ON COLUMN "public"."shipment_cancellation_operations"."refund_failure_reason" IS 'Stripe failure_reason, kept only while refund_status is failed.';

COMMENT ON COLUMN "public"."shipment_cancellation_operations"."refund_id" IS 'Stripe refund ID for this shipment''s frozen refund request. Written only by fn_record_shipment_cancellation_refund.';

COMMENT ON COLUMN "public"."shipment_cancellation_operations"."refund_request" IS 'Exact server-reconstructed Stripe refund params, frozen atomically with external_started_at. Not a refund result; existing B1.1 fences are never reopened.';

COMMENT ON COLUMN "public"."shipment_cancellation_operations"."refund_resolution_reference" IS 'Admin-provided proof of the manual repayment (for example a SPEI tracking key), 1-200 characters, trimmed.';

COMMENT ON COLUMN "public"."shipment_cancellation_operations"."refund_resolved_at" IS 'When an admin marked a failed or canceled refund as resolved (money returned outside Stripe). Set once by fn_resolve_shipment_cancellation_refund.';

COMMENT ON COLUMN "public"."shipment_cancellation_operations"."refund_resolved_by" IS 'Admin profile that resolved the refund. Kept together with refund_resolved_at.';

COMMENT ON COLUMN "public"."shipment_cancellation_operations"."refund_status" IS 'Last accepted Stripe refund status. Only succeeded allows fn_cancel_shipment; succeeded may still move to failed later.';

COMMENT ON COLUMN "public"."shipment_cancellation_operations"."review_reason" IS 'Why the preparing-timeout cancellation needs an admin: tracking_unknown, carrier_refused or carrier_ambiguous. Set once by fn_mark_shipment_cancellation_review; NULL together with review_required_at.';

COMMENT ON COLUMN "public"."shipment_cancellation_operations"."review_required_at" IS 'When the operation was marked for carrier review. While review_resolution is NULL the claim raises SHIPMENT_CANCELLATION_UNDER_REVIEW.';

COMMENT ON COLUMN "public"."shipment_cancellation_operations"."review_resolution" IS 'Final admin decision: refund_approved (the next run may start the refund) or closed_no_refund (the claim raises SHIPMENT_CANCELLATION_REVIEW_CLOSED). Set once by fn_resolve_shipment_cancellation_review.';

COMMENT ON COLUMN "public"."shipment_cancellation_operations"."review_resolution_note" IS 'Admin-provided reason for the decision, 1-500 characters, trimmed. Kept together with review_resolution.';

COMMENT ON COLUMN "public"."shipment_cancellation_operations"."review_resolved_at" IS 'When the admin resolved the review. Kept together with review_resolution.';

COMMENT ON COLUMN "public"."shipment_cancellation_operations"."review_resolved_by" IS 'Admin profile that resolved the review. Kept together with review_resolution.';

COMMENT ON TABLE "public"."shipment_cancellation_operations" IS 'One durable cancellation identity per shipment. Claim/start RPCs own the fence; fn_record_shipment_cancellation_refund records the Stripe refund. TTL never clears external_started_at.';

REVOKE ALL ON TABLE "public"."shipment_cancellation_operations" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."shipment_cancellation_operations" TO "postgres";

REVOKE ALL ON TABLE "public"."shipment_cancellation_operations" FROM "anon", "authenticated", "service_role";
