import { Navigate, Outlet } from 'react-router-dom';

import { RouteStatusShell } from '@/components/layout/RouteStatusShell';
import { usePrivateRouteGuard } from '@/hooks/auth/usePrivateRouteGuard';

export function PrivateRoute() {
  const { status, redirectPath } = usePrivateRouteGuard();

  if (status === 'checking') {
    return (
      <RouteStatusShell
        description="Loading the protected workspace..."
        title="Checking your secure session"
      />
    );
  }

  if (status !== 'authenticated') {
    return <Navigate replace to={redirectPath ?? '/login'} />;
  }

  return <Outlet />;
}
