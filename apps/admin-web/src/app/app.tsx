import React, { useEffect } from 'react';
import { Toaster } from 'sonner';
import { ACCOUNT_DELETION_PATH, PRIVACY_PATH, TERMS_PATH } from '@selene/types';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from '../shared/store/use-auth-store';
import { evaluateAdminAccess } from '../shared/lib/auth/admin-access';
import { Layout } from './layout';
import { DashboardHome } from '../features/home/screens/dashboard-home-screen';
import Login from '../features/auth/screens/login-screen';
import { AccountDeletionPage } from '../features/legal/screens/account-deletion-screen';
import { PrivacyPage } from '../features/legal/screens/privacy-screen';
import { TermsPage } from '../features/legal/screens/terms-screen';
import { VerificationPage } from '../features/verify/screens/verification-screen';
import { UsersPage } from '../features/users/screens/users-screen';
import { UserDetailPage } from '../features/users/screens/user-detail-screen';
import { DisputesPage } from '../features/disputes/screens/disputes-screen';
import { DisputeDetailPage } from '../features/disputes/screens/dispute-detail-screen';
import { PaymentsPage } from '../features/payments/screens/payments-screen';
import { ShipmentsPage } from '../features/shipments/screens/shipments-screen';
import { ProductManagementPage } from '../features/products/screens/product-management-screen';
import { SellerOnboardingPage } from '../features/seller-onboarding/screens/seller-onboarding-screen';

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
