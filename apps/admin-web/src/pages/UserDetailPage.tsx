import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Mail,
  Calendar,
  Phone,
  CreditCard,
  Package,
  ShieldAlert,
  History,
  ShieldCheck,
  Zap,
  Wallet,
  Star,
  TrendingUp,
  Gavel,
  Clock,
  MapPin,
} from 'lucide-react';
import { useUserDetail } from '../hooks/useUserDetail';
import { UserAvatar } from '../components/ui/UserAvatar';
import { UserSafetyActions } from '../components/features/verify/UserSafetyActions';
import { getRank } from '../lib/utils/ranks';
import { ErrorState } from '../components/ui/ErrorState';
import { StatCard } from '../components/ui/StatCard';
import { InventoryTable } from '../components/features/users/InventoryTable';
import { PurchasesTable } from '../components/features/users/PurchasesTable';
import { UserReviewsList } from '../components/features/users/UserReviewsList';
import { UserWalletCard } from '../components/features/users/UserWalletCard';
import { UserBankCard } from '../components/features/users/UserBankCard';
import { UserPayoutsTable } from '../components/features/users/UserPayoutsTable';
import { UserTransactionsTable } from '../components/features/users/UserTransactionsTable';
import { UserAddressesList } from '../components/features/users/UserAddressesList';
import { UserReportsList } from '../components/features/users/UserReportsList';
import { UserAdminHistory } from '../components/features/users/UserAdminHistory';
import { UserDisputesList } from '../components/features/users/UserDisputesList';

