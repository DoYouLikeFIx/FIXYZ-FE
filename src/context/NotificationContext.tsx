import {
  useEffect,
  useMemo,
  useReducer,
  type ReactNode,
} from 'react';

import {
  NotificationContext,
  type NotificationContextValue,
} from '@/context/notification-context';
import type { SessionExpiryEventPayload } from '@/types/auth';
import { useAuthStore } from '@/store/useAuthStore';

const RECONNECT_DELAYS_MS = [3_000, 6_000, 12_000] as const;

interface NotificationState {
  sessionExpiryRemainingSeconds: number | null;
  sessionExpiryMonitoringUnavailable: boolean;
}

type NotificationAction =
  | {
      type: 'SESSION_EXPIRY_RECEIVED';
      remainingSeconds: number;
    }
  | {
      type: 'SESSION_EXPIRY_CLEARED';
    }
  | {
      type: 'SESSION_EXPIRY_MONITORING_UNAVAILABLE';
    }
  | {
      type: 'SESSION_EXPIRY_MONITORING_RESTORED';
    };

const initialNotificationState: NotificationState = {
  sessionExpiryRemainingSeconds: null,
  sessionExpiryMonitoringUnavailable: false,
};

const notificationReducer = (
  state: NotificationState,
  action: NotificationAction,
): NotificationState => {
  switch (action.type) {
    case 'SESSION_EXPIRY_RECEIVED':
      return {
        ...state,
        sessionExpiryRemainingSeconds: action.remainingSeconds,
        sessionExpiryMonitoringUnavailable: false,
      };
    case 'SESSION_EXPIRY_CLEARED':
      return {
        ...state,
        sessionExpiryRemainingSeconds: null,
      };
    case 'SESSION_EXPIRY_MONITORING_UNAVAILABLE':
      return {
        sessionExpiryRemainingSeconds: null,
        sessionExpiryMonitoringUnavailable: true,
      };
    case 'SESSION_EXPIRY_MONITORING_RESTORED':
      return {
        ...state,
        sessionExpiryMonitoringUnavailable: false,
      };
    default:
      return state;
  }
};

const parseRemainingSeconds = (value: unknown) => {
  if (typeof value !== 'object' || value === null) {
    return null;
  }

  const remainingSeconds = (value as Partial<SessionExpiryEventPayload>).remainingSeconds;

  return typeof remainingSeconds === 'number' ? remainingSeconds : null;
};

const resolveNotificationStreamUrl = () => {
  const configuredBaseUrl = import.meta.env.VITE_API_BASE_URL?.trim();

  if (!configuredBaseUrl) {
    return '/api/v1/notifications/stream';
  }

  return new URL('/api/v1/notifications/stream', configuredBaseUrl).toString();
};

export function NotificationProvider({ children }: { children: ReactNode }) {
  const authStatus = useAuthStore((state) => state.status);
  const [state, dispatch] = useReducer(notificationReducer, initialNotificationState);

  useEffect(() => {
    if (authStatus !== 'authenticated') {
      dispatch({ type: 'SESSION_EXPIRY_CLEARED' });
      dispatch({ type: 'SESSION_EXPIRY_MONITORING_RESTORED' });
      return undefined;
    }

    if (typeof EventSource === 'undefined') {
      dispatch({ type: 'SESSION_EXPIRY_MONITORING_UNAVAILABLE' });
      return undefined;
    }

    dispatch({ type: 'SESSION_EXPIRY_MONITORING_RESTORED' });

    let active = true;
    let reconnectHandle: number | null = null;
    let stream: EventSource | null = null;
    let reconnectAttempt = 0;

    const handleSessionExpiry = (event: MessageEvent<string>) => {
      try {
        const parsed = JSON.parse(event.data) as SessionExpiryEventPayload;
        const remainingSeconds = parseRemainingSeconds(parsed);

        if (remainingSeconds !== null) {
          reconnectAttempt = 0;
          dispatch({ type: 'SESSION_EXPIRY_MONITORING_RESTORED' });
          dispatch({
            type: 'SESSION_EXPIRY_RECEIVED',
            remainingSeconds,
          });
        }
      } catch {
        // Ignore malformed payloads and keep the stream alive for the next event.
      }
    };

    const connect = () => {
      try {
        stream = new EventSource(resolveNotificationStreamUrl(), {
          withCredentials: true,
        });
        stream.onopen = () => {
          reconnectAttempt = 0;
          dispatch({ type: 'SESSION_EXPIRY_MONITORING_RESTORED' });
        };
        stream.addEventListener(
          'session-expiry',
          handleSessionExpiry as EventListener,
        );
        stream.onerror = () => {
          stream?.removeEventListener(
            'session-expiry',
            handleSessionExpiry as EventListener,
          );
          stream?.close();

          if (!active) {
            return;
          }

          if (reconnectAttempt >= RECONNECT_DELAYS_MS.length) {
            dispatch({ type: 'SESSION_EXPIRY_MONITORING_UNAVAILABLE' });
            return;
          }

          const reconnectDelay = RECONNECT_DELAYS_MS[reconnectAttempt];
          reconnectAttempt += 1;
          reconnectHandle = window.setTimeout(connect, reconnectDelay);
        };
      } catch {
        dispatch({ type: 'SESSION_EXPIRY_MONITORING_UNAVAILABLE' });
      }
    };

    connect();

    return () => {
      active = false;

      if (reconnectHandle !== null) {
        window.clearTimeout(reconnectHandle);
      }

      stream?.removeEventListener(
        'session-expiry',
        handleSessionExpiry as EventListener,
      );
      stream?.close();
    };
  }, [authStatus]);

  const value = useMemo<NotificationContextValue>(
    () => ({
      ...state,
      clearSessionExpiryWarning: () => {
        dispatch({ type: 'SESSION_EXPIRY_CLEARED' });
      },
    }),
    [state],
  );

  return (
    <NotificationContext.Provider value={value}>
      {children}
    </NotificationContext.Provider>
  );
}
