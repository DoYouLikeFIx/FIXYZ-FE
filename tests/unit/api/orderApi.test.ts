import { submitExternalOrder } from '@/api/orderApi';
import { api } from '@/lib/axios';

vi.mock('@/lib/axios', () => ({
  api: {
    post: vi.fn(),
  },
}));

describe('orderApi', () => {
  beforeEach(() => {
    vi.mocked(api.post).mockReset();
  });

  it('submits orders through /api/v1/orders with the expected form payload', async () => {
    vi.mocked(api.post).mockResolvedValue({
      data: {
        data: {
          orderId: 'order-001',
          status: 'RECEIVED',
        },
      },
    } as never);

    await submitExternalOrder({
      accountId: 1,
      symbol: '005930',
      side: 'BUY',
      quantity: 2,
      price: 71000,
      clOrdId: 'cl-001',
    });

    expect(api.post).toHaveBeenCalledTimes(1);
    const [url, body, config] = vi.mocked(api.post).mock.calls[0];
    expect(url).toBe('/api/v1/orders');
    expect(body).toBeInstanceOf(URLSearchParams);
    expect((body as URLSearchParams).toString()).toContain('accountId=1');
    expect((body as URLSearchParams).toString()).toContain('symbol=005930');
    expect((body as URLSearchParams).toString()).toContain('side=BUY');
    expect((body as URLSearchParams).toString()).toContain('quantity=2');
    expect((body as URLSearchParams).toString()).toContain('price=71000');
    expect(config).toMatchObject({
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-ClOrdID': 'cl-001',
      },
    });
  });
});
