import { act } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { fetchAdminAuditLogs, invalidateMemberSessions } from '@/api/adminApi';
import { AdminConsolePage } from '@/pages/AdminConsolePage';
import { resetAuthStore } from '@/store/useAuthStore';
import type { AdminAuditLogsPage } from '@/types/admin';

vi.mock('@/api/adminApi', () => ({
  fetchAdminAuditLogs: vi.fn(),
  invalidateMemberSessions: vi.fn(),
}));

const createAuditLog = (id: string) => ({
  auditId: id,
  memberUuid: 'member-001',
  email: 'member-001@example.com',
  eventType: 'LOGIN_SUCCESS',
  ipAddress: '127.0.0.1',
  userAgent: 'playwright',
  description: `event-${id}`,
  clOrdId: null,
  orderSessionId: null,
  createdAt: '2026-03-18T09:00:00Z',
});

const createAuditPage = (contentId: string, totalPages = 1): AdminAuditLogsPage => ({
  content: [createAuditLog(contentId)],
  totalElements: 1,
  totalPages,
  number: 0,
  size: 20,
});

describe('AdminConsolePage', () => {
  beforeEach(() => {
    resetAuthStore();
    vi.mocked(fetchAdminAuditLogs).mockReset();
    vi.mocked(invalidateMemberSessions).mockReset();
    vi.mocked(fetchAdminAuditLogs).mockResolvedValue(createAuditPage('log-0', 1));
  });

  it('shows the force-logout and audit-search entry points for admin users', async () => {
    render(<AdminConsolePage />);

    expect(screen.getByTestId('admin-force-member-uuid')).toBeInTheDocument();
    expect(screen.getByTestId('admin-audit-search')).toBeInTheDocument();
    expect(await screen.findByTestId('admin-audit-row-log-0')).toBeInTheDocument();
  });

  it('shows successful feedback for force-logout with invalidatedCount=0', async () => {
    const user = userEvent.setup();
    vi.mocked(invalidateMemberSessions).mockResolvedValue({
      memberUuid: 'member-001',
      invalidatedCount: 0,
      message: '이미 비활성 세션 상태입니다.',
    });

    render(<AdminConsolePage />);

    await user.type(screen.getByTestId('admin-force-member-uuid'), 'member-001');
    await user.click(screen.getByTestId('admin-force-submit'));

    expect(await screen.findByTestId('admin-force-feedback')).toHaveTextContent(
      '이미 비활성 세션 상태입니다. (무효화된 세션: 0건)',
    );
  });

  it('shows failure feedback for force-logout API errors', async () => {
    const user = userEvent.setup();
    vi.mocked(invalidateMemberSessions).mockRejectedValue(
      Object.assign(new Error('forbidden'), {
        code: 'AUTH-006',
      }),
    );

    render(<AdminConsolePage />);

    await user.type(screen.getByTestId('admin-force-member-uuid'), 'member-001');
    await user.click(screen.getByTestId('admin-force-submit'));

    expect(await screen.findByTestId('admin-force-feedback')).not.toHaveTextContent('0건');
  });

  it('applies audit filters and page navigation to the query contract', async () => {
    const user = userEvent.setup();
    const expectedFrom = new Date('2026-03-18T00:00').toISOString();
    const expectedTo = new Date('2026-03-18T23:59').toISOString();
    vi.mocked(fetchAdminAuditLogs)
      .mockResolvedValueOnce(createAuditPage('log-0', 1))
      .mockResolvedValueOnce({
        content: [
          {
            ...createAuditLog('log-1'),
            eventType: 'LOGIN_FAIL',
          },
        ],
        totalElements: 2,
        totalPages: 2,
        number: 0,
        size: 20,
      })
      .mockResolvedValueOnce({
        ...createAuditPage('log-2', 2),
        number: 1,
      });

    render(<AdminConsolePage />);

    expect(await screen.findByTestId('admin-audit-row-log-0')).toBeInTheDocument();

    await user.type(screen.getByTestId('admin-audit-member-id'), 'member-001');
    await user.type(screen.getByTestId('admin-audit-from'), '2026-03-18T00:00');
    await user.type(screen.getByTestId('admin-audit-to'), '2026-03-18T23:59');
    await user.selectOptions(screen.getByTestId('admin-audit-event-type'), 'LOGIN_FAIL');
    await user.click(screen.getByTestId('admin-audit-search'));

    expect(await screen.findByTestId('admin-audit-row-log-1')).toBeInTheDocument();
    expect(vi.mocked(fetchAdminAuditLogs).mock.calls[1]).toEqual([
      {
        page: 0,
        size: 20,
        memberId: 'member-001',
        from: expectedFrom,
        to: expectedTo,
        eventType: 'LOGIN_FAIL',
      },
      expect.any(AbortSignal),
    ]);

    await user.click(screen.getByTestId('admin-audit-next'));
    expect(await screen.findByTestId('admin-audit-row-log-2')).toBeInTheDocument();
    expect(screen.getByTestId('admin-audit-page-indicator')).toHaveTextContent('2 / 2');

    expect(vi.mocked(fetchAdminAuditLogs).mock.calls[2]).toEqual([
      {
        page: 1,
        size: 20,
        memberId: 'member-001',
        from: expectedFrom,
        to: expectedTo,
        eventType: 'LOGIN_FAIL',
      },
      expect.any(AbortSignal),
    ]);

    await waitFor(() => {
      expect(vi.mocked(fetchAdminAuditLogs)).toHaveBeenCalledTimes(3);
    });
  });

  it('displays an error message when audit log fetch fails', async () => {
    vi.mocked(fetchAdminAuditLogs).mockRejectedValueOnce(
      Object.assign(new Error('service unavailable'), {
        code: 'ERR_NETWORK',
      }),
    );

    render(<AdminConsolePage />);

    expect(await screen.findByTestId('admin-audit-error')).toBeInTheDocument();
  });

  it('keeps the requested page even when API returns a different page number', async () => {
    const user = userEvent.setup();
    let resolveSecondRequest: (value: AdminAuditLogsPage) => void;

    vi.mocked(fetchAdminAuditLogs)
      .mockResolvedValueOnce(createAuditPage('log-0', 2))
      .mockImplementationOnce(
        () =>
          new Promise<AdminAuditLogsPage>((resolve) => {
            resolveSecondRequest = resolve;
          }),
      );

    render(<AdminConsolePage />);

    expect(await screen.findByTestId('admin-audit-row-log-0')).toBeInTheDocument();

    await user.click(screen.getByTestId('admin-audit-next'));

    await waitFor(() => {
      expect(vi.mocked(fetchAdminAuditLogs)).toHaveBeenCalledTimes(2);
    });

    await act(async () => {
      resolveSecondRequest({
        ...createAuditPage('log-1', 2),
        number: 0,
      });
    });

    expect(await screen.findByTestId('admin-audit-row-log-1')).toBeInTheDocument();
    expect(screen.getByTestId('admin-audit-page-indicator')).toHaveTextContent('2 / 2');
    expect(vi.mocked(fetchAdminAuditLogs).mock.calls[1]).toEqual([
      {
        page: 1,
        size: 20,
        memberId: undefined,
        from: undefined,
        to: undefined,
        eventType: undefined,
      },
      expect.any(AbortSignal),
    ]);
  });

  it('does not show stale audit error when a newer request succeeds', async () => {
    const user = userEvent.setup();
    let rejectFirstRequest: (error?: unknown) => void;
    let resolveSecondRequest: (value: AdminAuditLogsPage) => void;

    vi.mocked(fetchAdminAuditLogs)
      .mockImplementationOnce(
        () =>
          new Promise<AdminAuditLogsPage>((_, reject) => {
            rejectFirstRequest = reject;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise<AdminAuditLogsPage>((resolve) => {
            resolveSecondRequest = resolve;
          }),
      );

    render(<AdminConsolePage />);

    await user.type(screen.getByTestId('admin-audit-member-id'), 'member-001');
    await user.click(screen.getByTestId('admin-audit-search'));

    await waitFor(() => {
      expect(vi.mocked(fetchAdminAuditLogs)).toHaveBeenCalledTimes(2);
    });

    await act(async () => {
      resolveSecondRequest(createAuditPage('log-1', 1));
    });

    expect(await screen.findByTestId('admin-audit-row-log-1')).toBeInTheDocument();

    await act(async () => {
      rejectFirstRequest(new Error('stale failure'));
    });

    expect(screen.queryByTestId('admin-audit-error')).not.toBeInTheDocument();
  });

  it('keeps the latest audit logs when older responses arrive late', async () => {
    const user = userEvent.setup();
    let resolveFirstRequest!: (value: AdminAuditLogsPage) => void;
    let resolveSecondRequest!: (value: AdminAuditLogsPage) => void;

    vi.mocked(fetchAdminAuditLogs)
      .mockImplementationOnce(
        () =>
          new Promise<AdminAuditLogsPage>((resolve) => {
            resolveFirstRequest = resolve;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise<AdminAuditLogsPage>((resolve) => {
            resolveSecondRequest = resolve;
          }),
      )
      .mockResolvedValue(createAuditPage('ignored'));

    render(<AdminConsolePage />);

    await user.type(screen.getByTestId('admin-audit-member-id'), 'member-new');
    await user.click(screen.getByTestId('admin-audit-search'));

    await waitFor(() => {
      expect(vi.mocked(fetchAdminAuditLogs)).toHaveBeenCalledTimes(2);
    });

    await act(async () => {
      resolveSecondRequest({
        ...createAuditPage('newest-log', 1),
        number: 0,
      });
    });

    expect(await screen.findByTestId('admin-audit-row-newest-log')).toBeInTheDocument();

    await act(async () => {
      resolveFirstRequest(createAuditPage('stale-log'));
    });

    await waitFor(() => {
      expect(screen.queryByTestId('admin-audit-row-stale-log')).not.toBeInTheDocument();
    });
  });

  it('disables page size controls while audit logs are loading', async () => {
    let resolveRequest!: (value: AdminAuditLogsPage) => void;
    vi.mocked(fetchAdminAuditLogs).mockImplementation(
      () =>
        new Promise<AdminAuditLogsPage>((resolve) => {
          resolveRequest = resolve;
        }),
    );

    render(<AdminConsolePage />);

    const sizeButton = await screen.findByTestId('admin-audit-size-50');

    await waitFor(() => {
      expect(sizeButton).toBeDisabled();
    });

    await userEvent.click(sizeButton);

    expect(vi.mocked(fetchAdminAuditLogs)).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveRequest(createAuditPage('log-50'));
    });
  });
});