export const UserDetailPage = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('overview');

  const { data, isLoading, isError, refetch } = useUserDetail(id!);

  if (isLoading)
    return (
      <div className="p-8 animate-pulse text-lion">Cargando expediente...</div>
    );
  if (isError) return <ErrorState onRetry={() => refetch()} />;
  if (!data?.profile)
    return <div className="p-8 text-platinum">Usuario no encontrado.</div>;

  const {
    profile,
    bank,
    addresses,
    metrics,
    disputes,
    products,
    purchasedItems,
    internalNotes,
    auditLogs,
    reviews,
    avgRating,
    reports,
    reportsCount,
  } = data;

  const displayRatio =
    profile.processed_count > 0
      ? Math.round((profile.verified_count / profile.processed_count) * 100)
      : 0;

  const rank = getRank(profile.sold_count, displayRatio);

  return (
    <div className="space-y-6">
      {/* BOTÓN VOLVER */}
      <button
        onClick={() => navigate('/users')}
        className="flex items-center gap-2 text-blue-light hover:text-platinum transition-colors group"
      >
        <ArrowLeft
          size={18}
          className="group-hover:-translate-x-1 transition-transform"
        />
        Volver al directorio
      </button>

      {/* HEADER DE EXPEDIENTE */}

      <div className="bg-state-gray border border-white/5 rounded-3xl overflow-hidden shadow-2xl relative">
        {/* Banner decorativo sutil según status */}
        <div
          className={`h-2 w-full ${profile.status === 'active' ? 'bg-forest' : 'bg-fire'}`}
        />

        <div className="p-8 flex flex-col lg:flex-row justify-between items-start lg:items-center gap-8">
          <div className="flex items-center gap-6">
            <div className="relative">
              <UserAvatar
                path={profile.avatar_url}
                fallback={profile.username}
                size="md"
              />
              {profile.is_verified_seller && (
                <div className="absolute -bottom-2 -right-2 bg-lion text-night rounded-full p-1 border-4 border-state-gray">
                  <ShieldCheck size={16} strokeWidth={3} />
                </div>
              )}
            </div>

            <div>
              <div className="flex items-center gap-3 flex-wrap">
                <h2 className="text-3xl font-bold text-platinum tracking-tight">
                  @{profile.username}
                </h2>
                <span
                  className={`px-3 py-1 rounded-full text-[10px] font-black uppercase border ${rank.color}`}
                >
                  {rank.icon} {rank.label}
                </span>
                <span
                  className={`px-3 py-1 rounded-full text-[10px] font-black uppercase border ${
                    profile.status === 'active'
                      ? 'border-forest/30 text-forest bg-forest/5'
                      : 'border-fire/30 text-fire bg-fire/5'
                  }`}
                >
                  {profile.status}
                </span>
              </div>

              <div className="flex flex-col sm:flex-row sm:items-center gap-y-2 gap-x-6 mt-4">
                <div className="flex items-center gap-2 text-blue-light text-sm">
                  <Mail size={14} className="text-lion" />
                  <span className="font-medium">{profile.email}</span>
                </div>
                <div className="flex items-center gap-2 text-blue-light text-sm">
                  <Calendar size={14} className="text-lion" />
                  <span>
                    Miembro desde{' '}
                    {new Date(profile.created_at).toLocaleDateString()}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-blue-light text-sm">
                  <Phone size={14} className="text-lion" />
                  <span>{profile.phone_number || 'Sin teléfono'}</span>
                </div>
                <div className="flex items-center gap-2 text-blue-light text-sm">
                  <Clock size={14} className="text-lion" />
                  <span>
                    Última conexión:{' '}
                    {profile.last_sign_in_at
                      ? new Date(profile.last_sign_in_at).toLocaleString()
                      : 'N/A'}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* ACCIONES RÁPIDAS */}
          <div className="flex items-center gap-3 bg-night/40 p-3 rounded-2xl border border-white/5">
            <UserSafetyActions user={profile} onUpdate={() => refetch()} />
          </div>
        </div>
      </div>

      {/* TABS DE NAVEGACIÓN INTERNA */}
      <div className="flex gap-4 border-b border-white/5">
        {[
          { id: 'overview', label: 'Resumen Operativo', icon: Package },
          { id: 'finance', label: 'Finanzas y Pagos', icon: CreditCard },
          { id: 'security', label: 'Seguridad y Logs', icon: ShieldAlert },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2 px-4 py-3 text-sm font-bold transition-all border-b-2 ${
              activeTab === tab.id
                ? 'border-lion text-lion'
                : 'border-transparent text-blue-light hover:text-platinum'
            }`}
          >
            <tab.icon size={16} />
            {tab.label}
          </button>
        ))}
      </div>

      {/* CONTENIDO DINÁMICO SEGÚN TAB */}
      <div className="py-4">
        {activeTab === 'overview' && (
          <div className="space-y-8 animate-in fade-in duration-500">
            {/* NIVEL 1: MÉTRICAS DE NEGOCIO */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <StatCard
                title="Ventas Exitosas"
                value={metrics.sales}
                icon={Package}
                color="text-platinum"
              />
              <StatCard
                title="Compras Totales"
                value={metrics.purchases}
                icon={History}
                color="text-platinum"
              />
              <StatCard
                title="Efectividad"
                value={`${displayRatio}%`}
                icon={Zap}
                color="text-lion"
              />
              <StatCard
                title="Volumen Total de Ventas"
                value={`$${metrics.totalVolume.toLocaleString()}`}
                icon={TrendingUp}
                color="text-lion"
              />
            </div>

            {/* NIVEL 2: MÉTRICAS DE CONFIANZA (MVP++) */}
            {/* NIVEL 2: MÉTRICAS DE CONFIANZA (MVP++ UNIFICADO) */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              {/* 1. RATING */}
              <StatCard
                title="Rating Promedio"
                value={data.avgRating.toFixed(1)}
                icon={Star}
              >
                <div className="flex text-lion">
                  {[...Array(5)].map((_, i) => (
                    <Star
                      key={i}
                      size={12}
                      fill={
                        i < Math.round(data.avgRating) ? 'currentColor' : 'none'
                      }
                    />
                  ))}
                </div>
              </StatCard>

              {/* 2. REPORTES AL PERFIL */}
              <StatCard
                title="Reportes Recibidos"
                value={data.reportsCount}
                icon={ShieldAlert}
                color={data.reportsCount > 0 ? 'text-fire' : 'text-platinum'}
              />

              {/* 3. DISPUTAS DE ÓRDENES */}
              <StatCard
                title="Disputas"
                value={metrics.totalDisputes}
                icon={Gavel}
              >
                <div className="flex flex-col gap-1">
                  <div className="flex justify-between">
                    <span className="text-[9px] text-forest font-bold uppercase">
                      Ganadas
                    </span>
                    <span className="text-[10px] font-bold text-forest">
                      {metrics.wonDisputes}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[9px] text-fire font-bold uppercase">
                      Perdidas
                    </span>
                    <span className="text-[10px] font-bold text-fire">
                      {metrics.lostDisputes}
                    </span>
                  </div>
                  <div className="flex justify-between border-t border-white/5 mt-1 pt-1">
                    <span className="text-[9px] text-blue-light uppercase font-bold">
                      En Revisión
                    </span>
                    <span className="text-[10px] font-bold text-platinum">
                      {metrics.pendingDisputes}
                    </span>
                  </div>
                </div>
              </StatCard>

              {/* 4. CANCELACIONES */}
              <StatCard
                title="Cancelaciones"
                value={metrics.totalCancellations}
                icon={History}
                color={
                  metrics.cancelledSales > 0 ? 'text-fire' : 'text-platinum'
                }
              >
                <div className="flex flex-col gap-1">
                  <div className="flex justify-between items-center">
                    <span className="text-[9px] text-blue-light uppercase font-bold">
                      Como Vendedor
                    </span>
                    <span
                      className={`text-[10px] font-bold ${metrics.cancelledSales > 0 ? 'text-fire' : 'text-platinum/40'}`}
                    >
                      {metrics.cancelledSales}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-[9px] text-blue-light uppercase font-bold">
                      Como Comprador
                    </span>
                    <span className="text-[10px] font-bold text-platinum/40">
                      {metrics.cancelledPurchases}
                    </span>
                  </div>
                </div>
              </StatCard>
            </div>

            {/* NIVEL 3: ACTIVIDAD DETALLADA */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">
              {/* LISTA DE PRODUCTOS (Lo que ya tenías) */}
              <InventoryTable
                products={data.products}
                total={profile.total_listings}
              />
              <PurchasesTable items={data.purchasedItems} />
            </div>
            {/* ÚLTIMAS RESEÑAS (MVP++) */}
            <div className="w-full">
              <UserReviewsList
                reviews={data.reviews}
                avgRating={data.avgRating}
              />
            </div>
          </div>
        )}

        {activeTab === 'finance' && (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
            {/* RESUMEN FINANCIERO */}
            <UserWalletCard
              available={profile.available_balance}
              pending={profile.pending_balance}
            />

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
              <UserBankCard bank={bank} />
              <UserPayoutsTable payouts={data.payouts} />
            </div>

            {/* LIBRETA DE DIRECCIONES (MVP++ COMPONENTE) */}
            <UserAddressesList addresses={addresses} />

            {/* LIBRO MAYOR (LEDGER) */}
            <UserTransactionsTable transactions={data.transactions} />
          </div>
        )}
        {activeTab === 'security' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 animate-in fade-in slide-in-from-bottom-2 duration-500 items-start">
            {/* COLUMNA 1: CONFLICTOS (DISPUTAS + REPORTES) */}
            <div className="space-y-6">
              <UserDisputesList disputes={disputes} currentUserId={id!} />
              <UserReportsList reports={reports} />
            </div>

            {/* COLUMNA 2: ACCIONES DE ADMIN Y NOTAS */}
            <UserAdminHistory logs={auditLogs} notes={internalNotes} />
          </div>
        )}
      </div>
    </div>
  );
};
