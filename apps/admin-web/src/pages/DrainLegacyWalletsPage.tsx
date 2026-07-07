/**
 * @file apps/admin-web/src/pages/DrainLegacyWalletsPage.tsx
 * @description Admin Dashboard Page for orchestrating the legacy wallet drain migration (CON-005).
 *
 * Implements:
 * 1. KPI cards displaying real-time metrics of the drain job: success counts, total money moved, failures, and skips.
 * 2. Visual safety warning banner highlighting that this is a critical, irreversible Phase 6 operation.
 * 3. Two-tiered execution control:
 *    - "Dry Run": Triggers a simulated, non-destructive preview of the migration results.
 *    - "Execute Drain": Triggers the actual live Stripe Connect transfers and database wallet zero-outs.
 *
 * Prevents double-submission by disabling triggers during mutation loading states.
 *
 * @version 1.0
 * @domain admin-migration-pages
 */

import { useState } from 'react';
import { toast } from 'sonner';
import { AlertTriangle, PlayCircle } from 'lucide-react';
import {
  useDrainLegacyWallets,
  type DrainLegacyWalletsResult,
} from '../hooks/useDrainLegacyWallets';
import { centsToMoney } from '../lib/connectEarnings';

const formatCurrency = (amount: number) =>
  new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: 'MXN',
  }).format(amount);

export const DrainLegacyWalletsPage = () => {
  const [lastResult, setLastResult] = useState<DrainLegacyWalletsResult | null>(
    null,
  );
  const drainMutation = useDrainLegacyWallets();

  const runDrain = async (dryRun: boolean) => {
    try {
      const result = await drainMutation.mutateAsync({ dryRun });
      setLastResult(result);
      if (result.success) {
        toast.success(dryRun ? 'Dry run completed' : 'Drain job completed');
      } else {
        toast.error(result.error ?? 'Drain job failed');
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Drain job failed');
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Drain Legacy Wallets</h1>
        <p className="text-blue-light text-sm">
          Transfer remaining wallet balances to sellers' Stripe Connect
          accounts. Successful transfers zero wallets; failures preserve
          balances and write audit logs.
        </p>
      </div>

      <div className="bg-fire/10 border border-fire/30 rounded-2xl p-4 flex gap-3">
        <AlertTriangle className="text-fire shrink-0" />
        <p className="text-sm text-platinum">
          This is the Phase 6 point-of-no-return operation. Run a dry run first,
          verify seller onboarding, then execute the real drain once.
        </p>
      </div>

      <div className="flex gap-3">
        <button
          onClick={() => runDrain(true)}
          disabled={drainMutation.isPending}
          className="px-4 py-2 bg-state-gray border border-white/10 text-platinum rounded-xl text-sm font-bold hover:bg-white/10 disabled:opacity-50"
        >
          Dry Run
        </button>
        <button
          onClick={() => runDrain(false)}
          disabled={drainMutation.isPending}
          className="flex items-center gap-2 px-4 py-2 bg-lion text-night rounded-xl text-sm font-bold hover:bg-lion/90 disabled:opacity-50"
        >
          <PlayCircle size={16} /> Execute Drain
        </button>
      </div>

      {lastResult && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="bg-white/5 border border-white/10 rounded-2xl p-4">
            <p className="text-xs text-blue-light uppercase font-bold">
              Transferred
            </p>
            <p className="text-2xl font-bold text-emerald-400">
              {lastResult.transferredCount ?? 0}
            </p>
          </div>
          <div className="bg-white/5 border border-white/10 rounded-2xl p-4">
            <p className="text-xs text-blue-light uppercase font-bold">
              Amount
            </p>
            <p className="text-2xl font-bold text-lion">
              {formatCurrency(centsToMoney(lastResult.transferredCents ?? 0))}
            </p>
          </div>
          <div className="bg-white/5 border border-white/10 rounded-2xl p-4">
            <p className="text-xs text-blue-light uppercase font-bold">
              Failed
            </p>
            <p className="text-2xl font-bold text-fire">
              {lastResult.failedCount ?? 0}
            </p>
          </div>
          <div className="bg-white/5 border border-white/10 rounded-2xl p-4">
            <p className="text-xs text-blue-light uppercase font-bold">
              Skipped
            </p>
            <p className="text-2xl font-bold text-blue-light">
              {lastResult.skippedCount ?? 0}
            </p>
          </div>
        </div>
      )}
    </div>
  );
};
