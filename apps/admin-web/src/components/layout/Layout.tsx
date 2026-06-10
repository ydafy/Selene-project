import { useState, useEffect } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { ErrorBoundary } from '../ui/ErrorBoundary';

import {
  LayoutDashboard,
  ShieldCheck,
  Gavel,
  Wallet,
  Users,
  Package,
  LogOut,
  ChevronRight,
  Menu,
} from 'lucide-react';
import { useAuthStore } from '../../store/useAuthStore';

export const Layout = () => {
  const { signOut, profile } = useAuthStore();
  const navigate = useNavigate();
  const location = useLocation();
  const [isSidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    const handler = (e: MediaQueryListEvent) => setSidebarOpen(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  const menuItems = [
    { name: 'Inicio', path: '/', icon: LayoutDashboard },
    { name: 'Verificación', path: '/verify', icon: ShieldCheck },
    { name: 'Usuarios', path: '/users', icon: Users },
    { name: 'Disputas', path: '/disputes', icon: Gavel },
    { name: 'Productos', path: '/products', icon: Package },
    { name: 'Pagos/Dispersión', path: '/payments', icon: Wallet },
  ];

  return (
    <div className="flex h-screen bg-night text-platinum">
      {/* BACKDROP (mobile only) */}
      {isSidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* SIDEBAR */}
      <aside
        className={`fixed lg:static inset-y-0 left-0 z-50 w-64 bg-state-gray border-r border-white/5 flex flex-col transition-transform duration-300 ${
          isSidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        }`}
      >
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
                onClick={() => {
                  navigate(item.path);
                  setSidebarOpen(false);
                }}
                className={`w-full flex items-center justify-between p-3 rounded-xl transition-all outline-none focus:ring-2 focus:ring-lion/50 cursor-pointer ${
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
            className="w-full flex items-center gap-3 p-3 text-fire hover:bg-fire/10 rounded-xl transition-colors text-sm outline-none focus:ring-2 focus:ring-lion/50 cursor-pointer"
          >
            <LogOut size={20} />
            Cerrar Sesión
          </button>
        </div>
      </aside>

      {/* MAIN CONTENT */}
      <main className="flex-1 overflow-y-auto p-4 md:p-8">
        <button
          className="lg:hidden mb-4 p-2 hover:bg-white/10 rounded-lg transition-colors outline-none focus:ring-2 focus:ring-lion/50"
          onClick={() => setSidebarOpen(!isSidebarOpen)}
        >
          <Menu size={24} />
        </button>

        <ErrorBoundary>
          <div style={{ animation: 'fadeIn 0.3s ease-out' }}>
            <Outlet />
          </div>
        </ErrorBoundary>
      </main>
    </div>
  );
};
