import type { ComponentType } from 'react';
import { CarrierReviewsPanel } from '../components/features/shipments/CarrierReviewsPanel';

// A new shipping queue (blocked labels, label recovery) is one self-contained component
// (its own hook, service and bucket) plus one entry here.
const BUCKETS: ReadonlyArray<{ id: string; Component: ComponentType }> = [
  { id: 'carrier-reviews', Component: CarrierReviewsPanel },
];

export const ShipmentsPage = () => (
  <div className="min-w-0 space-y-6">
    <header className="pb-2">
      <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.24em] text-lion">
        Selene · Operación logística
      </p>
      <h1 className="text-2xl font-bold tracking-tight text-platinum sm:text-3xl">Envíos</h1>
      <p className="mt-2 text-sm text-blue-light">
        Atiende los envíos y guías que necesitan una decisión de un administrador.
      </p>
    </header>
    {BUCKETS.map(({ id, Component }) => (
      <Component key={id} />
    ))}
  </div>
);
