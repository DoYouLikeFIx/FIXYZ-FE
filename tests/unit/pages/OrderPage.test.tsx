import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import {
  createOrderSession,
  extendOrderSession,
  executeOrderSession,
  getOrderSession,
  verifyOrderSessionOtp,
} from '@/api/orderApi';
import { OrderPage } from '@/pages/OrderPage';
import { resetAuthStore, useAuthStore } from '@/store/useAuthStore';
import type { Member } from '@/types/auth';

vi.mock('@/api/orderApi', () => ({
  createOrderSession: vi.fn(),
  extendOrderSession: vi.fn(),
  verifyOrderSessionOtp: vi.fn(),
  executeOrderSession: vi.fn(),
  getOrderSession: vi.fn(),
}));

const memberFixture: Member = {
  memberUuid: 'member-001',
  email: 'demo@fix.com',
  name: 'Demo User',
  role: 'ROLE_USER',
  totpEnrolled: true,
  accountId: '1',
};

const futureIso = (seconds = 3600) =>
  new Date(Date.now() + seconds * 1000).toISOString();

const createDeferred = <T,>() => {
  let resolvePromise!: (value: T | PromiseLike<T>) => void;
  let rejectPromise!: (reason?: unknown) => void;

  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });

  return {
    promise,
    reject: rejectPromise,
    resolve: resolvePromise,
  };
};

