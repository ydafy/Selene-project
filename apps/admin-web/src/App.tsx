import React, { useEffect } from 'react';
import { Toaster } from 'sonner';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './store/useAuthStore';
import { Layout } from './components/layout/Layout';
import { DashboardHome } from './pages/DashboardHome';
import Login from './pages/Login';
import { VerificationPage } from './pages/VerificationPage';
import { UsersPage } from './pages/UsersPage';
import { UserDetailPage } from './pages/UserDetailPage';
import { DisputesPage } from './pages/DisputesPage';
import { DisputeDetailPage } from './pages/DisputeDetailPage';

const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
  const { user, profile, loading, initialized } = useAuthStore();

  if (!initialized || loading) return <div className="h-screen bg-night" />;
  if (!user || profile?.role !== 'admin') return <Navigate to="/login" />;

  return <>{children}</>;
};

function App() {
  const initialize = useAuthStore((state) => state.initialize);

  useEffect(() => {
    initialize();
  }, []);

  return (
    <BrowserRouter>
      <Toaster theme="dark" position="top-right" richColors />
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
          <Route
            path="payments"
            element={
              <div className="text-2xl font-bold">Próximamente: Pagos</div>
            }
          />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;
