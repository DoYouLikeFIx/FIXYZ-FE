import type { ReactNode } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';

import { RouteStatusShell } from '@/components/layout/RouteStatusShell';
import {
  DEFAULT_PROTECTED_ROUTE,
  LOGIN_ROUTE,
  buildLoginRedirect,
  resolveRedirectTarget,
} from '@/router/navigation';
import type { MfaNextAction } from '@/types/auth';
import { useAuthStore } from '@/store/useAuthStore';

interface PendingMfaRouteProps {
  requiredAction: MfaNextAction;
  children: ReactNode;
}

export function PendingMfaRoute({
  requiredAction,
  children,
}: PendingMfaRouteProps) {
  const status = useAuthStore((state) => state.status);
  const pendingMfa = useAuthStore((state) => state.pendingMfa);
  const [searchParams] = useSearchParams();

  if (status === 'checking') {
    return (
      <RouteStatusShell
        description="로그인 단계를 확인하는 중입니다."
        title="보안 인증 단계를 준비하고 있습니다"
      />
    );
  }

  if (status === 'authenticated') {
    return (
      <Navigate
        replace
        to={resolveRedirectTarget(searchParams.get('redirect')) || DEFAULT_PROTECTED_ROUTE}
      />
    );
  }

  if (!pendingMfa || pendingMfa.nextAction !== requiredAction) {
    const redirectPath = searchParams.get('redirect');

    return (
      <Navigate
        replace
        to={redirectPath ? buildLoginRedirect(resolveRedirectTarget(redirectPath)) : LOGIN_ROUTE}
      />
    );
  }

  return <>{children}</>;
}
