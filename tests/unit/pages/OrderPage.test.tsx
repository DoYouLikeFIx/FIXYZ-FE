import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

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

const testFileUrl = import.meta.url.startsWith('file:')
  ? import.meta.url
  : `file://${import.meta.url}`;

type SharedProcessingStateCase = {
  name: string;
  status: string;
  title: string;
  body: string;
};

type SharedAuthorizationScenario = {
  scenarioKey: string;
  status: string;
  challengeRequired: boolean;
  authorizationReason: string;
  failureReason?: string;
  clientStep: string;
  nextAction: string;
  title: string;
  body: string;
};

type SharedFinalResultCase = {
  name: string;
  status: string;
  executionResult?: string;
  title: string;
  body: string;
  externalOrderId?: string;
  executionResultLabel?: string;
  executedQty?: number;
  executedQtyLabel?: string;
  executedPrice?: number;
  executedPriceLabel?: string;
  failureReason?: string;
  failureReasonLabel?: string;
  leavesQty?: number;
  leavesQtyLabel?: string;
  canceledAt?: string;
  canceledAtLabel?: string;
};

const sharedOrderSessionContractCases = JSON.parse(
  readFileSync(
    fileURLToPath(`${new URL('../../order-session-contract-cases.json', testFileUrl)}`),
    'utf8',
  ),
) as {
  authorizationScenarios: SharedAuthorizationScenario[];
  processingStates: SharedProcessingStateCase[];
  finalResults: SharedFinalResultCase[];
};

