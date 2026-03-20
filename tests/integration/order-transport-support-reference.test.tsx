import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import {
  failureEnvelope,
  getPathname,
  installMockAxiosModule,
  successEnvelope,
} from '../fixtures/mockAxiosModule';

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
          expiresAt: '2026-03-20T10:00:00Z',
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
          expiresAt: '2026-03-20T10:00:00Z',
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
});
