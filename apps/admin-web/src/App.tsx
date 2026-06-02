import React, { useEffect } from 'react';
import { Toaster, toast } from 'sonner';
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { useAuthStore } from './store/useAuthStore';
import { supabase } from './lib/supabase';
import { Layout } from './components/layout/Layout';
import { DashboardHome } from './pages/DashboardHome';
import Login from './pages/Login';
import { VerificationPage } from './pages/VerificationPage';
import { UsersPage } from './pages/UsersPage';
import { UserDetailPage } from './pages/UserDetailPage';
import { DisputesPage } from './pages/DisputesPage';
import { DisputeDetailPage } from './pages/DisputeDetailPage';
import { PaymentsPage } from './pages/PaymentsPage';

const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
  const { user, profile, loading, initialized } = useAuthStore();

  if (!initialized || loading) return <div className="h-screen bg-night" />;
  if (!user || profile?.role !== 'admin') return <Navigate to="/login" />;

  return <>{children}</>;
};

/** Escucha cambios de sesión de Supabase Auth */
function AuthListener() {
  const navigate = useNavigate();

  useEffect(() => {
    const { data: authListener } = supabase.auth.onAuthStateChange(
      (event, session) => {
        // Ignorar INITIAL_SESSION — initialize() ya lo maneja
        if (event === 'INITIAL_SESSION') return;

        if (event === 'SIGNED_OUT' || (event === 'TOKEN_REFRESHED' && !session)) {
          useAuthStore.getState().setUser(null, null);
          toast.warning('Sesión expirada. Redirigiendo al login...');
          navigate('/login');
        }
      },
    );

    return () => authListener?.subscription?.unsubscribe();
  }, [navigate]);

  return null;
}

function App() {
  const initialize = useAuthStore((state) => state.initialize);

  useEffect(() => {
    initialize();
  }, []);

  return (
    <BrowserRouter>
      <Toaster theme="dark" position="top-right" richColors />
      <AuthListener />
      <Routes>
        <Route path="/login" element={<Login />} />

        <Route
          path="/"
          element={
            <ProtectedRoute>
              <Layout />
            </ProtectedRoute>
          }
        >
          <Route index element={<DashboardHome />} />
          <Route path="verify" element={<VerificationPage />} />
          <Route path="users" element={<UsersPage />} />
          <Route path="users/:id" element={<UserDetailPage />} />

          <Route path="disputes" element={<DisputesPage />} />
          <Route path="disputes/:id" element={<DisputeDetailPage />} />
          <Route path="payments" element={<PaymentsPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;
