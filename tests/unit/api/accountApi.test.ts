import {
  fetchAccountOrderHistory,
  fetchAccountPositions,
  fetchAccountSummary,
  fetchAccountPosition,
} from '@/api/accountApi';
import { api } from '@/lib/axios';
import type { AccountPosition, AccountSummary } from '@/types/account';

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

  it('returns the summary payload without inventing valuation fields', async () => {
    const summaryBody: AccountSummary = {
      accountId: 1,
      memberId: 1,
      symbol: '005930',
      quantity: 10,
      availableQuantity: 8,
      availableQty: 8,
      balance: 1_500_000,
      availableBalance: 1_500_000,
      currency: 'KRW',
      asOf: '2026-03-24T09:00:00Z',
    };
    vi.mocked(api.get).mockResolvedValue({
      data: summaryBody,
    } as never);

    const result = await fetchAccountSummary({
      accountId: '1',
    });

    expect(result).toEqual(summaryBody);
    expect(result).not.toHaveProperty('valuationStatus');
    expect(result).not.toHaveProperty('marketPrice');
  });

  it('preserves valuation nullability on position payloads', async () => {
    const positionBody: AccountPosition = {
      accountId: 1,
      memberId: 1,
      symbol: '005930',
      quantity: 10,
      availableQuantity: 8,
      availableQty: 8,
      balance: 1_500_000,
      availableBalance: 1_500_000,
      currency: 'KRW',
      asOf: '2026-03-24T09:00:00Z',
      avgPrice: 70_000,
      marketPrice: null,
      quoteSnapshotId: null,
      quoteAsOf: null,
      quoteSourceMode: null,
      unrealizedPnl: null,
      realizedPnlDaily: null,
      valuationStatus: 'UNAVAILABLE',
      valuationUnavailableReason: 'PROVIDER_UNAVAILABLE',
    };
    vi.mocked(api.get).mockResolvedValue({
      data: [positionBody],
    } as never);

    const [result] = await fetchAccountPositions({
      accountId: '1',
    });

    expect(result).toEqual(positionBody);
    expect(result.marketPrice).toBeNull();
    expect(result.unrealizedPnl).toBeNull();
    expect(result.valuationStatus).toBe('UNAVAILABLE');
    expect(result.valuationUnavailableReason).toBe('PROVIDER_UNAVAILABLE');
  });

  it('preserves quote freshness metadata on single-position payloads used by the market ticker', async () => {
    const positionBody: AccountPosition = {
      accountId: 1,
      memberId: 1,
      symbol: '005930',
      quantity: 10,
      availableQuantity: 8,
      availableQty: 8,
      balance: 1_500_000,
      availableBalance: 1_500_000,
      currency: 'KRW',
      asOf: '2026-03-24T09:00:00Z',
      avgPrice: 70_000,
      marketPrice: null,
      quoteSnapshotId: 'quote-001',
      quoteAsOf: '2026-03-24T08:55:00Z',
      quoteSourceMode: 'REPLAY',
      unrealizedPnl: null,
      realizedPnlDaily: null,
      valuationStatus: 'STALE',
      valuationUnavailableReason: 'STALE_QUOTE',
    };
    vi.mocked(api.get).mockResolvedValue({
      data: positionBody,
    } as never);

    const result = await fetchAccountPosition({
      accountId: '1',
      symbol: '005930',
    });

    expect(result).toEqual(positionBody);
    expect(result.quoteSnapshotId).toBe('quote-001');
    expect(result.quoteAsOf).toBe('2026-03-24T08:55:00Z');
    expect(result.quoteSourceMode).toBe('REPLAY');
    expect(result.valuationStatus).toBe('STALE');
    expect(result.valuationUnavailableReason).toBe('STALE_QUOTE');
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
