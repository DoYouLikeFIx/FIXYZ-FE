import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';

import { RouteStatusShell } from '@/components/layout/RouteStatusShell';
import { usePublicOnlyRouteGuard } from '@/hooks/auth/usePublicOnlyRouteGuard';

interface PublicOnlyRouteProps {
  children: ReactNode;
}

export function PublicOnlyRoute({ children }: PublicOnlyRouteProps) {
  const {
    status,
    redirectPath,
    pendingMfaRedirectPath,
    isChecking,
  } = usePublicOnlyRouteGuard();

  if (isChecking) {
    return (
      <RouteStatusShell
        description="로그인 상태를 확인하는 중입니다."
        title="보안 세션을 확인하고 있습니다"
      />
    );
  }

  if (status === 'authenticated') {
    return <Navigate replace to={redirectPath ?? '/portfolio'} />;
  }

  if (pendingMfaRedirectPath) {
    return <Navigate replace to={pendingMfaRedirectPath} />;
  }

  return <>{children}</>;
}
