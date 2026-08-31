import {
  ShieldCheck,
  Gavel,
  Wallet,
  TrendingUp,
  DollarSign,
  Receipt,
} from 'lucide-react';
import { useAdminStats } from '../hooks/useAdminStats';
import { ActivityFeed } from '../components/features/verify/ActivityFeed';
import { StatCard } from '../components/ui/StatCard';
import { formatCurrency } from '../lib/utils/formatCurrency';
import { CatalogHealthCard } from '../components/features/home/CatalogHealthCard';
import { ErrorState } from '../components/ui/ErrorState';

export const DashboardHome = () => {
  const {
    data: stats,
    isLoading,
    isFetching,
    isError,
    refetch,
  } = useAdminStats();

  if (isError) {
    return (
      <div className="space-y-8">
        <div>
          <h1 className="text-3xl font-bold text-platinum">
            Centro de Control
          </h1>
          <p className="text-blue-light mt-1">
            Métricas operativas y financieras en tiempo real.
          </p>
        </div>
        <ErrorState onRetry={refetch} isRetrying={isFetching} />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* ── Header ── */}
      <div>
        <h1 className="text-3xl font-bold text-platinum">Centro de Control</h1>
        <p className="text-blue-light mt-1">
          Métricas operativas y financieras en tiempo real.
        </p>
      </div>

      {/* ── NIVEL 1: CENTRO DE COMANDO OPERATIVO (Acción Inmediata) ── */}
      <div>
        <h3 className="text-xs font-bold text-blue-light uppercase tracking-widest mb-3">
          Colas de Trabajo Urgentes
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <StatCard
            title="Pendientes de Verificación"
            value={stats?.pendingProducts ?? 0}
            icon={ShieldCheck}
            color="text-lion"
            isLoading={isLoading}
            href="/verify"
          />
          <StatCard
            title="Disputas Activas"
            value={stats?.activeDisputes ?? 0}
            icon={Gavel}
            color="text-fire"
            isLoading={isLoading}
            href="/disputes"
          />
          <StatCard
            title="Por Dispersar (Connect)"
            value={formatCurrency(stats?.totalToPay ?? 0)}
            icon={Wallet}
            color="text-forest"
            isLoading={isLoading}
            href="/payments"
          />
          <StatCard
            title="Órdenes del Mes"
            value={stats?.monthlySalesCount ?? 0}
            icon={Receipt}
            color="text-blue-light"
            isLoading={isLoading}
            trend={stats?.trends.monthlySales ?? null}
          />
        </div>
      </div>

      {/* ── NIVEL 2: SALUD FINANCIERA & UNIT ECONOMICS (El Negocio) ── */}
      <div>
        <h3 className="text-xs font-bold text-blue-light uppercase tracking-widest mb-3">
          Métricas Financieras del Mes
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <StatCard
            title="GMV Mensual (Volumen Total)"
            value={formatCurrency(stats?.monthlyGmv ?? 0)}
            icon={DollarSign}
            color="text-platinum"
            isLoading={isLoading}
            trend={stats?.trends.monthlyGmv ?? null}
          />
          <StatCard
            title="Ingresos Selene (Comisiones 6%)"
            value={formatCurrency(stats?.monthlyRevenue ?? 0)}
            icon={TrendingUp}
            color="text-forest"
            isLoading={isLoading}
          />
          <StatCard
            title="Ticket Promedio (AOV)"
            value={formatCurrency(stats?.averageTicket ?? 0)}
            icon={Wallet}
            color="text-purple-200"
            isLoading={isLoading}
          />
        </div>
      </div>

      {/* ── NIVEL 3: INVENTARIO & AUDITORÍA EN VIVO ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Columna Izquierda: Estado del Catálogo */}
        <CatalogHealthCard
          stats={stats}
          isLoading={isLoading}
          isFetching={isFetching}
        />

        {/* Columna Derecha: Feed de Auditoría */}
        <ActivityFeed />
      </div>
    </div>
  );
};
