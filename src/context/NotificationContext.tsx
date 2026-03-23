import {
  useEffect,
  useMemo,
  useReducer,
  useCallback,
  useRef,
  type ReactNode,
} from 'react';

import {
  fetchNotifications,
  markNotificationRead as markNotificationReadApi,
} from '@/api/notificationApi';
import {
  NotificationContext,
  type NotificationContextValue,
} from '@/context/notification-context';
import { useAuth } from '@/hooks/auth/useAuth';
import type { SessionExpiryEventPayload } from '@/types/auth';
import type { NotificationItem } from '@/types/notification';

const RECONNECT_DELAYS_MS = [3_000, 6_000, 12_000] as const;
const NOTIFICATION_POLL_INTERVAL_MS = 15_000;

interface NotificationState {
  sessionExpiryRemainingSeconds: number | null;
  sessionExpiryMonitoringUnavailable: boolean;
  notifications: NotificationItem[];
  isHydratingNotifications: boolean;
  notificationFeedUnavailable: boolean;
  notificationFeedErrorMessage: string | null;
  notificationReadErrorMessage: string | null;
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
    }
  | {
      type: 'NOTIFICATIONS_HYDRATION_STARTED';
    }
  | {
      type: 'NOTIFICATIONS_HYDRATED';
      notifications: NotificationItem[];
    }
  | {
      type: 'NOTIFICATIONS_HYDRATION_FAILED';
      message: string;
    }
  | {
      type: 'NOTIFICATION_RECEIVED';
      notification: NotificationItem;
    }
  | {
      type: 'NOTIFICATION_MARKED_READ';
      notification: NotificationItem;
    }
  | {
      type: 'NOTIFICATION_READ_FAILED';
      message: string;
    }
  | {
      type: 'NOTIFICATIONS_RESET';
    };

const initialNotificationState: NotificationState = {
  sessionExpiryRemainingSeconds: null,
  sessionExpiryMonitoringUnavailable: false,
  notifications: [],
  isHydratingNotifications: false,
  notificationFeedUnavailable: false,
  notificationFeedErrorMessage: null,
  notificationReadErrorMessage: null,
};

