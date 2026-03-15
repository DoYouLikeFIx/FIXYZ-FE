import { Outlet } from 'react-router-dom';

import { SiteFooter } from '@/components/layout/SiteFooter';
import { useProtectedSession } from '@/hooks/auth/useProtectedSession';

export function ProtectedLayout() {
  const {
    member,
    remainingSeconds,
    sessionExpiryMonitoringUnavailable,
    isExtending,
    extensionError,
    handleExtendSession,
  } =
    useProtectedSession();

  return (
    <main className="protected-shell">
      <header className="topbar">
        <div>
          <p className="topbar__kicker">Protected route</p>
          <h1 className="topbar__title">Secure workspace online</h1>
        </div>
        <div className="topbar__identity">
          <span className="topbar__chip">{member?.role ?? 'ROLE_USER'}</span>
          <span className="topbar__name">{member?.name ?? 'Member'}</span>
        </div>
      </header>

      {(remainingSeconds !== null || sessionExpiryMonitoringUnavailable) && (
        <section
          className="session-banner"
          data-testid={
            sessionExpiryMonitoringUnavailable
              ? 'session-expiry-monitoring-unavailable'
              : 'session-expiry-guidance'
          }
          role="alert"
        >
          <div>
            <p className="session-banner__title">
              {sessionExpiryMonitoringUnavailable
                ? 'Session monitoring unavailable'
                : 'Session expiry warning'}
            </p>
            <p>
              {sessionExpiryMonitoringUnavailable
                ? 'Automatic session expiry monitoring is currently unavailable. Refresh the secure session manually before access is interrupted.'
                : `Your session will expire in ${remainingSeconds} seconds. Continue to refresh the secure session before access is interrupted.`}
            </p>
            {extensionError && (
              <p className="session-banner__error" data-testid="session-expiry-error">
                {extensionError}
              </p>
            )}
          </div>
          <button
            type="button"
            data-testid="session-expiry-extend"
            disabled={isExtending}
            onClick={handleExtendSession}
          >
            {isExtending
              ? 'Refreshing session...'
              : sessionExpiryMonitoringUnavailable
                ? 'Refresh session now'
                : 'Keep me signed in'}
          </button>
        </section>
      )}

      <section className="protected-content">
        <Outlet />
      </section>

      <SiteFooter variant="protected" />
    </main>
  );
}
