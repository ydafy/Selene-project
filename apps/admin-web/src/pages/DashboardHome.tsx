import { ShieldCheck, Gavel, Wallet, TrendingUp } from 'lucide-react';
import { useAdminStats } from '../hooks/useAdminStats';
import { ActivityFeed } from '../components/features/verify/ActivityFeed';

const StatCard = ({ title, value, icon: Icon, color, isLoading }: any) => (
  <div className="bg-state-gray p-6 rounded-2xl border border-white/5">
    <div className="flex justify-between items-start">
      <div>
        <p className="text-blue-light text-sm font-medium">{title}</p>
        {isLoading ? (
          <div className="h-8 w-24 bg-white/5 animate-pulse rounded mt-2" />
        ) : (
          <h3 className="text-3xl font-bold mt-2">{value}</h3>
        )}
      </div>
      <div className={`p-3 rounded-xl ${color}`}>
        <Icon size={24} />
      </div>
    </div>
  </div>
);

export const DashboardHome = () => {
  const { data: stats, isLoading } = useAdminStats();
  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-3xl font-bold">Resumen Operativo</h2>
        <p className="text-blue-light mt-1">Datos reales de la plataforma.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard
          title="Pendientes de Verificación"
          value={stats?.pendingProducts}
          icon={ShieldCheck}
          color="bg-lion/10 text-lion"
          isLoading={isLoading}
        />
        <StatCard
          title="Disputas Activas"
          value={stats?.activeDisputes}
          icon={Gavel}
          color="bg-fire/10 text-fire"
          isLoading={isLoading}
        />
        <StatCard
          title="Por Dispersar (Vendedores)"
          value={`$${stats?.totalToPay.toLocaleString()}`}
          icon={Wallet}
          color="bg-forest/10 text-forest"
          isLoading={isLoading}
        />
        <StatCard
          title="Ventas del Mes"
          value={stats?.monthlySalesCount}
          icon={TrendingUp}
          color="bg-blue-light/10 text-blue-light"
          isLoading={isLoading}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-state-gray p-6 rounded-2xl border border-white/5 h-64 flex items-center justify-center">
          <p className="text-blue-light italic">
            [Gráfica de Actividad Próximamente]
          </p>
        </div>
        <div className="bg-state-gray p-6 rounded-2xl border border-white/5 h-64 flex items-center justify-center">
          <p className="text-blue-light italic">[Últimas Acciones de Admin]</p>
        </div>
        <ActivityFeed />
      </div>
    </div>
  );
};