const mergeNotifications = (
  current: NotificationItem[],
  incoming: NotificationItem[],
) => {
  const byId = new Map<number, NotificationItem>();

  (current ?? []).forEach((item) => {
    byId.set(item.notificationId, item);
  });

  (incoming ?? []).forEach((item) => {
    byId.set(item.notificationId, item);
  });

  return Array.from(byId.values()).sort((left, right) => right.notificationId - left.notificationId);
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
        ...state,
        sessionExpiryRemainingSeconds: null,
        sessionExpiryMonitoringUnavailable: true,
      };
    case 'SESSION_EXPIRY_MONITORING_RESTORED':
      return {
        ...state,
        sessionExpiryMonitoringUnavailable: false,
      };
    case 'NOTIFICATIONS_HYDRATION_STARTED':
      return {
        ...state,
        isHydratingNotifications: true,
      };
    case 'NOTIFICATIONS_HYDRATED':
      return {
        ...state,
        notifications: mergeNotifications(state.notifications, action.notifications),
        isHydratingNotifications: false,
        notificationFeedUnavailable: false,
        notificationFeedErrorMessage: null,
      };
    case 'NOTIFICATIONS_HYDRATION_FAILED':
      return {
        ...state,
        isHydratingNotifications: false,
        notificationFeedUnavailable: true,
        notificationFeedErrorMessage: action.message,
      };
    case 'NOTIFICATION_RECEIVED':
      return {
        ...state,
        notifications: mergeNotifications(state.notifications, [action.notification]),
      };
    case 'NOTIFICATION_MARKED_READ':
      return {
        ...state,
        notifications: state.notifications.map((item) => (
          item.notificationId === action.notification.notificationId
            ? action.notification
            : item
        )),
        notificationReadErrorMessage: null,
      };
    case 'NOTIFICATION_READ_FAILED':
      return {
        ...state,
        notificationReadErrorMessage: action.message,
      };
    case 'NOTIFICATIONS_RESET':
      return {
        ...state,
        notifications: [],
        isHydratingNotifications: false,
        notificationFeedUnavailable: false,
        notificationFeedErrorMessage: null,
        notificationReadErrorMessage: null,
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
  const authStatus = useAuth((state) => state.status);
  const [state, dispatch] = useReducer(notificationReducer, initialNotificationState);
  const hydrationRequestIdRef = useRef(0);

  const hydrateNotifications = useCallback(async () => {
    const requestId = hydrationRequestIdRef.current + 1;
    hydrationRequestIdRef.current = requestId;
    dispatch({ type: 'NOTIFICATIONS_HYDRATION_STARTED' });

    try {
      const notifications = await fetchNotifications();

      if (hydrationRequestIdRef.current !== requestId) {
        return;
      }

      dispatch({
        type: 'NOTIFICATIONS_HYDRATED',
        notifications: Array.isArray(notifications) ? notifications : [],
      });
    } catch {
      if (hydrationRequestIdRef.current !== requestId) {
        return;
      }

      dispatch({
        type: 'NOTIFICATIONS_HYDRATION_FAILED',
        message: 'Notification feed is temporarily unavailable. Pull to refresh shortly.',
      });
    }
  }, []);

  const markNotificationRead = useCallback(async (notificationId: number) => {
    try {
      const markedNotification = await markNotificationReadApi(notificationId);
      dispatch({ type: 'NOTIFICATION_MARKED_READ', notification: markedNotification });
    } catch {
      dispatch({
        type: 'NOTIFICATION_READ_FAILED',
        message: 'Unable to mark notification as read. Please try again.',
      });
    }
  }, []);

  useEffect(() => {
    if (authStatus !== 'authenticated') {
      hydrationRequestIdRef.current += 1;
      dispatch({ type: 'SESSION_EXPIRY_CLEARED' });
      dispatch({ type: 'SESSION_EXPIRY_MONITORING_RESTORED' });
      dispatch({ type: 'NOTIFICATIONS_RESET' });
      return undefined;
    }

    void hydrateNotifications();

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

    const handleNotification = (event: MessageEvent<string>) => {
      try {
        const parsed = JSON.parse(event.data) as NotificationItem;

        if (
          typeof parsed.notificationId !== 'number'
          || typeof parsed.channel !== 'string'
          || typeof parsed.message !== 'string'
        ) {
          return;
        }

        dispatch({
          type: 'NOTIFICATION_RECEIVED',
          notification: {
            ...parsed,
            readAt: parsed.readAt ?? null,
          },
        });
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
          const isReconnectOpen = reconnectAttempt > 0;
          reconnectAttempt = 0;
          dispatch({ type: 'SESSION_EXPIRY_MONITORING_RESTORED' });

          if (isReconnectOpen) {
            void hydrateNotifications();
          }
        };
        stream.onmessage = handleNotification as (event: MessageEvent) => void;
        stream.addEventListener(
          'session-expiry',
          handleSessionExpiry as EventListener,
        );
        stream.addEventListener(
          'notification',
          handleNotification as EventListener,
        );
        stream.onerror = () => {
          stream?.removeEventListener(
            'session-expiry',
            handleSessionExpiry as EventListener,
          );
          stream?.removeEventListener(
            'notification',
            handleNotification as EventListener,
          );
          if (stream) {
            stream.onmessage = null;
          }
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
      stream?.removeEventListener(
        'notification',
        handleNotification as EventListener,
      );
      if (stream) {
        stream.onmessage = null;
      }
      stream?.close();
    };
  }, [authStatus, hydrateNotifications]);

  useEffect(() => {
    if (authStatus !== 'authenticated' || !state.notificationFeedUnavailable) {
      return undefined;
    }

    const pollingHandle = window.setInterval(() => {
      void hydrateNotifications();
    }, NOTIFICATION_POLL_INTERVAL_MS);

    return () => {
      window.clearInterval(pollingHandle);
    };
  }, [authStatus, hydrateNotifications, state.notificationFeedUnavailable]);

  const value = useMemo<NotificationContextValue>(
    () => ({
      ...state,
      clearSessionExpiryWarning: () => {
        dispatch({ type: 'SESSION_EXPIRY_CLEARED' });
      },
      markNotificationRead,
      refreshNotifications: async () => {
        await hydrateNotifications();
      },
    }),
    [hydrateNotifications, markNotificationRead, state],
  );

  return (
    <NotificationContext.Provider value={value}>
      {children}
    </NotificationContext.Provider>
  );
}
