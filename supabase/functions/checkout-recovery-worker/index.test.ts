import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  claimCheckoutRecoveryShells,
  isAuthorizedCheckoutRecoveryWorker,
  processRecoveryClaimsSequentially,
} from "./recovery.ts";

describe("checkout recovery worker authorization", () => {
  it("rejects an empty dedicated worker JWT instead of authorizing Bearer whitespace", () => {
    expect(
      isAuthorizedCheckoutRecoveryWorker({
        authorization: "Bearer ",
        workerServiceRoleJwt: "",
      }),
    ).toBe(false);
  });

  it("reads the dedicated worker JWT once and reuses it for authorization and the admin client", () => {
    const source = readFileSync(
      join(
        process.cwd(),
        "supabase/functions/checkout-recovery-worker/index.ts",
      ),
      "utf8",
    );

    expect(
      source.match(
        /Deno\.env\.get\(\s*"CHECKOUT_RECOVERY_SERVICE_ROLE_JWT"/g,
      ),
    ).toHaveLength(1);
    expect(source).toMatch(
      /const workerServiceRoleJwt = Deno\.env\.get\(\s*"CHECKOUT_RECOVERY_SERVICE_ROLE_JWT",?\s*\)\?\.trim\(\);/,
    );
    expect(source).toMatch(
      /isAuthorizedCheckoutRecoveryWorker\(\{\s*authorization: request\.headers\.get\("authorization"\),\s*workerServiceRoleJwt,\s*}\)/,
    );
    expect(source).toMatch(
      /createClient<Database>\(\s*Deno\.env\.get\("SUPABASE_URL"\) \|\| "",\s*workerServiceRoleJwt,\s*\)/,
    );
  });

  it("has no service-role or secret-key fallback", () => {
    const source = readFileSync(
      join(
        process.cwd(),
        "supabase/functions/checkout-recovery-worker/index.ts",
      ),
      "utf8",
    );

    expect(source).not.toContain('Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")');
    expect(source).not.toContain("SUPABASE_SECRET_KEYS");
  });
});

describe("checkout recovery worker cron claims", () => {
  it("acquires its enabled-only overlap lock atomically before claiming work and releases it in finally", () => {
    const source = readFileSync(
      join(
        process.cwd(),
        "supabase/functions/checkout-recovery-worker/index.ts",
      ),
      "utf8",
    );

    expect(source).toContain('.eq("checkout_recovery_enabled" as never, true)');
    expect(source).toContain(
      '.eq("checkout_recovery_running" as never, false)',
    );
    expect(source).toContain(
      ".update({ checkout_recovery_running: true } as never)",
    );
    expect(source).toContain("if (!lock)");
    expect(source).toContain(
      "return Response.json({ received: true, skipped: true });",
    );
    expect(source).toContain("} finally {");
    expect(source).toContain(
      ".update({ checkout_recovery_running: false } as never)",
    );
    expect(source.indexOf("const claims = await claimCheckoutRecoveryShells"))
      .toBeGreaterThan(
        source.indexOf("lockAcquired = true"),
      );
  });

  it("derives missing charge evidence from an expanded PaymentIntent before refund work", () => {
    const source = readFileSync(
      join(
        process.cwd(),
        "supabase/functions/checkout-recovery-worker/index.ts",
      ),
      "utf8",
    );

    expect(source).toContain(
      'import { extractStripeChargeId } from "../_shared/stripe-charge.ts";',
    );
    expect(source).toContain("await stripe.paymentIntents.retrieve(");
    expect(source).toContain('expand: ["latest_charge"]');
    expect(source).toContain("fn_set_checkout_recovery_charge_evidence");
  });

  it("records missing charge evidence for reconciliation before the state machine can refund", () => {
    const source = readFileSync(
      join(
        process.cwd(),
        "supabase/functions/checkout-recovery-worker/index.ts",
      ),
      "utf8",
    );

    expect(source).toContain(
      "fn_mark_checkout_recovery_reconciliation_needed",
    );
    expect(source).toContain('p_error: "STANDALONE_CHARGE_EVIDENCE_MISSING"');
    expect(source).toContain(
      'chargeEvidence: chargeId ? "present" : "missing"',
    );
  });

  it("does not start the next claim until the current claim completes", async () => {
    const started: string[] = [];
    let releaseFirst: (() => void) | undefined;
    const firstCompleted = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const processing = processRecoveryClaimsSequentially(
      ["pi_first", "pi_second"],
      async (paymentIntentId) => {
        started.push(paymentIntentId);
        if (paymentIntentId === "pi_first") await firstCompleted;
        return `${paymentIntentId}:complete`;
      },
    );

    await Promise.resolve();
    expect(started).toEqual(["pi_first"]);

    releaseFirst?.();
    await expect(processing).resolves.toEqual([
      "pi_first:complete",
      "pi_second:complete",
    ]);
    expect(started).toEqual(["pi_first", "pi_second"]);
  });

  it("delegates cron claims into the sequential recovery processor", () => {
    const source = readFileSync(
      join(
        process.cwd(),
        "supabase/functions/checkout-recovery-worker/index.ts",
      ),
      "utf8",
    );

    expect(source).toContain("claimCheckoutRecoveryShells");
    expect(source).toContain(
      "const claims = await claimCheckoutRecoveryShells",
    );
    expect(source).toContain("processRecoveryClaimsSequentially");
    expect(source).not.toContain("Promise.all(");
    expect(
      source.indexOf("const claims = await claimCheckoutRecoveryShells"),
    ).toBeLessThan(
      source.indexOf("const results = await processRecoveryClaimsSequentially"),
    );
  });

  it("claims twelve order shells before thirteen standalone shells and preserves that order", async () => {
    const calls: Array<{ limit: number; scope: "order" | "standalone" }> = [];

    const claims = await claimCheckoutRecoveryShells(async (input) => {
      calls.push(input);
      return input.scope === "order"
        ? [{ stripe_payment_intent_id: "pi_order" }]
        : [{ stripe_payment_intent_id: "pi_standalone" }];
    });

    expect(calls).toEqual([
      { limit: 12, scope: "order" },
      { limit: 13, scope: "standalone" },
    ]);
    expect(claims).toEqual([
      { stripe_payment_intent_id: "pi_order" },
      { stripe_payment_intent_id: "pi_standalone" },
    ]);
  });

  it("propagates a standalone claim failure instead of processing partial cron claims", async () => {
    const calls: Array<{ limit: number; scope: "order" | "standalone" }> = [];

    await expect(
      claimCheckoutRecoveryShells(async (input) => {
        calls.push(input);
        if (input.scope === "standalone") throw new Error("claim failed");
        return [{ stripe_payment_intent_id: "pi_order" }];
      }),
    ).rejects.toThrow("claim failed");

    expect(calls).toEqual([
      { limit: 12, scope: "order" },
      { limit: 13, scope: "standalone" },
    ]);
  });
});
