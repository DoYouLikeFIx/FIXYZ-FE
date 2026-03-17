export interface NotificationItem {
  notificationId: number;
  channel: string;
  message: string;
  delivered: boolean;
  read: boolean;
  readAt: string | null;
}
