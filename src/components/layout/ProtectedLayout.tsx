import { Link, Outlet } from 'react-router-dom';

import { SiteFooter } from '@/components/layout/SiteFooter';
import { isAdminRole } from '@/lib/admin-role';
import { useProtectedSession } from '@/hooks/auth/useProtectedSession';
import { ADMIN_ROUTE } from '@/router/navigation';

export function ProtectedLayout() {
  const {
    member,
    remainingSeconds,
    sessionExpiryMonitoringUnavailable,
    notifications,
    isHydratingNotifications,
    notificationFeedUnavailable,
    notificationFeedErrorMessage,
    notificationReadErrorMessage,
    isExtending,
    extensionError,
    handleExtendSession,
    markNotificationRead,
    refreshNotifications,
  } =
    useProtectedSession();

  return (
    <main className="protected-shell">
      <header className="topbar">
        <div>
          <p className="topbar__kicker">Protected route</p>
          <h1 className="topbar__title">Secure workspace online</h1>
        </div>
        {isAdminRole(member?.role) ? (
          <Link className="topbar__admin-link" to={ADMIN_ROUTE} data-testid="topbar-admin-link">
            Admin console
          </Link>
        ) : null}
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
        <section className="notification-center" data-testid="notification-center">
          <div className="notification-center__header">
            <h2>Notification center</h2>
          </div>

          {isHydratingNotifications && (
            <p data-testid="notification-center-loading">Loading notifications...</p>
          )}

          {notificationFeedUnavailable && (
            <div className="notification-center__warning" data-testid="notification-feed-unavailable">
              <p>{notificationFeedErrorMessage ?? 'Notification feed is unavailable.'}</p>
              <button
                data-testid="notification-feed-refresh"
                onClick={() => {
                  void refreshNotifications();
                }}
                type="button"
              >
                Refresh feed
              </button>
            </div>
          )}

          {!notificationFeedUnavailable && notificationReadErrorMessage && (
            <p className="notification-center__error" data-testid="notification-center-error">
              {notificationReadErrorMessage}
            </p>
          )}

          {!isHydratingNotifications && !notificationFeedUnavailable && notifications.length === 0 && (
            <p data-testid="notification-center-empty">
              No notifications yet. New order outcomes will appear here.
            </p>
          )}

          {!isHydratingNotifications && notifications.length > 0 && (
            <ul className="notification-center__list" data-testid="notification-center-list">
              {notifications.map((notification) => (
                <li
                  className="notification-center__item"
                  data-testid={`notification-item-${notification.notificationId}`}
                  key={notification.notificationId}
                >
                  <div>
                    <p className="notification-center__message">{notification.message}</p>
                    <p className="notification-center__meta">{notification.channel}</p>
                  </div>

                  {notification.read
                    ? (
                        <span
                          className="notification-center__read-chip"
                          data-testid={`notification-read-${notification.notificationId}`}
                        >
                          Read
                        </span>
                      )
                    : (
                        <button
                          data-testid={`notification-mark-read-${notification.notificationId}`}
                          onClick={() => {
                            void markNotificationRead(notification.notificationId);
                          }}
                          type="button"
                        >
                          Mark as read
                        </button>
                      )}
                </li>
              ))}
            </ul>
          )}
        </section>

        <Outlet />
      </section>

      <SiteFooter variant="protected" />
    </main>
  );
}