const sharedAuthorizationScenarios = sharedOrderSessionContractCases.authorizationScenarios;
const sharedProcessingStateCases = sharedOrderSessionContractCases.processingStates;
const sharedFinalResultCases = sharedOrderSessionContractCases.finalResults;
const authorizationScenario = (scenarioKey: string) => {
  const scenario = sharedAuthorizationScenarios.find(
    (candidate) => candidate.scenarioKey === scenarioKey,
  );

  if (!scenario) {
    throw new Error(`Missing authorization scenario: ${scenarioKey}`);
  }

  return scenario;
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

  it('preserves the external recovery panel when execute returns an FEP error and session refresh succeeds', async () => {
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
    vi.mocked(getOrderSession).mockResolvedValue({
      orderSessionId: 'sess-001',
      clOrdId: 'cl-001',
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
    const user = userEvent.setup();

    render(<OrderPage />);

    await user.click(screen.getByTestId('order-session-create'));
    await user.click(await screen.findByTestId('order-session-execute'));

    await waitFor(() => {
      expect(getOrderSession).toHaveBeenCalledWith('sess-001');
    });
    expect(await screen.findByTestId('external-order-error-title')).toHaveTextContent(
      '주문 결과를 확인하고 있습니다',
    );
    expect(screen.getByTestId('external-order-error-support-reference')).toHaveTextContent(
      '문의 코드: trace-fep-002',
    );
    expect(screen.getByTestId('order-session-processing')).toHaveTextContent(
      '주문을 거래소에 전송했어요',
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
    const scenario = authorizationScenario('challenge-required-step-up');

    vi.mocked(createOrderSession).mockResolvedValue({
      orderSessionId: 'sess-step-b',
      clOrdId: 'cl-step-b',
      status: scenario.status,
      challengeRequired: scenario.challengeRequired,
      authorizationReason: scenario.authorizationReason,
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
      scenario.body,
    );
    expect(screen.queryByTestId('order-session-execute')).not.toBeInTheDocument();
  });

  it('moves to Step C with the canonical auto-authorized guidance when extra verification is not required', async () => {
    const scenario = authorizationScenario('auto-authorized-confirm');
    const user = userEvent.setup();

    vi.mocked(createOrderSession).mockResolvedValue({
      orderSessionId: 'sess-step-c',
      clOrdId: 'cl-step-c',
      status: scenario.status,
      challengeRequired: scenario.challengeRequired,
      authorizationReason: scenario.authorizationReason,
      accountId: 1,
      symbol: '005930',
      side: 'BUY',
      orderType: 'LIMIT',
      qty: 1,
      price: 70100,
      expiresAt: futureIso(),
    });

    render(<OrderPage />);

    await user.click(screen.getByTestId('order-session-create'));

    expect(await screen.findByTestId('order-session-execute')).toBeInTheDocument();
    expect(screen.getByTestId('order-session-authorization-message')).toHaveTextContent(
      scenario.body,
    );
    expect(screen.queryByTestId('order-session-otp-input')).not.toBeInTheDocument();
  });

  it('maps replayed OTP verification into deterministic guidance', async () => {
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
    vi.mocked(verifyOrderSessionOtp).mockRejectedValue(
      Object.assign(new Error('otp code already used in current window'), {
        name: 'ApiClientError',
        code: 'AUTH-011',
        status: 401,
      }),
    );
    const user = userEvent.setup();

    render(<OrderPage />);

    await user.click(screen.getByTestId('order-session-create'));
    fireEvent.change(await screen.findByTestId('order-session-otp-input'), {
      target: { value: '123456' },
    });

    expect(await screen.findByTestId('order-session-error')).toHaveTextContent(
      '이미 사용한 OTP 코드입니다. 새 코드가 표시되면 다시 입력해 주세요.',
    );
  });

  it('maps throttled OTP verification into retry guidance', async () => {
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
    vi.mocked(verifyOrderSessionOtp).mockRejectedValue(
      Object.assign(new Error('rate limit exceeded'), {
        name: 'ApiClientError',
        code: 'RATE_001',
        status: 429,
      }),
    );
    const user = userEvent.setup();

    render(<OrderPage />);

    await user.click(screen.getByTestId('order-session-create'));
    fireEvent.change(await screen.findByTestId('order-session-otp-input'), {
      target: { value: '123456' },
    });

    expect(await screen.findByTestId('order-session-error')).toHaveTextContent(
      'OTP를 너무 빠르게 연속 제출했습니다. 잠시 후 다시 시도해 주세요.',
    );
  });

  it('maps canonicalized OTP mismatch errors into remaining-attempts guidance', async () => {
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
    vi.mocked(verifyOrderSessionOtp).mockRejectedValue(
      Object.assign(new Error('otp mismatch'), {
        name: 'ApiClientError',
        code: 'CHANNEL_002',
        remainingAttempts: 2,
        status: 401,
      }),
    );
    const user = userEvent.setup();

    render(<OrderPage />);

    await user.click(screen.getByTestId('order-session-create'));
    fireEvent.change(await screen.findByTestId('order-session-otp-input'), {
      target: { value: '123456' },
    });

    expect(await screen.findByTestId('order-session-error')).toHaveTextContent(
      'OTP 코드가 일치하지 않습니다. 남은 시도 2회',
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

  it('does not treat an active session with null expiry metadata as already expired', async () => {
    vi.mocked(createOrderSession).mockResolvedValue({
      orderSessionId: 'sess-null-expiry',
      clOrdId: 'cl-null-expiry',
      status: 'AUTHED',
      challengeRequired: false,
      authorizationReason: 'TRUSTED_AUTH_SESSION',
      accountId: 1,
      symbol: '005930',
      side: 'BUY',
      orderType: 'LIMIT',
      qty: 2,
      price: 70100,
      expiresAt: null,
    });
    const user = userEvent.setup();

    render(<OrderPage />);

    await user.click(screen.getByTestId('order-session-create'));

    expect(await screen.findByTestId('order-session-execute')).toBeInTheDocument();
    expect(screen.queryByTestId('order-session-warning')).not.toBeInTheDocument();
    expect(screen.queryByTestId('order-session-expired-modal')).not.toBeInTheDocument();
  });

  it('shows an expired-session modal and restarts the draft when the session has expired', async () => {
    const scenario = authorizationScenario('expired-session-reset');

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
    expect(screen.getByText(scenario.title)).toBeInTheDocument();

    await user.click(screen.getByTestId('order-session-expired-restart'));

    await waitFor(() => {
      expect(screen.queryByTestId('order-session-expired-modal')).not.toBeInTheDocument();
    });
    expect(screen.getByTestId('order-session-create')).toBeInTheDocument();
    expect(screen.getByTestId('order-session-error')).toHaveTextContent(
      '세션이 만료되었습니다.',
    );
    expect(screen.getByTestId('order-session-error')).toHaveTextContent(
      scenario.body,
    );
  });

  it('shows a blocking expired-session modal when Step B verify detects a stale session', async () => {
    const scenario = authorizationScenario('expired-session-reset');

    vi.mocked(createOrderSession).mockResolvedValue({
      orderSessionId: 'sess-expired-verify',
      clOrdId: 'cl-expired-verify',
      status: 'PENDING_NEW',
      challengeRequired: true,
      authorizationReason: 'ELEVATED_ORDER_RISK',
      accountId: 1,
      symbol: '005930',
      side: 'BUY',
      orderType: 'LIMIT',
      qty: 2,
      price: 70100,
      expiresAt: futureIso(),
    });
    vi.mocked(verifyOrderSessionOtp).mockRejectedValue(
      Object.assign(new Error('Order session not found.'), {
        name: 'ApiClientError',
        code: 'ORD-008',
        status: 404,
      }),
    );
    const user = userEvent.setup();

    render(<OrderPage />);

    await user.click(screen.getByTestId('order-session-create'));
    fireEvent.change(await screen.findByTestId('order-session-otp-input'), {
      target: { value: '123456' },
    });

    expect(await screen.findByTestId('order-session-expired-modal')).toBeInTheDocument();
    await user.click(screen.getByTestId('order-session-expired-restart'));

    await waitFor(() => {
      expect(screen.queryByTestId('order-session-expired-modal')).not.toBeInTheDocument();
    });
    expect(screen.getByTestId('order-session-error')).toHaveTextContent(
      '세션이 만료되었습니다.',
    );
    expect(screen.getByTestId('order-session-error')).toHaveTextContent(
      scenario.body,
    );
  });

  it('renders canonical OTP exhaustion restart guidance when a failed session is restored', async () => {
    const scenario = authorizationScenario('failed-session-reset');

    window.sessionStorage.setItem('fixyz.order-session-id:1', 'sess-failed-restore');
    vi.mocked(getOrderSession).mockResolvedValue({
      orderSessionId: 'sess-failed-restore',
      clOrdId: 'cl-failed-restore',
      status: scenario.status,
      challengeRequired: scenario.challengeRequired,
      authorizationReason: scenario.authorizationReason,
      accountId: 1,
      symbol: '005930',
      side: 'BUY',
      orderType: 'LIMIT',
      qty: 2,
      price: 70100,
      failureReason: scenario.failureReason,
      createdAt: futureIso(10),
      updatedAt: futureIso(10),
    });

    render(<OrderPage />);

    expect(await screen.findByTestId('order-session-result-title')).toHaveTextContent(
      scenario.title,
    );
    expect(screen.getByText(scenario.body)).toBeInTheDocument();
    expect(screen.getByTestId('order-session-reset')).toBeInTheDocument();
    expect(screen.queryByTestId('order-session-otp-input')).not.toBeInTheDocument();
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
      authorizationScenario('challenge-required-step-up').body,
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

  it('refreshes processing guidance from polled order-session status', async () => {
    const setIntervalSpy = vi.spyOn(window, 'setInterval');
    const requeryingState = sharedProcessingStateCases.find(
      (candidate) => candidate.status === 'REQUERYING',
    );
    vi.mocked(createOrderSession).mockResolvedValue({
      orderSessionId: 'sess-processing',
      clOrdId: 'cl-processing',
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
    vi.mocked(executeOrderSession).mockResolvedValue({
      orderSessionId: 'sess-processing',
      clOrdId: 'cl-processing',
      status: 'EXECUTING',
      challengeRequired: false,
      authorizationReason: 'TRUSTED_AUTH_SESSION',
      accountId: 1,
      symbol: '005930',
      side: 'BUY',
      orderType: 'LIMIT',
      qty: 2,
      price: 70100,
      expiresAt: null,
    });
    vi.mocked(getOrderSession).mockResolvedValue({
      orderSessionId: 'sess-processing',
      clOrdId: 'cl-processing',
      status: 'REQUERYING',
      challengeRequired: false,
      authorizationReason: 'TRUSTED_AUTH_SESSION',
      accountId: 1,
      symbol: '005930',
      side: 'BUY',
      orderType: 'LIMIT',
      qty: 2,
      price: 70100,
      expiresAt: null,
    });
    const user = userEvent.setup();

    render(<OrderPage />);

    await user.click(screen.getByTestId('order-session-create'));
    await user.click(await screen.findByTestId('order-session-execute'));

    await waitFor(() => {
      expect(getOrderSession).toHaveBeenCalledWith('sess-processing');
    });
    expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 30_000);
    expect(await screen.findByTestId('order-session-processing')).toHaveTextContent(
      requeryingState?.title ?? '주문 체결 결과를 다시 확인하고 있어요',
    );
    expect(screen.getByTestId('order-session-processing')).toHaveTextContent(
      requeryingState?.body
        ?? '체결 결과를 재조회하는 중입니다. 완료로 간주하지 말고 상태가 바뀔 때까지 기다려 주세요.',
    );
    expect(screen.getByTestId('order-result-clordid')).toHaveTextContent('cl-processing');
    expect(screen.queryByTestId('external-order-feedback')).not.toBeInTheDocument();
    setIntervalSpy.mockRestore();
  });

  it('transitions a polled processing session into a final result without losing context', async () => {
    const filledResult = sharedFinalResultCases.find(
      (candidate) => candidate.executionResult === 'FILLED',
    );
    const processingDeferred = createDeferred<Awaited<ReturnType<typeof getOrderSession>>>();
    vi.mocked(createOrderSession).mockResolvedValue({
      orderSessionId: 'sess-processing-transition',
      clOrdId: 'cl-processing-transition',
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
    vi.mocked(executeOrderSession).mockResolvedValue({
      orderSessionId: 'sess-processing-transition',
      clOrdId: 'cl-processing-transition',
      status: 'EXECUTING',
      challengeRequired: false,
      authorizationReason: 'TRUSTED_AUTH_SESSION',
      accountId: 1,
      symbol: '005930',
      side: 'BUY',
      orderType: 'LIMIT',
      qty: 2,
      price: 70100,
      expiresAt: null,
    });
    vi.mocked(getOrderSession)
      .mockResolvedValueOnce({
        orderSessionId: 'sess-processing-transition',
        clOrdId: 'cl-processing-transition',
        status: 'REQUERYING',
        challengeRequired: false,
        authorizationReason: 'TRUSTED_AUTH_SESSION',
        accountId: 1,
        symbol: '005930',
        side: 'BUY',
        orderType: 'LIMIT',
        qty: 2,
        price: 70100,
        expiresAt: null,
      })
      .mockImplementationOnce(() => processingDeferred.promise)
      .mockResolvedValueOnce({
        orderSessionId: 'sess-processing-transition',
        clOrdId: 'cl-processing-transition',
        status: filledResult?.status ?? 'COMPLETED',
        challengeRequired: false,
        authorizationReason: 'TRUSTED_AUTH_SESSION',
        accountId: 1,
        symbol: '005930',
        side: 'BUY',
        orderType: 'LIMIT',
        qty: 2,
        price: 70100,
        executionResult: filledResult?.executionResult,
        externalOrderId: filledResult?.externalOrderId,
        executedPrice: filledResult?.executedPrice,
        canceledAt: filledResult?.canceledAt,
        expiresAt: null,
      });
    const user = userEvent.setup();

    render(<OrderPage />);

    await user.click(screen.getByTestId('order-session-create'));
    await user.click(await screen.findByTestId('order-session-execute'));

    await waitFor(() => {
      expect(getOrderSession).toHaveBeenCalledTimes(2);
    });
    expect(await screen.findByTestId('order-session-processing')).toBeInTheDocument();

    processingDeferred.resolve({
      orderSessionId: 'sess-processing-transition',
      clOrdId: 'cl-processing-transition',
      status: 'EXECUTING',
      challengeRequired: false,
      authorizationReason: 'TRUSTED_AUTH_SESSION',
      accountId: 1,
      symbol: '005930',
      side: 'BUY',
      orderType: 'LIMIT',
      qty: 2,
      price: 70100,
      expiresAt: null,
    });
    await waitFor(() => {
      expect(getOrderSession).toHaveBeenCalledTimes(3);
    });

    expect(await screen.findByTestId('order-session-result-title')).toHaveTextContent(
      filledResult?.title ?? '주문이 체결되었습니다',
    );
    expect(screen.getByTestId('order-result-clordid')).toHaveTextContent('cl-processing-transition');
    expect(screen.getByTestId('order-result-execution-result')).toHaveTextContent(
      filledResult?.executionResultLabel ?? 'FILLED',
    );
    expect(screen.queryByTestId('external-order-feedback')).not.toBeInTheDocument();
  });

  it('shows manual-review guidance for escalated order sessions', async () => {
    vi.mocked(createOrderSession).mockResolvedValue({
      orderSessionId: 'sess-escalated',
      clOrdId: 'cl-escalated',
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
    vi.mocked(executeOrderSession).mockResolvedValue({
      orderSessionId: 'sess-escalated',
      clOrdId: 'cl-escalated',
      status: 'ESCALATED',
      challengeRequired: false,
      authorizationReason: 'TRUSTED_AUTH_SESSION',
      accountId: 1,
      symbol: '005930',
      side: 'BUY',
      orderType: 'LIMIT',
      qty: 2,
      price: 70100,
        failureReason: 'ESCALATED_MANUAL_REVIEW',
        expiresAt: null,
    });
    vi.mocked(getOrderSession).mockResolvedValue({
      orderSessionId: 'sess-escalated',
      clOrdId: 'cl-escalated',
      status: 'ESCALATED',
      challengeRequired: false,
      authorizationReason: 'TRUSTED_AUTH_SESSION',
      accountId: 1,
      symbol: '005930',
      side: 'BUY',
      orderType: 'LIMIT',
      qty: 2,
      price: 70100,
      failureReason: 'ESCALATED_MANUAL_REVIEW',
      expiresAt: null,
    });
    const user = userEvent.setup();

    render(<OrderPage />);

    await user.click(screen.getByTestId('order-session-create'));
    await user.click(await screen.findByTestId('order-session-execute'));

    const manualReview = await screen.findByTestId('order-session-manual-review');
    expect(manualReview).toHaveTextContent('처리 중 문제가 발생해 수동 확인이 필요합니다.');
    expect(manualReview).toHaveTextContent('주문 번호를 확인한 뒤 고객센터에 문의해 주세요.');
    expect(screen.getByTestId('order-result-clordid')).toHaveTextContent('cl-escalated');
  });

  it.each(sharedFinalResultCases)('renders final result details for $name', async ({
    executionResult,
    executedQty,
    failureReason,
    leavesQty,
    status,
    title,
    body,
    executionResultLabel,
    externalOrderId,
    executedQtyLabel,
    executedPrice,
    executedPriceLabel,
    failureReasonLabel,
    leavesQtyLabel,
    canceledAt,
    canceledAtLabel,
  }) => {
    vi.mocked(createOrderSession).mockResolvedValue({
      orderSessionId: 'sess-final-result',
      clOrdId: 'cl-final-result',
      status: 'AUTHED',
      challengeRequired: false,
      authorizationReason: 'TRUSTED_AUTH_SESSION',
      accountId: 1,
      symbol: '005930',
      side: 'BUY',
      orderType: 'LIMIT',
      qty: 10,
      price: 70100,
      expiresAt: futureIso(),
    });
    vi.mocked(executeOrderSession).mockResolvedValue({
      orderSessionId: 'sess-final-result',
      clOrdId: 'cl-final-result',
      challengeRequired: false,
      authorizationReason: 'TRUSTED_AUTH_SESSION',
      accountId: 1,
      symbol: '005930',
      side: 'BUY',
      orderType: 'LIMIT',
      qty: 10,
      price: 70100,
      expiresAt: null,
      status,
      executionResult,
      executedQty,
      executedPrice,
      externalOrderId,
      failureReason,
      leavesQty,
      canceledAt,
    });
    const user = userEvent.setup();

    render(<OrderPage />);

    await user.click(screen.getByTestId('order-session-create'));
    await user.click(await screen.findByTestId('order-session-execute'));

    expect(await screen.findByTestId('order-session-result-title')).toHaveTextContent(title);
    expect(screen.getByTestId('order-session-result')).toHaveTextContent(body);
    expect(screen.getByTestId('order-result-clordid')).toHaveTextContent('cl-final-result');

    if (executionResultLabel) {
      expect(screen.getByTestId('order-result-execution-result')).toHaveTextContent(
        executionResultLabel,
      );
    } else {
      expect(screen.queryByTestId('order-result-execution-result')).not.toBeInTheDocument();
    }

    if (externalOrderId) {
      expect(screen.getByTestId('order-result-external-id')).toHaveTextContent(externalOrderId);
    } else {
      expect(screen.queryByTestId('order-result-external-id')).not.toBeInTheDocument();
    }

    if (executedQtyLabel) {
      expect(screen.getByTestId('order-result-executed-qty')).toHaveTextContent(executedQtyLabel);
    } else {
      expect(screen.queryByTestId('order-result-executed-qty')).not.toBeInTheDocument();
    }

    if (executedPriceLabel) {
      expect(screen.getByTestId('order-result-executed-price')).toHaveTextContent(executedPriceLabel);
    } else {
      expect(screen.queryByTestId('order-result-executed-price')).not.toBeInTheDocument();
    }

    if (leavesQtyLabel) {
      expect(screen.getByTestId('order-result-leaves-qty')).toHaveTextContent(leavesQtyLabel);
    } else {
      expect(screen.queryByTestId('order-result-leaves-qty')).not.toBeInTheDocument();
    }

    if (canceledAtLabel) {
      expect(screen.getByTestId('order-result-canceled-at')).toHaveTextContent(canceledAtLabel);
    } else {
      expect(screen.queryByTestId('order-result-canceled-at')).not.toBeInTheDocument();
    }

    if (failureReasonLabel) {
      expect(screen.getByTestId('order-result-failure-reason')).toHaveTextContent(
        failureReasonLabel,
      );
    } else {
      expect(screen.queryByTestId('order-result-failure-reason')).not.toBeInTheDocument();
    }
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
