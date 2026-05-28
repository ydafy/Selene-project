import { ShieldCheck, Gavel, Wallet, TrendingUp, AlertCircle } from 'lucide-react';
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

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard
          title="Pendientes de Verificación"
          value={stats?.pendingProducts ?? 0}
          icon={ShieldCheck}
          color="text-lion"
          isLoading={isLoading}
        />
        <StatCard
          title="Disputas Activas"
          value={stats?.activeDisputes ?? 0}
          icon={Gavel}
          color="text-fire"
          isLoading={isLoading}
        />
        <StatCard
          title="Por Dispersar (Vendedores)"
          value={formatCurrency(stats?.totalToPay ?? 0)}
          icon={Wallet}
          color="text-forest"
          isLoading={isLoading}
        />
        <StatCard
          title="Ventas del Mes"
          value={stats?.monthlySalesCount ?? 0}
          icon={TrendingUp}
          color="text-blue-light"
          isLoading={isLoading}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-state-gray p-6 rounded-2xl border border-white/5 h-64 flex items-center justify-center">
          <p className="text-blue-light italic">
            [Gráfica de Actividad Próximamente]
          </p>
        </div>
        <ActivityFeed />
      </div>
    </div>
  );
};
