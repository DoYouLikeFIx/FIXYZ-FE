import { Navigate, Route, Routes } from 'react-router-dom';

import { ProtectedLayout } from '@/components/layout/ProtectedLayout';
import { LoginPage } from '@/pages/LoginPage';
import { OrderPage } from '@/pages/OrderPage';
import { PortfolioPage } from '@/pages/PortfolioPage';
import { RegisterPage } from '@/pages/RegisterPage';
import { PrivateRoute } from '@/router/PrivateRoute';
import { PublicOnlyRoute } from '@/router/PublicOnlyRoute';
import { DEFAULT_PROTECTED_ROUTE } from '@/router/navigation';

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
