import { Navigate, Route, Routes } from 'react-router-dom';

import { ProtectedLayout } from '@/components/layout/ProtectedLayout';
import { ForgotPasswordPage } from '@/pages/ForgotPasswordPage';
import { LoginPage } from '@/pages/LoginPage';
import { MfaRecoveryPage } from '@/pages/MfaRecoveryPage';
import { MfaRecoveryRebindPage } from '@/pages/MfaRecoveryRebindPage';
import { OrderPage } from '@/pages/OrderPage';
import { PasswordResetPage } from '@/pages/PasswordResetPage';
import { PortfolioPage } from '@/pages/PortfolioPage';
import { RegisterPage } from '@/pages/RegisterPage';
import { TotpEnrollmentPage } from '@/pages/TotpEnrollmentPage';
import { PendingMfaRoute } from '@/router/PendingMfaRoute';
import { PrivateRoute } from '@/router/PrivateRoute';
import { PublicOnlyRoute } from '@/router/PublicOnlyRoute';
import {
  DEFAULT_PROTECTED_ROUTE,
  MFA_RECOVERY_REBIND_ROUTE,
  MFA_RECOVERY_ROUTE,
  TOTP_ENROLL_ROUTE,
} from '@/router/navigation';

export function AppRouter() {
  return (
    <Routes>
      <Route
        path="/login"
        element={(
          <PublicOnlyRoute>
            <LoginPage />
          </PublicOnlyRoute>
        )}
      />
      <Route
        path="/register"
        element={(
          <PublicOnlyRoute>
            <RegisterPage />
          </PublicOnlyRoute>
        )}
      />
      <Route
        path="/forgot-password"
        element={(
          <PublicOnlyRoute>
            <ForgotPasswordPage />
          </PublicOnlyRoute>
        )}
      />
      <Route
        path="/reset-password"
        element={(
          <PublicOnlyRoute>
            <PasswordResetPage />
          </PublicOnlyRoute>
        )}
      />
      <Route
        path={TOTP_ENROLL_ROUTE}
        element={(
          <PendingMfaRoute requiredAction="ENROLL_TOTP">
            <TotpEnrollmentPage />
          </PendingMfaRoute>
        )}
      />
      <Route path={MFA_RECOVERY_ROUTE} element={<MfaRecoveryPage />} />
      <Route path={MFA_RECOVERY_REBIND_ROUTE} element={<MfaRecoveryRebindPage />} />
      <Route element={<PrivateRoute />}>
        <Route element={<ProtectedLayout />}>
          <Route path="/portfolio" element={<PortfolioPage />} />
          <Route path="/orders" element={<OrderPage />} />
        </Route>
      </Route>
      <Route path="/" element={<Navigate replace to={DEFAULT_PROTECTED_ROUTE} />} />
      <Route path="*" element={<Navigate replace to={DEFAULT_PROTECTED_ROUTE} />} />
    </Routes>
  );
}
