import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import Stripe from "https://esm.sh/stripe@17.0.0";
import { z } from "https://esm.sh/zod@3.23.8";

import type { Database } from "../../../packages/types/src/database.types.ts";
import { extractStripeChargeId } from "../_shared/stripe-charge.ts";
import {
  claimCheckoutRecoveryShells,
  compensateRecoveryShell,
  isAuthorizedCheckoutRecoveryWorker,
  processRecoveryClaimsSequentially,
} from "./recovery.ts";

const RecoveryChargeEvidenceSchema = z.string().min(1);

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") || "", {
  apiVersion: "2026-04-22.dahlia",
  httpClient: Stripe.createFetchHttpClient(),
});

serve(async (request) => {
  const workerServiceRoleJwt = Deno.env.get(
    "CHECKOUT_RECOVERY_SERVICE_ROLE_JWT",
  )?.trim();
  if (
    !workerServiceRoleJwt ||
    !isAuthorizedCheckoutRecoveryWorker({
      authorization: request.headers.get("authorization"),
      workerServiceRoleJwt,
    })
  ) {
    return new Response("Unauthorized", { status: 401 });
  }

  const supabase = createClient<Database>(
    Deno.env.get("SUPABASE_URL") || "",
    workerServiceRoleJwt,
  );
  let lockAcquired = false;

  try {
    const { data: lock, error: lockError } = await supabase
      .from("system_settings")
      .update({ checkout_recovery_running: true } as never)
      .eq("id", 1)
      .eq("checkout_recovery_enabled" as never, true)
      .eq("checkout_recovery_running" as never, false)
      .select("id")
      .maybeSingle();
    if (lockError) {
      throw new Error(
        `CHECKOUT_RECOVERY_LOCK_ACQUIRE_FAILED: ${lockError.message}`,
      );
    }
    if (!lock) {
      return Response.json({ received: true, skipped: true });
    }
    lockAcquired = true;

    const claims = await claimCheckoutRecoveryShells(
      async ({ limit, scope }) => {
        const { data, error } = await supabase.rpc(
          "fn_claim_checkout_recovery_shells" as never,
          {
            p_limit: limit,
            p_stripe_payment_intent_id: null,
            p_claim_scope: scope,
          } as never,
        );
        if (error) {
          throw new Error(`CHECKOUT_RECOVERY_CLAIM_FAILED: ${error.message}`);
        }

        return (data ?? []) as Array<{
          stripe_payment_intent_id: string;
          stripe_charge_id: string | null;
        }>;
      },
    );
    const results = await processRecoveryClaimsSequentially(
      claims,
      async (claim) => {
        const derivedChargeId = claim.stripe_charge_id
          ? null
          : extractStripeChargeId(
            await stripe.paymentIntents.retrieve(
              claim.stripe_payment_intent_id,
              { expand: ["latest_charge"] },
            ),
          );
        let chargeId = claim.stripe_charge_id ?? derivedChargeId;

        if (derivedChargeId) {
          const { data, error } = await supabase.rpc(
            "fn_set_checkout_recovery_charge_evidence" as never,
            {
              p_stripe_payment_intent_id: claim.stripe_payment_intent_id,
              p_stripe_charge_id: derivedChargeId,
            } as never,
          );
          if (error) {
            throw new Error(
              `CHECKOUT_RECOVERY_EVIDENCE_PERSIST_FAILED: ${error.message}`,
            );
          }
          const parsedEvidence = RecoveryChargeEvidenceSchema.safeParse(data);
          if (!parsedEvidence.success) {
            throw new Error("CHECKOUT_RECOVERY_EVIDENCE_PERSIST_EMPTY");
          }
          chargeId = parsedEvidence.data;
        }

        if (!chargeId) {
          const { error } = await supabase.rpc(
            "fn_mark_checkout_recovery_reconciliation_needed" as never,
            {
              p_stripe_payment_intent_id: claim.stripe_payment_intent_id,
              p_error: "STANDALONE_CHARGE_EVIDENCE_MISSING",
            } as never,
          );
          if (error) {
            throw new Error(
              `CHECKOUT_RECOVERY_RECONCILIATION_MARK_FAILED: ${error.message}`,
            );
          }
        }

        const charge = chargeId
          ? ((await stripe.charges.retrieve(chargeId)) as Stripe.Charge & {
            transfer?: string | { id?: string } | null;
          })
          : null;

        return compensateRecoveryShell(
          {
            paymentIntentId: claim.stripe_payment_intent_id,
            hasDestinationTransfer: Boolean(charge?.transfer),
            chargeEvidence: chargeId ? "present" : "missing",
          },
          {
            claim: async () => ({ kind: "claimed" as const }),
            createRefund: async (params) => {
              const refund = await stripe.refunds.create(
                {
                  payment_intent: params.paymentIntentId,
                  ...(params.reverseTransfer ? { reverse_transfer: true } : {}),
                },
                { idempotencyKey: params.idempotencyKey },
              );
              if (!refund.id || refund.status !== "succeeded") {
                throw new Error(
                  `STRIPE_REFUND_NOT_CONFIRMED:${refund.status ?? "unknown"}`,
                );
              }
              return { id: refund.id };
            },
            finalize: async ({ refundId }) => {
              const { error: finalizeError } = await supabase.rpc(
                "fn_finalize_checkout_recovery" as never,
                {
                  p_stripe_payment_intent_id: claim.stripe_payment_intent_id,
                  p_stripe_refund_id: refundId,
                } as never,
              );
              if (finalizeError) {
                throw new Error(
                  `CHECKOUT_RECOVERY_FINALIZE_FAILED: ${finalizeError.message}`,
                );
              }
            },
            queueRetry: async ({ error: retryError }) => {
              const { error: queueError } = await supabase.rpc(
                "fn_mark_checkout_recovery_retry" as never,
                {
                  p_stripe_payment_intent_id: claim.stripe_payment_intent_id,
                  p_error: retryError,
                } as never,
              );
              if (queueError) {
                throw new Error(
                  `CHECKOUT_RECOVERY_RETRY_QUEUE_FAILED: ${queueError.message}`,
                );
              }
            },
          },
        );
      },
    );

    return Response.json({
      received: true,
      processed: results.length,
      results,
    });
  } finally {
    if (lockAcquired) {
      const { error: releaseError } = await supabase
        .from("system_settings")
        .update({ checkout_recovery_running: false } as never)
        .eq("id", 1);
      if (releaseError) {
        throw new Error(
          `CHECKOUT_RECOVERY_LOCK_RELEASE_FAILED: ${releaseError.message}`,
        );
      }
    }
  }
});
