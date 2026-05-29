import {
  ShieldCheck,
  Gavel,
  Wallet,
  TrendingUp,
  Users,
  CheckCircle,
  Package,
  AlertCircle,
  Activity,
} from 'lucide-react';
import { useAdminStats } from '../hooks/useAdminStats';
import { ActivityFeed } from '../components/features/verify/ActivityFeed';
import { StatCard } from '../components/ui/StatCard';
import { formatCurrency } from '../lib/utils/formatCurrency';

export const DashboardHome = () => {
  const { data: stats, isLoading, isError, refetch } = useAdminStats();

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-3xl font-bold">Resumen Operativo</h2>
        <p className="text-blue-light mt-1">Datos reales de la plataforma.</p>
      </div>

      {isError && (
        <div className="flex items-center gap-3 bg-fire/10 border border-fire/20 text-fire p-4 rounded-xl">
          <AlertCircle size={20} />
          <p className="text-sm flex-1">
            Error al cargar las estadísticas. Intenta de nuevo.
          </p>
          <button
            onClick={() => refetch()}
            className="text-sm font-semibold underline underline-offset-2 hover:text-platinum transition-colors"
          >
            Reintentar
          </button>
        </div>
      )}

      {!isError && (
        <>
      {/* ── Operational KPIs ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard
          title="Pendientes de Verificación"
          value={stats?.pendingProducts ?? 0}
          icon={ShieldCheck}
          color="text-lion"
          isLoading={isLoading}
          trend={stats?.trends.pendingProducts ?? null}
          href="/verify"
          goal={{ value: 0, label: 'ideal: 0', lowerIsBetter: true }}
        />
        <StatCard
          title="Disputas Activas"
          value={stats?.activeDisputes ?? 0}
          icon={Gavel}
          color="text-fire"
          isLoading={isLoading}
          trend={stats?.trends.activeDisputes ?? null}
          href="/disputes"
          goal={{ value: 0, label: 'ideal: 0', lowerIsBetter: true }}
        />
        <StatCard
          title="Por Dispersar (Vendedores)"
          value={formatCurrency(stats?.totalToPay ?? 0)}
          icon={Wallet}
          color="text-forest"
          isLoading={isLoading}
          href="/payments"
        />
        <StatCard
          title="Ventas del Mes"
          value={stats?.monthlySalesCount ?? 0}
          icon={TrendingUp}
          color="text-blue-light"
          isLoading={isLoading}
          trend={stats?.trends.monthlySales ?? null}
          goal={{ value: stats?.trends.monthlySales?.percentage ?? 0, label: 'vs mes ant.', lowerIsBetter: false }}
        />
      </div>

      {/* ── Strategic Metrics ── */}
      <div>
        <h3 className="text-lg font-bold text-platinum mb-4">Métricas Estratégicas</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          <StatCard
            title="Usuarios Registrados"
            value={stats?.totalUsers ?? 0}
            icon={Users}
            color="text-purple-400"
            isLoading={isLoading}
          />
          <StatCard
            title="Productos Verificados"
            value={stats?.verifiedProducts ?? 0}
            icon={CheckCircle}
            color="text-forest"
            isLoading={isLoading}
          />
          <StatCard
            title="Total Productos"
            value={stats?.totalProducts ?? 0}
            icon={Package}
            color="text-lion"
            isLoading={isLoading}
          />
        </div>
      </div>
        </>
      )}

      {/* ── Activity & Chart ── */}
      {!isError && (
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-state-gray p-6 rounded-2xl border border-white/5">
          <h3 className="text-sm font-bold text-platinum uppercase tracking-widest flex items-center gap-2 mb-4">
            <Activity size={14} className="text-blue-light" /> Resumen de Actividad
          </h3>
          {isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-4 bg-white/5 animate-pulse rounded" />
              ))}
            </div>
          ) : stats ? (
            <div className="space-y-3 text-sm">
              <div className="flex justify-between items-center py-2 border-b border-white/5">
                <span className="text-blue-light">Productos Pendientes</span>
                <span className="text-lion font-semibold">{stats.pendingProducts}</span>
              </div>
              <div className="flex justify-between items-center py-2 border-b border-white/5">
                <span className="text-blue-light">Disputas Activas</span>
                <span className="text-fire font-semibold">{stats.activeDisputes}</span>
              </div>
              <div className="flex justify-between items-center py-2 border-b border-white/5">
                <span className="text-blue-light">Ventas del Mes</span>
                <span className="text-blue-light font-semibold">{stats.monthlySalesCount}</span>
              </div>
              <div className="flex justify-between items-center py-2">
                <span className="text-blue-light">Usuarios Registrados</span>
                <span className="text-purple-400 font-semibold">{stats.totalUsers}</span>
              </div>
            </div>
          ) : null}
        </div>
        <ActivityFeed />
      </div>
      )}
    </div>
  );
};
