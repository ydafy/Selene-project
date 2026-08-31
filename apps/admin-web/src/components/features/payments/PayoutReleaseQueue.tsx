/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  Wallet,
  Building2,
  CheckCircle2,
  AlertTriangle,
  User,
  CheckSquare,
  Square,
} from 'lucide-react';
import { formatCurrency } from '../../../lib/utils/formatCurrency';
import { centsToMoney } from '../../../lib/connectEarnings';
import { getSelectedEligibleShipmentIds } from '../../../lib/connectPayoutReleaseQueue';

const TABLE_HEADERS = [
  { label: 'Seleccionar', align: 'text-left' },
  { label: 'ID Envío', align: 'text-left' },
  { label: 'ID Orden', align: 'text-left' },
  { label: 'Monto a Dispersar', align: 'text-left' },
  { label: 'Estado del Escrow', align: 'text-left' },
  { label: 'Conciliación', align: 'text-left' },
] as const;

const formatReason = (reason: string | null) =>
  reason ? reason.replaceAll('_', ' ').toLowerCase() : 'En proceso';

interface PayoutReleaseQueueProps {
  batches: any[];
  isLoading: boolean;
  isReleasing: boolean;
  selectedShipmentsBySeller: Record<string, string[]>;
  onToggleShipment: (sellerId: string, shipmentId: string) => void;
  onSelectEligibleBatch: (sellerId: string, shipmentIds: string[]) => void;
  onSelectAllEligibleGlobally: () => void;
  onClearAllSelections: () => void;
  onRelease: (sellerId: string) => void;
}

