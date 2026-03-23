import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import {
  failureEnvelope,
  getPathname,
  installMockAxiosModule,
  successEnvelope,
} from '../fixtures/mockAxiosModule';

const futureIso = (seconds = 3600) => new Date(Date.now() + seconds * 1000).toISOString();

describe.sequential('OrderPage transport coverage', () => {
  afterEach(() => {
    cleanup();
    vi.doUnmock('axios');
    vi.restoreAllMocks();
  });

  it('preserves a header-derived support reference through the real order execute transport path', async () => {
    const transport = await installMockAxiosModule((request) => {
      if (request.method === 'GET' && getPathname(request.url) === '/api/v1/auth/csrf') {
        return successEnvelope({
          token: 'csrf-order-transport-001',
        });
      }

      if (request.method === 'POST' && getPathname(request.url) === '/api/v1/orders/sessions') {
        return successEnvelope({
          orderSessionId: 'sess-transport-001',
          clOrdId: 'cl-transport-001',
          status: 'AUTHED',
          challengeRequired: false,
          authorizationReason: 'TRUSTED_AUTH_SESSION',
          accountId: 1,
          symbol: '005930',
          side: 'BUY',
          orderType: 'LIMIT',
          qty: 2,
          price: 71000,
          expiresAt: futureIso(),
        });
      }

      if (
        request.method === 'POST'
        && getPathname(request.url) === '/api/v1/orders/sessions/sess-transport-001/execute'
      ) {
        return failureEnvelope(
          {
            code: 'FEP-002',
            message:
              '주문이 아직 확정되지 않았습니다. 체결 완료로 간주하지 말고 알림이나 주문 상태를 확인해 주세요.',
            detail:
              '거래소 확인이 끝나지 않아 최종 체결 여부를 아직 단정할 수 없습니다.',
            operatorCode: 'TIMEOUT',
            timestamp: '2026-03-19T00:00:00Z',
          },
          {
            headers: {
              'x-correlation-id': 'corr-order-transport-001, corr-order-ignored',
            },
          },
        );
      }

      if (
        request.method === 'GET'
        && getPathname(request.url) === '/api/v1/orders/sessions/sess-transport-001'
      ) {
        return successEnvelope({
          orderSessionId: 'sess-transport-001',
          clOrdId: 'cl-transport-001',
          status: 'EXECUTING',
          challengeRequired: false,
          authorizationReason: 'TRUSTED_AUTH_SESSION',
          accountId: 1,
          symbol: '005930',
          side: 'BUY',
          orderType: 'LIMIT',
          qty: 2,
          price: 71000,
          expiresAt: futureIso(),
        });
      }

      throw new Error(`Unhandled request: ${request.method} ${request.url}`);
    });
    const authStore = await import('@/store/useAuthStore');
    const { OrderPage } = await import('@/pages/OrderPage');

    authStore.resetAuthStore();
    authStore.useAuthStore.setState({
      member: {
        memberUuid: 'member-001',
        email: 'demo@fix.com',
        name: 'Demo User',
        role: 'ROLE_USER',
        totpEnrolled: true,
        accountId: '1',
      },
      status: 'authenticated',
    });
    window.sessionStorage.clear();

    const user = userEvent.setup();
    render(<OrderPage />);

    await user.click(screen.getByTestId('order-session-create'));
    await user.click(await screen.findByTestId('order-session-execute'));

    await waitFor(() => {
      expect(screen.getByTestId('external-order-error-support-reference')).toHaveTextContent(
        '문의 코드: corr-order-transport-001',
      );
    });
    expect(screen.getByTestId('external-order-error-title')).toHaveTextContent(
      '주문 결과를 확인하고 있습니다',
    );
    expect(screen.getByTestId('order-session-processing')).toHaveTextContent(
      '주문을 거래소에 전송했어요',
    );

    const executeCall = transport.calls.find(
      (call) =>
        call.method === 'POST'
        && getPathname(call.url) === '/api/v1/orders/sessions/sess-transport-001/execute',
    );

    expect(executeCall?.headers['X-CSRF-TOKEN']).toBe('csrf-order-transport-001');
  });

  it('keeps stale-quote guidance in Step A through the real order create transport path', async () => {
    const transport = await installMockAxiosModule((request) => {
      if (request.method === 'GET' && getPathname(request.url) === '/api/v1/auth/csrf') {
        return successEnvelope({
          token: 'csrf-order-transport-002',
        });
      }

      if (request.method === 'POST' && getPathname(request.url) === '/api/v1/orders/sessions') {
        return failureEnvelope(
          {
            code: 'VALIDATION-003',
            message: '시장가 주문에 사용할 시세가 오래되었습니다.',
            detail: '시장가 주문에 사용한 quote snapshot이 허용 범위를 초과했습니다.',
            operatorCode: 'STALE_QUOTE',
            userMessageKey: 'error.quote.stale',
            details: {
              symbol: '005930',
              quoteSnapshotId: 'qsnap-replay-001',
              quoteSourceMode: 'REPLAY',
              snapshotAgeMs: 65_000,
            },
            timestamp: '2026-03-23T00:00:00Z',
          },
          {
            status: 400,
            headers: {
              'x-correlation-id': 'corr-order-transport-002',
            },
          },
        );
      }

      throw new Error(`Unhandled request: ${request.method} ${request.url}`);
    });
    const authStore = await import('@/store/useAuthStore');
    const { OrderPage } = await import('@/pages/OrderPage');

    authStore.resetAuthStore();
    authStore.useAuthStore.setState({
      member: {
        memberUuid: 'member-001',
        email: 'demo@fix.com',
        name: 'Demo User',
        role: 'ROLE_USER',
        totpEnrolled: true,
        accountId: '1',
      },
      status: 'authenticated',
    });
    window.sessionStorage.clear();

    const user = userEvent.setup();
    render(<OrderPage />);

    await user.click(screen.getByTestId('external-order-preset-krx-market-buy-3'));
    await user.click(screen.getByTestId('order-session-create'));

    await waitFor(() => {
      expect(screen.getByTestId('order-session-error-category')).toHaveTextContent('검증');
    });
    expect(screen.getByTestId('order-session-stale-quote-guidance')).toHaveTextContent(
      'symbol=005930',
    );
    expect(screen.getByTestId('order-session-stale-quote-guidance')).toHaveTextContent(
      'quoteSnapshotId=qsnap-replay-001',
    );
    expect(screen.getByTestId('order-session-stale-quote-guidance')).toHaveTextContent(
      'quoteSourceMode=REPLAY',
    );
    expect(screen.getByTestId('order-session-stale-quote-guidance')).toHaveTextContent(
      'snapshotAgeMs=65000',
    );
    expect(screen.queryByTestId('external-order-feedback')).not.toBeInTheDocument();
    expect(screen.queryByTestId('order-session-error')).not.toBeInTheDocument();
    expect(screen.queryByTestId('order-session-otp-input')).not.toBeInTheDocument();
    expect(screen.queryByTestId('order-session-execute')).not.toBeInTheDocument();
    expect(screen.getByTestId('order-session-create')).toBeInTheDocument();

    const createCall = transport.calls.find(
      (call) =>
        call.method === 'POST' && getPathname(call.url) === '/api/v1/orders/sessions',
    );

    expect(JSON.parse(createCall?.body ?? '{}')).toMatchObject({
      accountId: 1,
      symbol: '005930',
      orderType: 'MARKET',
      qty: 3,
      price: null,
    });
    expect(createCall?.headers['X-CSRF-TOKEN']).toBe('csrf-order-transport-002');
  });
});
