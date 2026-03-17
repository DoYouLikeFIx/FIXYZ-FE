import { createContext } from 'react';
import type { NotificationItem } from '@/types/notification';

interface NotificationState {
  sessionExpiryRemainingSeconds: number | null;
  sessionExpiryMonitoringUnavailable: boolean;
  notifications: NotificationItem[];
  isHydratingNotifications: boolean;
  notificationFeedUnavailable: boolean;
  notificationFeedErrorMessage: string | null;
  notificationReadErrorMessage: string | null;
}

export interface NotificationContextValue extends NotificationState {
  clearSessionExpiryWarning: () => void;
  markNotificationRead: (notificationId: number) => Promise<void>;
  refreshNotifications: () => Promise<void>;
}

export const NotificationContext = createContext<NotificationContextValue | null>(null);
