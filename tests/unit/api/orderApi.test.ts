import {
  createOrderSession,
  extendOrderSession,
  executeOrderSession,
  getOrderSession,
  verifyOrderSessionOtp,
} from '@/api/orderApi';
import { api } from '@/lib/axios';

vi.mock('@/lib/axios', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
  },
  createNormalizedApiError: vi.fn((message: string, options?: Record<string, unknown>) =>
    Object.assign(new Error(message), options),
  ),
}));

describe('orderApi', () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset();
    vi.mocked(api.post).mockReset();
  });

  it('creates order sessions through /api/v1/orders/sessions with json payload and X-ClOrdID header', async () => {
    vi.mocked(api.post).mockResolvedValue({
      data: {
        orderSessionId: 'sess-001',
        clOrdId: 'cl-001',
        status: 'PENDING_NEW',
        challengeRequired: true,
        authorizationReason: 'ELEVATED_ORDER_RISK',
        accountId: 1,
        symbol: '005930',
        side: 'BUY',
        orderType: 'LIMIT',
        qty: 2,
        price: 71000,
        expiresAt: '2026-03-13T00:00:00Z',
      },
    } as never);

    await createOrderSession({
      accountId: 1,
      symbol: '005930',
      side: 'BUY',
      quantity: 2,
      price: 71000,
      clOrdId: 'cl-001',
    });

    expect(api.post).toHaveBeenCalledWith(
      '/api/v1/orders/sessions',
      {
        accountId: 1,
        symbol: '005930',
        side: 'BUY',
        orderType: 'LIMIT',
        qty: 2,
        price: 71000,
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'X-ClOrdID': 'cl-001',
        },
      },
    );
  });

  it('executes an authorized order session through the canonical execute path', async () => {
    vi.mocked(api.post).mockResolvedValue({
      data: {
        orderSessionId: 'sess-001',
        clOrdId: 'cl-001',
        status: 'COMPLETED',
        challengeRequired: false,
        authorizationReason: 'RECENT_LOGIN_MFA',
        accountId: 1,
        symbol: '005930',
        side: 'BUY',
        orderType: 'LIMIT',
        qty: 2,
        price: 71000,
        executionResult: 'FILLED',
        expiresAt: '2026-03-13T00:00:00Z',
      },
    } as never);

    await executeOrderSession('sess-001');

    expect(api.post).toHaveBeenCalledWith(
      '/api/v1/orders/sessions/sess-001/execute',
      {},
    );
  });

  it('verifies order-session OTP through the canonical step-up endpoint', async () => {
    vi.mocked(api.post)
      .mockResolvedValue({
        data: {
          orderSessionId: 'sess-001',
          clOrdId: 'cl-001',
          status: 'AUTHED',
          challengeRequired: true,
          authorizationReason: 'ELEVATED_ORDER_RISK',
          accountId: 1,
          symbol: '005930',
          side: 'BUY',
          orderType: 'LIMIT',
          qty: 2,
          price: 71000,
          expiresAt: '2026-03-13T00:00:00Z',
        },
      } as never);

    await verifyOrderSessionOtp('sess-001', '123456');

    expect(api.post).toHaveBeenCalledWith(
      '/api/v1/orders/sessions/sess-001/otp/verify',
      {
        otpCode: '123456',
      },
    );
  });

  it('extends an active order session through the canonical extend endpoint', async () => {
    vi.mocked(api.post).mockResolvedValue({
      data: {
        orderSessionId: 'sess-001',
        clOrdId: 'cl-001',
        status: 'AUTHED',
        challengeRequired: false,
        authorizationReason: 'TRUSTED_AUTH_SESSION',
        accountId: 1,
        symbol: '005930',
        side: 'BUY',
        orderType: 'LIMIT',
        qty: 2,
        price: 71000,
        expiresAt: '2026-03-13T01:00:00Z',
      },
    } as never);

    await extendOrderSession('sess-001');

    expect(api.post).toHaveBeenCalledWith(
      '/api/v1/orders/sessions/sess-001/extend',
      {},
    );
  });

  it('loads order-session status through the canonical session path', async () => {
    vi.mocked(api.get).mockResolvedValue({
      data: {
        orderSessionId: 'sess-restore-001',
        clOrdId: 'cl-restore-001',
        status: 'PENDING_NEW',
        challengeRequired: true,
        authorizationReason: 'ELEVATED_ORDER_RISK',
        accountId: 1,
        symbol: '005930',
        side: 'BUY',
        orderType: 'LIMIT',
        qty: 1,
        price: 70100,
        expiresAt: '2026-03-13T00:00:00Z',
      },
    } as never);

    await getOrderSession('sess-restore-001');

    expect(api.get).toHaveBeenCalledWith(
      '/api/v1/orders/sessions/sess-restore-001',
    );
  });
});
