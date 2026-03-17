import {
  fetchNotifications,
  markNotificationRead,
} from '@/api/notificationApi';
import { api } from '@/lib/axios';

vi.mock('@/lib/axios', () => ({
  api: {
    get: vi.fn(),
    patch: vi.fn(),
  },
}));

describe('notificationApi', () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset();
    vi.mocked(api.patch).mockReset();
  });

  it('loads notifications with default pagination contract', async () => {
    vi.mocked(api.get).mockResolvedValue({
      data: {
        items: [
          {
            notificationId: 101,
            channel: 'ORDER_SESSION',
            message: 'Order session completed.',
            delivered: true,
            read: false,
            readAt: null,
          },
        ],
      },
    } as never);

    await expect(fetchNotifications()).resolves.toEqual([
      {
        notificationId: 101,
        channel: 'ORDER_SESSION',
        message: 'Order session completed.',
        delivered: true,
        read: false,
        readAt: null,
      },
    ]);

    expect(api.get).toHaveBeenCalledWith('/api/v1/notifications', {
      params: {
        limit: 20,
        cursorId: undefined,
      },
    });
  });

  it('forwards cursor id while keeping canonical limit for backfill requests', async () => {
    vi.mocked(api.get).mockResolvedValue({
      data: {
        items: [],
      },
    } as never);

    await fetchNotifications(77);

    expect(api.get).toHaveBeenCalledWith('/api/v1/notifications', {
      params: {
        limit: 20,
        cursorId: 77,
      },
    });
  });

  it('marks a notification as read through the canonical patch endpoint', async () => {
    vi.mocked(api.patch).mockResolvedValue({
      data: {
        notificationId: 101,
        channel: 'ORDER_SESSION',
        message: 'Order session completed.',
        delivered: true,
        read: true,
        readAt: '2026-03-17T12:00:00Z',
      },
    } as never);

    await expect(markNotificationRead(101)).resolves.toMatchObject({
      notificationId: 101,
      read: true,
    });

    expect(api.patch).toHaveBeenCalledWith('/api/v1/notifications/101/read');
  });
});
