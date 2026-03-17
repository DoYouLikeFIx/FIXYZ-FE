import { api } from '@/lib/axios';
import type { NotificationItem } from '@/types/notification';

interface NotificationListResponse {
  items: NotificationItem[];
}

export const fetchNotifications = async (
  cursorId?: number,
): Promise<NotificationItem[]> => {
  const response = await api.get<NotificationListResponse>('/api/v1/notifications', {
    params: {
      limit: 20,
      cursorId,
    },
  });

  return response.data.items;
};

export const markNotificationRead = async (
  notificationId: number,
): Promise<NotificationItem> => {
  const response = await api.patch<NotificationItem>(
    `/api/v1/notifications/${notificationId}/read`,
  );

  return response.data;
};