describe('OrderPage', () => {
  beforeEach(() => {
    resetAuthStore();
    useAuthStore.setState({ member: memberFixture, status: 'authenticated' });
    vi.mocked(createOrderSession).mockReset();
    vi.mocked(extendOrderSession).mockReset();
    vi.mocked(executeOrderSession).mockReset();
    vi.mocked(getOrderSession).mockReset();
    vi.mocked(verifyOrderSessionOtp).mockReset();
    window.sessionStorage.clear();
  });

  it('shows the external recovery panel when execute returns an FEP error', async () => {
    vi.mocked(createOrderSession).mockResolvedValue({
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
      expiresAt: futureIso(),
    });
    vi.mocked(executeOrderSession).mockRejectedValue(
      Object.assign(new Error('pending confirmation'), {
        name: 'ApiClientError',
        code: 'FEP-002',
        message: '주문이 아직 확정되지 않았습니다. 체결 완료로 간주하지 말고 알림이나 주문 상태를 확인해 주세요.',
        traceId: 'trace-fep-002',
      }),
    );
    const user = userEvent.setup();

    render(<OrderPage />);

    await user.click(screen.getByTestId('order-session-create'));
    await user.click(await screen.findByTestId('order-session-execute'));

    expect(await screen.findByTestId('external-order-error-title')).toHaveTextContent(
      '주문 결과를 확인하고 있습니다',
    );
    expect(screen.getByTestId('external-order-error-support-reference')).toHaveTextContent(
      '문의 코드: trace-fep-002',
    );
  });

  it('shows inline feedback for create-stage application errors', async () => {
    vi.mocked(createOrderSession).mockRejectedValue(
      Object.assign(new Error('입력 값을 다시 확인해 주세요.'), {
        name: 'ApiClientError',
        code: 'ORD-006',
        status: 422,
      }),
    );
    const user = userEvent.setup();

    render(<OrderPage />);

    await user.click(screen.getByTestId('order-session-create'));

    expect(await screen.findByTestId('order-session-error')).toHaveTextContent(
      '입력 값을 다시 확인해 주세요.',
    );
    await waitFor(() => {
      expect(screen.queryByTestId('external-order-error-panel')).not.toBeInTheDocument();
    });
  });

  it('maps server-side Step A validation rejects back to quantity guidance', async () => {
    vi.mocked(createOrderSession).mockRejectedValue(
      Object.assign(new Error('가용 수량을 다시 확인해 주세요.'), {
        name: 'ApiClientError',
        code: 'ORD-003',
        status: 422,
      }),
    );
    const user = userEvent.setup();

    render(<OrderPage />);

    await user.click(screen.getByTestId('order-session-create'));

    expect(await screen.findByTestId('order-input-qty-error')).toHaveTextContent(
      '가용 수량을 다시 확인해 주세요.',
    );
    expect(screen.getByTestId('external-order-feedback')).toHaveTextContent(
      '수량을 수정한 뒤 다시 시도해 주세요.',
    );
    expect(screen.queryByTestId('order-session-error')).not.toBeInTheDocument();
  });

  it('shows account-level guidance for insufficient cash without pinning the quantity field', async () => {
    vi.mocked(createOrderSession).mockRejectedValue(
      Object.assign(new Error('available cash is insufficient'), {
        name: 'ApiClientError',
        code: 'ORD-001',
        status: 422,
      }),
    );
    const user = userEvent.setup();

    render(<OrderPage />);

    await user.click(screen.getByTestId('order-session-create'));

    expect(await screen.findByTestId('order-session-error')).toHaveTextContent(
      'available cash is insufficient',
    );
    expect(screen.getByTestId('external-order-feedback')).toHaveTextContent(
      '매수 가능 금액을 확인하거나 수량을 조정한 뒤 다시 시도해 주세요.',
    );
    expect(screen.queryByTestId('order-input-qty-error')).not.toBeInTheDocument();
  });

  it('shows client-side validation messages for invalid symbol and quantity input', async () => {
    const user = userEvent.setup();

    render(<OrderPage />);

    const symbolInput = screen.getByTestId('order-input-symbol');
    const quantityInput = screen.getByTestId('order-input-qty');

    await user.clear(symbolInput);
    await user.type(symbolInput, '12');
    await user.clear(quantityInput);
    await user.type(quantityInput, '0');

    expect(screen.getByTestId('order-input-symbol-error')).toHaveTextContent(
      '종목코드는 숫자 6자리여야 합니다.',
    );
    expect(screen.getByTestId('order-input-qty-error')).toHaveTextContent(
      '수량은 1 이상의 정수여야 합니다.',
    );
    expect(screen.getByTestId('order-session-create')).toBeDisabled();
    expect(createOrderSession).not.toHaveBeenCalled();
  });

  it('normalizes embedded spaces in symbol input before submit', async () => {
    vi.mocked(createOrderSession).mockResolvedValue({
      orderSessionId: 'sess-normalized-symbol',
      clOrdId: 'cl-normalized-symbol',
      status: 'PENDING_NEW',
      challengeRequired: true,
      authorizationReason: 'ELEVATED_ORDER_RISK',
      accountId: 1,
      symbol: '005930',
      side: 'BUY',
      orderType: 'LIMIT',
      qty: 1,
      price: 70100,
      expiresAt: futureIso(),
    });
    const user = userEvent.setup();

    render(<OrderPage />);

    const symbolInput = screen.getByTestId('order-input-symbol');
    await user.clear(symbolInput);
    await user.type(symbolInput, '005 930');
    await user.click(screen.getByTestId('order-session-create'));

    await waitFor(() => {
      expect(createOrderSession).toHaveBeenCalledWith(
        expect.objectContaining({
          symbol: '005930',
        }),
      );
    });
  });

  it('moves to Step B with authorization guidance when the created session requires challenge', async () => {
    vi.mocked(createOrderSession).mockResolvedValue({
      orderSessionId: 'sess-step-b',
      clOrdId: 'cl-step-b',
      status: 'PENDING_NEW',
      challengeRequired: true,
      authorizationReason: 'ELEVATED_ORDER_RISK',
      accountId: 1,
      symbol: '005930',
      side: 'BUY',
      orderType: 'LIMIT',
      qty: 3,
      price: 70100,
      expiresAt: futureIso(),
    });
    const user = userEvent.setup();

    render(<OrderPage />);

    await user.click(screen.getByTestId('order-session-create'));

    expect(await screen.findByTestId('order-session-otp-input')).toBeInTheDocument();
    expect(screen.getByTestId('order-session-authorization-message')).toHaveTextContent(
      '고위험 주문으로 분류되어 주문 실행 전에 OTP 인증이 필요합니다.',
    );
  });

  it('shows the 60-second warning bar and extends an active order session', async () => {
    vi.mocked(createOrderSession).mockResolvedValue({
      orderSessionId: 'sess-step-b',
      clOrdId: 'cl-step-b',
      status: 'PENDING_NEW',
      challengeRequired: true,
      authorizationReason: 'ELEVATED_ORDER_RISK',
      accountId: 1,
      symbol: '005930',
      side: 'BUY',
      orderType: 'LIMIT',
      qty: 3,
      price: 70100,
      expiresAt: futureIso(45),
    });
    vi.mocked(extendOrderSession).mockResolvedValue({
      orderSessionId: 'sess-step-b',
      clOrdId: 'cl-step-b',
      status: 'PENDING_NEW',
      challengeRequired: true,
      authorizationReason: 'ELEVATED_ORDER_RISK',
      accountId: 1,
      symbol: '005930',
      side: 'BUY',
      orderType: 'LIMIT',
      qty: 3,
      price: 70100,
      expiresAt: futureIso(),
    });
    const user = userEvent.setup();

    render(<OrderPage />);

    await user.click(screen.getByTestId('order-session-create'));
    expect(await screen.findByTestId('order-session-warning')).toBeInTheDocument();
    await user.click(screen.getByTestId('order-session-extend'));

    expect(extendOrderSession).toHaveBeenCalledWith('sess-step-b');
  });

  it('shows an expired-session modal and restarts the draft when the session has expired', async () => {
    vi.mocked(createOrderSession).mockResolvedValue({
      orderSessionId: 'sess-expired',
      clOrdId: 'cl-expired',
      status: 'AUTHED',
      challengeRequired: false,
      authorizationReason: 'TRUSTED_AUTH_SESSION',
      accountId: 1,
      symbol: '005930',
      side: 'BUY',
      orderType: 'LIMIT',
      qty: 2,
      price: 70100,
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    });
    const user = userEvent.setup();

    render(<OrderPage />);

    await user.click(screen.getByTestId('order-session-create'));
    expect(await screen.findByTestId('order-session-expired-modal')).toBeInTheDocument();

    await user.click(screen.getByTestId('order-session-expired-restart'));

    await waitFor(() => {
      expect(screen.queryByTestId('order-session-expired-modal')).not.toBeInTheDocument();
    });
    expect(screen.getByTestId('order-session-create')).toBeInTheDocument();
    expect(screen.getByTestId('order-session-error')).toHaveTextContent(
      '주문 세션이 만료되었습니다. 입력한 주문을 확인한 뒤 다시 시작해 주세요.',
    );
  });

  it('returns from Step B to Step A without discarding the created session context', async () => {
    vi.mocked(createOrderSession).mockResolvedValue({
      orderSessionId: 'sess-step-b',
      clOrdId: 'cl-step-b',
      status: 'PENDING_NEW',
      challengeRequired: true,
      authorizationReason: 'ELEVATED_ORDER_RISK',
      accountId: 1,
      symbol: '005930',
      side: 'BUY',
      orderType: 'LIMIT',
      qty: 3,
      price: 70100,
      expiresAt: futureIso(),
    });
    const user = userEvent.setup();

    render(<OrderPage />);

    await user.click(screen.getByTestId('order-session-create'));
    await user.click(await screen.findByTestId('order-session-reset'));

    expect(screen.queryByTestId('order-session-otp-input')).not.toBeInTheDocument();
    expect(screen.getByTestId('order-session-summary')).toHaveTextContent('상태 PENDING_NEW');
    expect(screen.getByTestId('external-order-feedback')).toHaveTextContent(
      '고위험 주문으로 분류되어 주문 실행 전에 OTP 인증이 필요합니다.',
    );
    expect(screen.getByTestId('order-session-create')).toBeInTheDocument();
  });

  it('ignores stale OTP verification success after returning from Step B to Step A', async () => {
    const verifyDeferred = createDeferred<Awaited<ReturnType<typeof verifyOrderSessionOtp>>>();
    vi.mocked(createOrderSession).mockResolvedValue({
      orderSessionId: 'sess-step-b',
      clOrdId: 'cl-step-b',
      status: 'PENDING_NEW',
      challengeRequired: true,
      authorizationReason: 'ELEVATED_ORDER_RISK',
      accountId: 1,
      symbol: '005930',
      side: 'BUY',
      orderType: 'LIMIT',
      qty: 1,
      price: 70100,
      expiresAt: futureIso(),
    });
    vi.mocked(verifyOrderSessionOtp).mockReturnValue(verifyDeferred.promise);
    const user = userEvent.setup();

    render(<OrderPage />);

    await user.click(screen.getByTestId('order-session-create'));
    fireEvent.change(await screen.findByTestId('order-session-otp-input'), {
      target: { value: '123456' },
    });
    fireEvent.click(screen.getByTestId('order-session-reset'));

    verifyDeferred.resolve({
      orderSessionId: 'sess-step-b',
      clOrdId: 'cl-step-b',
      status: 'AUTHED',
      challengeRequired: true,
      authorizationReason: 'ELEVATED_ORDER_RISK',
      accountId: 1,
      symbol: '005930',
      side: 'BUY',
      orderType: 'LIMIT',
      qty: 1,
      price: 70100,
      expiresAt: futureIso(),
    });

    await waitFor(() => {
      expect(screen.queryByTestId('order-session-otp-input')).not.toBeInTheDocument();
    });
    expect(screen.queryByTestId('order-session-execute')).not.toBeInTheDocument();
    expect(screen.getByTestId('order-session-create')).toBeInTheDocument();
    expect(screen.getByTestId('order-session-summary')).toHaveTextContent('상태 PENDING_NEW');
  });

  it('locks preset switching while execute is in flight', async () => {
    const executeDeferred = createDeferred<Awaited<ReturnType<typeof executeOrderSession>>>();
    vi.mocked(createOrderSession).mockResolvedValue({
      orderSessionId: 'sess-auth',
      clOrdId: 'cl-auth',
      status: 'AUTHED',
      challengeRequired: false,
      authorizationReason: 'TRUSTED_AUTH_SESSION',
      accountId: 1,
      symbol: '005930',
      side: 'BUY',
      orderType: 'LIMIT',
      qty: 2,
      price: 70100,
      expiresAt: futureIso(),
    });
    vi.mocked(executeOrderSession).mockReturnValue(executeDeferred.promise);
    const user = userEvent.setup();

    render(<OrderPage />);

    await user.click(screen.getByTestId('order-session-create'));
    await user.click(await screen.findByTestId('order-session-execute'));

    expect(screen.getByTestId('external-order-preset-krx-buy-5')).toBeDisabled();

    executeDeferred.resolve({
      orderSessionId: 'sess-auth',
      clOrdId: 'cl-auth',
      status: 'COMPLETED',
      challengeRequired: false,
      authorizationReason: 'TRUSTED_AUTH_SESSION',
      accountId: 1,
      symbol: '005930',
      side: 'BUY',
      orderType: 'LIMIT',
      qty: 2,
      price: 70100,
      executionResult: 'FILLED',
      expiresAt: futureIso(),
    });

    await screen.findByTestId('order-session-reset');
  });

  it('restores a pending order session into Step B from sessionStorage', async () => {
    window.sessionStorage.setItem('fixyz.order-session-id:1', 'sess-restore-001');
    vi.mocked(getOrderSession).mockResolvedValue({
      orderSessionId: 'sess-restore-001',
      clOrdId: 'cl-restore-001',
      status: 'PENDING_NEW',
      challengeRequired: true,
      authorizationReason: 'ELEVATED_ORDER_RISK',
      accountId: 1,
      symbol: '005930',
      side: 'BUY',
      orderType: 'LIMIT',
      qty: 5,
      price: 70100,
      expiresAt: futureIso(),
    });

    render(<OrderPage />);

    expect(await screen.findByTestId('order-session-otp-input')).toBeInTheDocument();
    expect(getOrderSession).toHaveBeenCalledWith('sess-restore-001');
    expect(screen.getByTestId('order-session-selected-summary')).toHaveTextContent(
      '005930 · 삼성전자 · 5주',
    );
  });

  it('does not restore a session saved for a different account scope', () => {
    window.sessionStorage.setItem('fixyz.order-session-id:999', 'sess-other-account');

    render(<OrderPage />);

    expect(getOrderSession).not.toHaveBeenCalled();
    expect(screen.queryByTestId('order-session-otp-input')).not.toBeInTheDocument();
  });

  it('gates the order boundary when the authenticated member has no valid order account id', () => {
    useAuthStore.setState({
      member: {
        ...memberFixture,
        accountId: undefined,
      },
      status: 'authenticated',
    });

    render(<OrderPage />);

    expect(screen.getByTestId('order-boundary-unavailable')).toBeInTheDocument();
    expect(screen.queryByTestId('order-session-create')).not.toBeInTheDocument();
  });
});
