import { Navigate, Outlet, useLocation } from 'react-router-dom';

import { RouteStatusShell } from '@/components/layout/RouteStatusShell';
import { buildLoginRedirect, buildRedirectPath, DEFAULT_PROTECTED_ROUTE } from '@/router/navigation';
import { useAuthStore } from '@/store/useAuthStore';

const isAdminRole = (role: string | undefined) => {
  if (!role) {
    return false;
  }

  return role === 'ROLE_ADMIN' || /ROLE_.*ADMIN/.test(role);
};

export function AdminRoute() {
  const status = useAuthStore((state) => state.status);
  const member = useAuthStore((state) => state.member);
  const location = useLocation();

  if (status === 'checking') {
    return (
      <RouteStatusShell
        description="관리자 권한을 확인하고 있습니다."
        kicker="Admin check"
        title="보안 관리자 확인 중"
      />
    );
  }

  if (status !== 'authenticated') {
    return (
      <Navigate
        replace
        to={buildLoginRedirect(
          buildRedirectPath({
            pathname: location.pathname,
            search: location.search,
            hash: location.hash,
          }),
        )}
      />
    );
  }

  if (!isAdminRole(member?.role)) {
    if (import.meta.env.DEV) {
      console.warn('AdminRoute denied for non-admin role', {
        role: member?.role,
        attemptedPath: location.pathname,
      });
    }

    return <Navigate replace to={DEFAULT_PROTECTED_ROUTE} />;
  }

  return <Outlet />;
}