export const PayoutReleaseQueue = ({
  batches,
  isLoading,
  isReleasing,
  selectedShipmentsBySeller,
  onToggleShipment,
  onSelectEligibleBatch,
  onSelectAllEligibleGlobally,
  onClearAllSelections,
  onRelease,
}: PayoutReleaseQueueProps) => {
  if (isLoading) {
    return (
      <div className="bg-state-gray border border-white/5 rounded-3xl p-12 flex flex-col items-center justify-center gap-3">
        <div className="w-8 h-8 border-2 border-lion border-t-transparent animate-spin rounded-full" />
        <p className="text-xs text-blue-light font-medium animate-pulse">
          Consultando cola de dispersión en Stripe Connect...
        </p>
      </div>
    );
  }

  if (batches.length === 0) {
    return (
      <div className="bg-state-gray border border-white/5 rounded-3xl p-12 text-center flex flex-col items-center justify-center">
        <div className="p-4 bg-forest/10 rounded-full mb-3">
          <CheckCircle2 size={32} className="text-forest" />
        </div>
        <h3 className="text-base font-bold text-platinum">
          No hay pagos pendientes de liberación
        </h3>
        <p className="text-xs text-blue-light mt-1 max-w-sm">
          Todos los paquetes entregados han sido dispersados a sus respectivos
          vendedores.
        </p>
      </div>
    );
  }

  const totalEligibleCount = batches.reduce(
    (sum, b) => sum + (b.eligibleShipmentCount || 0),
    0,
  );
  const hasSelections = Object.values(selectedShipmentsBySeller).some(
    (arr) => arr.length > 0,
  );

  return (
    <div className="space-y-6">
      {/* Cabecera con Botones Globales */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-platinum flex items-center gap-2">
            <Wallet size={20} className="text-lion" /> Cola de Dispersión Manual
            de Escrow
          </h2>
          <p className="text-xs text-blue-light mt-0.5">
            {batches.length} {batches.length === 1 ? 'vendedor' : 'vendedores'}{' '}
            con saldo retenido en Stripe
          </p>
        </div>

        {/* 🚀 BOTONES GLOBALES PARA AHORRAR TIEMPO */}
        <div className="flex items-center gap-3">
          {hasSelections && (
            <button
              type="button"
              onClick={onClearAllSelections}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/5 border border-white/10 text-xs font-semibold text-blue-light hover:text-platinum transition-colors cursor-pointer"
            >
              <Square size={14} /> Desmarcar Todo
            </button>
          )}
          {totalEligibleCount > 0 && (
            <button
              type="button"
              onClick={onSelectAllEligibleGlobally}
              disabled={isReleasing}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-lion/10 border border-lion/30 text-xs font-bold text-lion hover:bg-lion hover:text-night transition-all cursor-pointer disabled:opacity-40"
            >
              <CheckSquare size={14} /> Seleccionar Todos los Listos (
              {totalEligibleCount})
            </button>
          )}
        </div>
      </div>

      {/* ── TARJETAS INDEPENDIENTES POR VENDEDOR ── */}
      <div className="space-y-6">
        {batches.map((batch) => {
          const eligibleShipmentIds = batch.shipments
            .filter((shipment: any) => shipment.isEligible)
            .map((shipment: any) => shipment.shipmentId);
          const selectedShipmentIds = getSelectedEligibleShipmentIds(
            batch,
            selectedShipmentsBySeller[batch.sellerId] ?? [],
          );
          const selectedAmountCents = batch.shipments
            .filter((shipment: any) =>
              selectedShipmentIds.includes(shipment.shipmentId),
            )
            .reduce(
              (total: number, shipment: any) =>
                total + shipment.releaseAmountCents,
              0,
            );
          const canRelease = selectedShipmentIds.length > 0 && !isReleasing;

          return (
            <article
              key={batch.sellerId}
              className="bg-state-gray border border-white/5 rounded-3xl p-6 shadow-xl space-y-6 transition-all hover:border-lion/20"
            >
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between border-b border-white/5 pb-5">
                <div>
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="p-2 bg-white/5 rounded-xl text-lion">
                      <User size={20} />
                    </div>
                    <div>
                      <h3 className="font-bold text-lg text-platinum">
                        @{batch.sellerName ?? batch.sellerId}
                      </h3>
                      <p className="text-xs text-blue-light flex items-center gap-2 mt-0.5">
                        <Building2 size={13} className="text-blue-light/60" />
                        Cuenta Connect:{' '}
                        <code className="text-lion font-mono bg-lion/5 px-2 py-0.5 rounded border border-lion/10 text-[11px]">
                          {batch.stripeAccountId ?? 'Sin cuenta vinculada'}
                        </code>
                      </p>
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-4 bg-night/40 p-3 rounded-2xl border border-white/5">
                  <div className="text-right px-2">
                    <p className="text-[10px] text-blue-light uppercase font-bold tracking-widest">
                      Monto a Transferir
                    </p>
                    <p className="text-xl font-bold text-lion">
                      {formatCurrency(centsToMoney(selectedAmountCents))}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      onSelectEligibleBatch(batch.sellerId, eligibleShipmentIds)
                    }
                    disabled={eligibleShipmentIds.length === 0 || isReleasing}
                    className="rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-xs font-bold text-platinum transition-all hover:border-lion hover:text-lion disabled:cursor-not-allowed disabled:opacity-30 cursor-pointer"
                  >
                    Seleccionar Listos ({eligibleShipmentIds.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => onRelease(batch.sellerId)}
                    disabled={!canRelease}
                    className="rounded-xl bg-lion px-5 py-2.5 text-xs font-bold text-night transition-all hover:bg-lion/90 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 cursor-pointer shadow-lg shadow-lion/10"
                  >
                    {isReleasing ? 'Dispersando...' : 'Liberar Fondos'}
                  </button>
                </div>
              </div>

              <div className="overflow-x-auto rounded-2xl border border-white/5 bg-night/30">
                <table className="w-full text-xs">
                  <thead className="bg-white/5 text-blue-light uppercase text-[10px] font-bold tracking-wider">
                    <tr>
                      {TABLE_HEADERS.map((h, idx) => (
                        <th key={idx} className={`${h.align} p-3.5`}>
                          {h.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {batch.shipments.map((shipment: any) => {
                      const selected = selectedShipmentIds.includes(
                        shipment.shipmentId,
                      );

                      return (
                        <tr
                          key={shipment.shipmentId}
                          className="hover:bg-white/[0.02] transition-colors"
                        >
                          <td className="p-3.5">
                            <input
                              type="checkbox"
                              aria-label={`Seleccionar envío ${shipment.shipmentId}`}
                              checked={selected}
                              disabled={!shipment.isEligible || isReleasing}
                              onChange={() =>
                                onToggleShipment(
                                  batch.sellerId,
                                  shipment.shipmentId,
                                )
                              }
                              className="h-4 w-4 rounded border-white/20 bg-night accent-lion cursor-pointer disabled:cursor-not-allowed disabled:opacity-30"
                            />
                          </td>
                          <td className="p-3.5 font-mono text-platinum">
                            #{shipment.shipmentId.slice(0, 8).toUpperCase()}
                          </td>
                          <td className="p-3.5 font-mono text-blue-light">
                            #{shipment.orderId.slice(0, 8).toUpperCase()}
                          </td>
                          <td className="p-3.5 font-bold text-lion text-sm">
                            {formatCurrency(
                              centsToMoney(shipment.releaseAmountCents),
                            )}
                          </td>
                          <td className="p-3.5">
                            {shipment.isEligible ? (
                              <span className="inline-flex items-center gap-1.5 bg-forest/10 text-forest border border-forest/20 px-2.5 py-1 rounded-full text-xs font-bold">
                                <CheckCircle2 size={13} /> Listo para Pago
                              </span>
                            ) : (
                              <span
                                className="inline-flex items-center gap-1.5 bg-amber-400/10 text-amber-400 border border-amber-400/20 px-2.5 py-1 rounded-full text-xs font-medium capitalize"
                                title={formatReason(shipment.ineligibleReason)}
                              >
                                <AlertTriangle size={13} />
                                {formatReason(shipment.ineligibleReason)}
                              </span>
                            )}
                          </td>
                          <td className="p-3.5 capitalize text-blue-light/80 font-mono text-[11px]">
                            {shipment.reconciliationIndicator.replaceAll(
                              '_',
                              ' ',
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
};
