import { fetchAdminAuditLogs, invalidateMemberSessions } from '@/api/adminApi';
import { api } from '@/lib/axios';

const createNormalizedApiError = (message: string, metadata: {
  code: string;
  status: number;
  detail?: string;
}) => {
  const error = new Error(message);
  error.name = 'ApiClientError';

  const normalized = error as { code?: string; status?: number; detail?: string };
  normalized.code = metadata.code;
  normalized.status = metadata.status;
  normalized.detail = metadata.detail;

  return normalized;
};

vi.mock('@/lib/axios', () => ({
  api: {
    delete: vi.fn(),
    get: vi.fn(),
  },
  createNormalizedApiError: (...args: Parameters<typeof createNormalizedApiError>) =>
    createNormalizedApiError(...args),
}));

describe('adminApi', () => {
  beforeEach(() => {
    vi.mocked(api.delete).mockReset();
    vi.mocked(api.get).mockReset();
  });

  it('invalidates sessions through the canonical member UUID path', async () => {
    vi.mocked(api.delete).mockResolvedValue({
      data: {
        memberUuid: 'member-001',
        invalidatedCount: 2,
        message: '로그아웃 처리 완료',
      },
    } as never);

    await expect(invalidateMemberSessions({
      memberUuid: 'member-001',
    })).resolves.toEqual({
      memberUuid: 'member-001',
      invalidatedCount: 2,
      message: '로그아웃 처리 완료',
    });

    expect(api.delete).toHaveBeenCalledWith('/api/v1/admin/members/member-001/sessions');
  });

  it('encodes member UUID in the invalidation path', async () => {
    vi.mocked(api.delete).mockResolvedValue({
      data: {
        memberUuid: 'member-001%2Fadmin',
        invalidatedCount: 1,
        message: '로그아웃 처리 완료',
      },
    } as never);

    await expect(
      invalidateMemberSessions({
        memberUuid: 'member-001/admin',
      }),
    ).resolves.toEqual({
      memberUuid: 'member-001%2Fadmin',
      invalidatedCount: 1,
      message: '로그아웃 처리 완료',
    });

    expect(api.delete).toHaveBeenCalledWith('/api/v1/admin/members/member-001%2Fadmin/sessions');
  });

  it('normalizes audit query filters to memberId and eventType', async () => {
    vi.mocked(api.get).mockResolvedValue({
      data: {
        content: [],
        totalElements: 0,
        totalPages: 0,
        number: 0,
        size: 20,
      },
    } as never);

    await expect(
      fetchAdminAuditLogs({
        page: 2,
        size: 50,
        memberId: 'member-001',
        eventType: 'LOGIN_FAIL',
        from: '2026-03-01T00:00:00Z',
        to: '2026-03-02T00:00:00Z',
      }),
    ).resolves.toEqual({
      content: [],
      totalElements: 0,
      totalPages: 0,
      number: 0,
      size: 20,
    });

    expect(api.get).toHaveBeenCalledWith('/api/v1/admin/audit-logs', {
      params: {
        page: 2,
        size: 50,
        from: '2026-03-01T00:00:00Z',
        to: '2026-03-02T00:00:00Z',
        memberId: 'member-001',
        eventType: 'LOGIN_FAIL',
      },
    });
  });

  it('drops undefined query arguments when fetching audit logs', async () => {
    vi.mocked(api.get).mockResolvedValue({
      data: {
        content: [],
        totalElements: 0,
        totalPages: 0,
        number: 0,
        size: 20,
      },
    } as never);

    await fetchAdminAuditLogs({
      page: 0,
      size: 20,
    });

    expect(api.get).toHaveBeenCalledWith('/api/v1/admin/audit-logs', {
      params: {
        page: 0,
        size: 20,
      },
    });
  });

  it('rejects invalid page size on client side before calling backend', async () => {
    await expect(
      fetchAdminAuditLogs({
        page: 0,
        size: 101,
      }),
    ).rejects.toMatchObject({
      code: 'VALIDATION-001',
    });

    expect(api.get).not.toHaveBeenCalled();
  });

  it('rejects invalid iso date-time query values on client side', async () => {
    await expect(
      fetchAdminAuditLogs({
        from: '2026-03-18',
      }),
    ).rejects.toMatchObject({
      code: 'VALIDATION-001',
    });

    expect(api.get).not.toHaveBeenCalled();
  });
});
