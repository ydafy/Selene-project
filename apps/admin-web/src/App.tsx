import React, { useEffect } from 'react';
import { Toaster } from 'sonner';
import { ACCOUNT_DELETION_PATH, PRIVACY_PATH, TERMS_PATH } from '@selene/types';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './store/useAuthStore';
import { evaluateAdminAccess } from './lib/adminAccess';
import { Layout } from './components/layout/Layout';
import { DashboardHome } from './pages/DashboardHome';
import Login from './pages/Login';
import { AccountDeletionPage } from './pages/AccountDeletionPage';
import { PrivacyPage } from './pages/PrivacyPage';
import { TermsPage } from './pages/TermsPage';
import { VerificationPage } from './pages/VerificationPage';
import { UsersPage } from './pages/UsersPage';
import { UserDetailPage } from './pages/UserDetailPage';
import { DisputesPage } from './pages/DisputesPage';
import { DisputeDetailPage } from './pages/DisputeDetailPage';
import { PaymentsPage } from './pages/PaymentsPage';
import { ShipmentsPage } from './pages/ShipmentsPage';
import { ProductManagementPage } from './pages/ProductManagementPage';
import { SellerOnboardingPage } from './pages/SellerOnboardingPage';

const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
  const { user, profile, loading, initialized } = useAuthStore();

  if (!initialized || loading) return <div className="h-screen bg-night" />;
  if (!user || !evaluateAdminAccess(profile).allowed)
    return <Navigate to="/login" />;

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
        <Route path={ACCOUNT_DELETION_PATH} element={<AccountDeletionPage />} />
        <Route path={PRIVACY_PATH} element={<PrivacyPage />} />
        <Route path={TERMS_PATH} element={<TermsPage />} />

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
          <Route path="shipments" element={<ShipmentsPage />} />
          <Route path="seller-onboarding" element={<SellerOnboardingPage />} />
          <Route path="products" element={<ProductManagementPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;
