import { Outlet, useNavigate, useLocation } from 'react-router-dom';

import {
  LayoutDashboard,
  ShieldCheck,
  Gavel,
  Wallet,
  Users,
  LogOut,
  ChevronRight,
} from 'lucide-react';
import { useAuthStore } from '../../store/useAuthStore';

export const Layout = () => {
  const { signOut, profile } = useAuthStore();
  const navigate = useNavigate();
  const location = useLocation();

  const menuItems = [
    { name: 'Inicio', path: '/', icon: LayoutDashboard },
    { name: 'Verificación', path: '/verify', icon: ShieldCheck },
    { name: 'Usuarios', path: '/users', icon: Users }, // <--- AGREGADO
    { name: 'Disputas', path: '/disputes', icon: Gavel },
    { name: 'Pagos/Dispersión', path: '/payments', icon: Wallet },
  ];

  return (
    <div className="flex h-screen bg-night text-platinum">
      {/* SIDEBAR */}
      <aside className="w-64 bg-state-gray border-r border-white/5 flex flex-col">
        <div className="p-6">
          <h1 className="text-2xl font-bold text-lion tracking-tighter">
            SELENE
          </h1>
          <p className="text-[10px] text-blue-light uppercase tracking-widest mt-1">
            Admin Panel
          </p>
        </div>

        <nav className="flex-1 px-4 space-y-2">
          {menuItems.map((item) => {
            const isActive = location.pathname === item.path;
            return (
              <button
                key={item.path}
                onClick={() => navigate(item.path)}
                className={`w-full flex items-center justify-between p-3 rounded-xl transition-all ${
                  isActive
                    ? 'bg-lion text-night font-semibold'
                    : 'hover:bg-white/5 text-blue-light'
                }`}
              >
                <div className="flex items-center gap-3">
                  <item.icon size={20} />
                  <span className="text-sm">{item.name}</span>
                </div>
                {isActive && <ChevronRight size={16} />}
              </button>
            );
          })}
        </nav>

        <div className="p-4 border-t border-white/5">
          <div className="flex items-center gap-3 p-2 mb-4">
            <div className="w-8 h-8 rounded-full bg-lion/20 flex items-center justify-center text-lion font-bold">
              {profile?.username?.[0]?.toUpperCase() || 'A'}
            </div>
            <div className="flex-1 overflow-hidden">
              <p className="text-sm font-medium truncate">
                {profile?.username || 'Admin'}
              </p>
              <p className="text-[10px] text-blue-light truncate">
                {profile?.role}
              </p>
            </div>
          </div>
          <button
            onClick={signOut}
            className="w-full flex items-center gap-3 p-3 text-fire hover:bg-fire/10 rounded-xl transition-colors text-sm"
          >
            <LogOut size={20} />
            Cerrar Sesión
          </button>
        </div>
      </aside>

      {/* MAIN CONTENT */}
      <main className="flex-1 overflow-y-auto p-8">
        <Outlet />
      </main>
    </div>
  );
};
