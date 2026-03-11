import {
  fetchAccountOrderHistory,
  fetchAccountPositions,
  fetchAccountSummary,
  fetchAccountPosition,
} from '@/api/accountApi';
import { api } from '@/lib/axios';

vi.mock('@/lib/axios', () => ({
  api: {
    get: vi.fn(),
  },
}));

describe('accountApi', () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset();
  });

  it('fetches the account position with the expected symbol query', async () => {
    vi.mocked(api.get).mockResolvedValue({
      data: {
        accountId: 1,
        memberId: 1,
        symbol: '005930',
      },
    } as never);

    await fetchAccountPosition({
      accountId: '1',
      symbol: '005930',
    });

    expect(api.get).toHaveBeenCalledWith('/api/v1/accounts/1/positions', {
      params: {
        symbol: '005930',
      },
    });
  });

  it('fetches account positions from the owned positions list endpoint', async () => {
    vi.mocked(api.get).mockResolvedValue({
      data: [],
    } as never);

    await fetchAccountPositions({
      accountId: '1',
    });

    expect(api.get).toHaveBeenCalledWith('/api/v1/accounts/1/positions/list');
  });

  it('fetches the account summary fallback endpoint', async () => {
    vi.mocked(api.get).mockResolvedValue({
      data: {
        accountId: 1,
        memberId: 1,
        symbol: '',
      },
    } as never);

    await fetchAccountSummary({
      accountId: '1',
    });

    expect(api.get).toHaveBeenCalledWith('/api/v1/accounts/1/summary');
  });

  it('fetches account order history with page and size parameters', async () => {
    vi.mocked(api.get).mockResolvedValue({
      data: {
        content: [],
        totalElements: 0,
        totalPages: 0,
        number: 0,
        size: 10,
      },
    } as never);

    await fetchAccountOrderHistory({
      accountId: '1',
      page: 2,
      size: 5,
    });

    expect(api.get).toHaveBeenCalledWith('/api/v1/accounts/1/orders', {
      params: {
        page: 2,
        size: 5,
      },
    });
  });
});
