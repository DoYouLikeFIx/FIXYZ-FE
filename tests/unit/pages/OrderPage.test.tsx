import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { fetchAccountPosition } from '@/api/accountApi';
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

import { createNormalizedApiErrorFromResponse } from '../../fixtures/createNormalizedApiErrorFromResponse';

vi.mock('@/api/orderApi', () => ({
  createOrderSession: vi.fn(),
  extendOrderSession: vi.fn(),
  verifyOrderSessionOtp: vi.fn(),
  executeOrderSession: vi.fn(),
  getOrderSession: vi.fn(),
}));

vi.mock('@/api/accountApi', () => ({
  fetchAccountPosition: vi.fn(),
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

const quoteDateFormatter = new Intl.DateTimeFormat('ko-KR', {
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

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

const createNormalizedOrderApiError = (options: {
  code: string;
  message: string;
  status: number;
  details?: Record<string, unknown>;
  operatorCode?: string;
  userMessageKey?: string;
  retryAfterSeconds?: number;
  correlationIdHeader?: string;
}) =>
  createNormalizedApiErrorFromResponse({
    code: options.code,
    message: options.message,
    status: options.status,
    details: options.details,
    operatorCode: options.operatorCode,
    userMessageKey: options.userMessageKey,
    retryAfterSeconds: options.retryAfterSeconds,
    correlationIdHeader: options.correlationIdHeader,
    path: '/api/v1/orders/sessions/sess-001/execute',
  });

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
  referenceField?: string;
  referenceLabel?: string;
  referenceVisible?: boolean;
  externalOrderId?: string;
  executionResultLabel?: string;
  executedQty?: number;
  executedQtyLabel?: string;
  executedPrice?: number;
  executedPriceLabel?: string;
  positionQuantityVisible?: boolean;
  positionQuantityLabel?: string;
  updatedPositionQuantity?: number;
  updatedPositionQuantityLabel?: string;
  positionQuantitySource?: string;
  positionQuantitySourceStory?: string;
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
    vi.mocked(fetchAccountPosition).mockReset();
    vi.mocked(fetchAccountPosition).mockResolvedValue({
      accountId: 1,
      memberId: 1,
      symbol: '005930',
      quantity: 120,
      availableQuantity: 20,
      availableQty: 20,
      balance: 100_000_000,
      availableBalance: 100_000_000,
      currency: 'KRW',
      asOf: '2026-03-18T09:00:00Z',
    });
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
      createNormalizedOrderApiError({
        code: 'FEP-002',
        message: '주문이 아직 확정되지 않았습니다. 체결 완료로 간주하지 말고 알림이나 주문 상태를 확인해 주세요.',
        status: 202,
        correlationIdHeader: 'trace-fep-002',
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
    expect(screen.getByTestId('external-order-error-category')).toHaveTextContent('대외');
    expect(screen.getByTestId('external-order-error-support-reference')).toHaveTextContent(
      '문의 코드: trace-fep-002',
    );
    expect(screen.getByTestId('order-session-processing')).toHaveTextContent(
      '주문을 거래소에 전송했어요',
    );
  });

  it('shows circuit-breaker retry guidance and clears it when returning to a fresh draft', async () => {
    vi.mocked(createOrderSession).mockResolvedValue({
      orderSessionId: 'sess-fep-001',
      clOrdId: 'cl-fep-001',
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
      createNormalizedOrderApiError({
        code: 'FEP-001',
        message: '거래소 연결이 일시적으로 불안정합니다. 주문이 접수되지 않았을 수 있습니다.',
        operatorCode: 'CIRCUIT_OPEN',
        retryAfterSeconds: 10,
        status: 503,
        correlationIdHeader: 'trace-fep-001',
      }),
    );
    vi.mocked(getOrderSession).mockResolvedValue({
      orderSessionId: 'sess-fep-001',
      clOrdId: 'cl-fep-001',
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
    const user = userEvent.setup();

    render(<OrderPage />);

    await user.click(screen.getByTestId('order-session-create'));
    await user.click(await screen.findByTestId('order-session-execute'));

    await waitFor(() => {
      expect(getOrderSession).toHaveBeenCalledWith('sess-fep-001');
    });
    expect(await screen.findByTestId('external-order-error-title')).toHaveTextContent(
      '주문 서비스를 잠시 사용할 수 없습니다',
    );
    expect(screen.getByTestId('external-order-error-message')).toHaveTextContent(
      '거래소 연결이 일시적으로 불안정합니다. 주문이 접수되지 않았을 수 있습니다.',
    );
    expect(screen.getByTestId('external-order-error-next-step')).toHaveTextContent(
      '약 10초 후 다시 주문해 주세요.',
    );
    expect(screen.getByTestId('external-order-error-support-reference')).toHaveTextContent(
      '문의 코드: trace-fep-001',
    );

    await user.click(screen.getByTestId('order-session-reset'));

    await waitFor(() => {
      expect(screen.queryByTestId('external-order-error-panel')).not.toBeInTheDocument();
    });
    expect(screen.getByTestId('order-session-create')).toBeInTheDocument();
  });

  it('clears execute-time external timeout guidance when the refreshed session reaches a final result', async () => {
    vi.mocked(createOrderSession).mockResolvedValue({
      orderSessionId: 'sess-timeout-final',
      clOrdId: 'cl-timeout-final',
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
      createNormalizedOrderApiError({
        code: 'FEP-002',
        message: '주문이 아직 확정되지 않았습니다. 체결 완료로 간주하지 말고 알림이나 주문 상태를 확인해 주세요.',
        operatorCode: 'TIMEOUT',
        status: 202,
        correlationIdHeader: 'trace-fep-002-final',
      }),
    );
    vi.mocked(getOrderSession).mockResolvedValue({
      orderSessionId: 'sess-timeout-final',
      clOrdId: 'cl-timeout-final',
      status: 'COMPLETED',
      challengeRequired: false,
      authorizationReason: 'TRUSTED_AUTH_SESSION',
      accountId: 1,
      symbol: '005930',
      side: 'BUY',
      orderType: 'LIMIT',
      qty: 2,
      price: 71000,
      executionResult: 'FILLED',
      expiresAt: futureIso(),
    });
    const user = userEvent.setup();

    render(<OrderPage />);

    await user.click(screen.getByTestId('order-session-create'));
    await user.click(await screen.findByTestId('order-session-execute'));

    await waitFor(() => {
      expect(getOrderSession).toHaveBeenCalledWith('sess-timeout-final');
    });
    expect(await screen.findByTestId('order-session-result-title')).toHaveTextContent(
      '주문이 체결되었습니다',
    );
    expect(screen.queryByTestId('external-order-error-panel')).not.toBeInTheDocument();
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
    expect(screen.getByTestId('order-session-error-category')).toHaveTextContent('검증');
    await waitFor(() => {
      expect(screen.queryByTestId('external-order-error-panel')).not.toBeInTheDocument();
    });
  });

  it('maps server-side Step A validation rejects back to quantity guidance', async () => {
    vi.mocked(createOrderSession).mockRejectedValue(
      Object.assign(new Error('가용 수량을 다시 확인해 주세요.'), {
        name: 'ApiClientError',
        code: 'ORD-005',
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
      '보유 수량 또는 일일 매도 가능 한도를 확인한 뒤 수량을 조정해 주세요.',
    );
    expect(screen.getByTestId('order-session-error-category')).toHaveTextContent('검증');
    expect(screen.queryByTestId('order-session-error')).not.toBeInTheDocument();
  });

  it('prefers machine-readable insufficient-position semantics for quantity guidance', async () => {
    vi.mocked(createOrderSession).mockRejectedValue(
      Object.assign(new Error('insufficient position quantity'), {
        name: 'ApiClientError',
        code: 'ORD-003',
        status: 422,
        userMessageKey: 'error.order.insufficient_position',
        operatorCode: 'INSUFFICIENT_POSITION',
      }),
    );
    const user = userEvent.setup();

    render(<OrderPage />);

    await user.click(screen.getByTestId('order-session-create'));

    expect(await screen.findByTestId('order-input-qty-error')).toHaveTextContent(
      '보유 수량을 다시 확인해 주세요.',
    );
    expect(screen.getByTestId('external-order-feedback')).toHaveTextContent(
      '보유 수량을 확인한 뒤 수량을 조정해 주세요.',
    );
    expect(screen.getByTestId('order-session-error-category')).toHaveTextContent('검증');
    expect(screen.queryByTestId('order-session-error')).not.toBeInTheDocument();
  });

  it('prefers machine-readable daily-sell-limit semantics for quantity guidance', async () => {
    vi.mocked(createOrderSession).mockRejectedValue(
      Object.assign(new Error('Daily sell limit exceeded'), {
        name: 'ApiClientError',
        code: 'ORD-005',
        status: 422,
        userMessageKey: 'error.order.daily_sell_limit_exceeded',
        operatorCode: 'DAILY_SELL_LIMIT_EXCEEDED',
      }),
    );
    const user = userEvent.setup();

    render(<OrderPage />);

    await user.click(screen.getByTestId('order-session-create'));

    expect(await screen.findByTestId('order-input-qty-error')).toHaveTextContent(
      '일일 매도 가능 한도를 초과했습니다.',
    );
    expect(screen.getByTestId('external-order-feedback')).toHaveTextContent(
      '일일 매도 가능 한도를 확인한 뒤 수량을 조정해 주세요.',
    );
    expect(screen.getByTestId('order-session-error-category')).toHaveTextContent('검증');
    expect(screen.queryByTestId('order-session-error')).not.toBeInTheDocument();
  });

  it('shows account-level guidance for insufficient cash without pinning the quantity field', async () => {
    vi.mocked(createOrderSession).mockRejectedValue(
      Object.assign(new Error('available cash is insufficient'), {
        name: 'ApiClientError',
        code: 'ORD-006',
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
    expect(screen.getByTestId('order-session-error-category')).toHaveTextContent('검증');
    expect(screen.queryByTestId('order-input-qty-error')).not.toBeInTheDocument();
  });

  it('does not classify uncoded create failures from message text alone', async () => {
    vi.mocked(createOrderSession).mockRejectedValue(
      Object.assign(new Error('available cash is insufficient'), {
        name: 'ApiClientError',
        status: 422,
      }),
    );
    const user = userEvent.setup();

    render(<OrderPage />);

    await user.click(screen.getByTestId('order-session-create'));

    expect(await screen.findByTestId('order-session-error')).toHaveTextContent(
      'available cash is insufficient',
    );
    expect(screen.queryByTestId('order-session-error-category')).not.toBeInTheDocument();
    expect(screen.queryByTestId('external-order-feedback')).not.toBeInTheDocument();
    expect(screen.queryByTestId('order-input-qty-error')).not.toBeInTheDocument();
  });

  it('keeps the user in Step A with stale-quote guidance for market prepare rejects', async () => {
    vi.mocked(createOrderSession).mockRejectedValue(
      createNormalizedOrderApiError({
        code: 'VALIDATION-003',
        message: '시장가 주문에 사용할 시세가 오래되었습니다.',
        status: 400,
        operatorCode: 'STALE_QUOTE',
        userMessageKey: 'error.quote.stale',
        details: {
          symbol: '005930',
          quoteSnapshotId: 'qsnap-replay-001',
          quoteSourceMode: 'REPLAY',
          snapshotAgeMs: 65000,
        },
      }),
    );
    const user = userEvent.setup();

    render(<OrderPage />);

    await user.click(screen.getByTestId('external-order-preset-krx-market-buy-3'));
    await user.click(screen.getByTestId('order-session-create'));

    expect(createOrderSession).toHaveBeenCalledWith(
      expect.objectContaining({
        orderType: 'MARKET',
        price: null,
      }),
    );
    expect(await screen.findByTestId('order-session-error-category')).toHaveTextContent('검증');
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
  });

  it('renders and refreshes the market-order live ticker while the market preset stays selected', async () => {
    vi.useFakeTimers();
    let unmount: (() => void) | undefined;

    try {
      vi.mocked(fetchAccountPosition)
        .mockResolvedValueOnce({
          accountId: 1,
          memberId: 1,
          symbol: '005930',
          quantity: 120,
          availableQuantity: 20,
          availableQty: 20,
          balance: 100_000_000,
          availableBalance: 100_000_000,
          currency: 'KRW',
          asOf: '2026-03-18T09:00:00Z',
          marketPrice: 70_100,
          quoteSnapshotId: 'quote-live-001',
          quoteAsOf: '2026-03-18T09:00:00Z',
          quoteSourceMode: 'LIVE',
        })
        .mockResolvedValue({
          accountId: 1,
          memberId: 1,
          symbol: '005930',
          quantity: 120,
          availableQuantity: 20,
          availableQty: 20,
          balance: 100_000_000,
          availableBalance: 100_000_000,
          currency: 'KRW',
          asOf: '2026-03-18T09:00:00Z',
          marketPrice: 70_300,
          quoteSnapshotId: 'quote-replay-001',
          quoteAsOf: '2026-03-18T09:05:00Z',
          quoteSourceMode: 'REPLAY',
        });
      ({ unmount } = render(<OrderPage />));

      fireEvent.click(screen.getByTestId('external-order-preset-krx-market-buy-3'));
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(fetchAccountPosition).toHaveBeenCalledWith({
        accountId: '1',
        symbol: '005930',
      });
      expect(screen.getByTestId('market-order-live-ticker-price')).toHaveTextContent('₩70,100');
      expect(screen.getByTestId('market-order-live-ticker-quote-as-of')).toHaveTextContent(
        quoteDateFormatter.format(new Date('2026-03-18T09:00:00Z')),
      );
      expect(screen.getByTestId('market-order-live-ticker-source-mode')).toHaveTextContent('LIVE');
      expect(screen.getByTestId('market-order-live-ticker-status')).toHaveTextContent(
        '5초마다 자동 갱신',
      );

      await act(async () => {
        await vi.advanceTimersByTimeAsync(5_000);
      });

      expect(fetchAccountPosition).toHaveBeenCalledTimes(2);
      expect(screen.getByTestId('market-order-live-ticker-price')).toHaveTextContent('₩70,300');
      expect(screen.getByTestId('market-order-live-ticker-quote-as-of')).toHaveTextContent(
        quoteDateFormatter.format(new Date('2026-03-18T09:05:00Z')),
      );
      expect(screen.getByTestId('market-order-live-ticker-source-mode')).toHaveTextContent(
        'REPLAY',
      );
    } finally {
      unmount?.();
      vi.runOnlyPendingTimers();
      vi.useRealTimers();
    }
  });

  it('keeps manually entered 3-share drafts on the limit path', async () => {
    vi.mocked(createOrderSession).mockResolvedValue({
      orderSessionId: 'sess-limit-3',
      clOrdId: 'cl-limit-3',
      status: 'AUTHED',
      challengeRequired: false,
      authorizationReason: 'TRUSTED_AUTH_SESSION',
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

    await user.clear(screen.getByTestId('order-input-qty'));
    await user.type(screen.getByTestId('order-input-qty'), '3');

    expect(screen.getByTestId('order-session-selected-summary')).toHaveTextContent(
      '005930 · 삼성전자 · 3주',
    );
    expect(screen.getByTestId('order-session-selected-summary')).not.toHaveTextContent('시장가');

    await user.click(screen.getByTestId('order-session-create'));

    expect(createOrderSession).toHaveBeenCalledWith(
      expect.objectContaining({
        orderType: 'LIMIT',
        quantity: 3,
        price: 70100,
      }),
    );
  });

  it('drops back to the limit path after editing away from the market preset value', async () => {
    vi.mocked(createOrderSession).mockResolvedValue({
      orderSessionId: 'sess-limit-4',
      clOrdId: 'cl-limit-4',
      status: 'AUTHED',
      challengeRequired: false,
      authorizationReason: 'TRUSTED_AUTH_SESSION',
      accountId: 1,
      symbol: '005930',
      side: 'BUY',
      orderType: 'LIMIT',
      qty: 4,
      price: 70100,
      expiresAt: futureIso(),
    });
    const user = userEvent.setup();

    render(<OrderPage />);

    await user.click(screen.getByTestId('external-order-preset-krx-market-buy-3'));
    await user.clear(screen.getByTestId('order-input-qty'));
    await user.type(screen.getByTestId('order-input-qty'), '4');

    expect(screen.getByTestId('order-session-selected-summary')).toHaveTextContent(
      '005930 · 삼성전자 · 4주',
    );
    expect(screen.getByTestId('order-session-selected-summary')).not.toHaveTextContent('시장가');

    await user.click(screen.getByTestId('order-session-create'));

    expect(createOrderSession).toHaveBeenCalledWith(
      expect.objectContaining({
        orderType: 'LIMIT',
        quantity: 4,
        price: 70100,
      }),
    );
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
    expect(screen.getByTestId('order-session-error-category')).toHaveTextContent('내부');
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
    expect(screen.getByTestId('order-session-reset')).toHaveTextContent('새 주문 시작');
    expect(screen.queryByTestId('order-session-execute')).not.toBeInTheDocument();
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
    expect(screen.getByTestId('order-session-reset')).toHaveTextContent('새 주문 시작');
    expect(screen.queryByTestId('order-session-execute')).not.toBeInTheDocument();
  });

  it.each([
    {
      name: 'REQUERYING',
      restoredSession: {
        orderSessionId: 'sess-restore-requery-reset',
        clOrdId: 'cl-restore-requery-reset',
        status: 'REQUERYING' as const,
        challengeRequired: false,
        authorizationReason: 'TRUSTED_AUTH_SESSION' as const,
        accountId: 1,
        symbol: '005930',
        side: 'BUY' as const,
        orderType: 'LIMIT' as const,
        qty: 2,
        price: 70100,
        expiresAt: null,
      },
      stalePollResult: {
        orderSessionId: 'sess-restore-requery-reset',
        clOrdId: 'cl-restore-requery-reset',
        status: 'COMPLETED' as const,
        challengeRequired: false,
        authorizationReason: 'TRUSTED_AUTH_SESSION' as const,
        accountId: 1,
        symbol: '005930',
        side: 'BUY' as const,
        orderType: 'LIMIT' as const,
        qty: 2,
        price: 70100,
        executionResult: 'FILLED' as const,
        executedPrice: 70100,
        expiresAt: null,
      },
      visibleStateTestId: 'order-session-processing',
    },
    {
      name: 'ESCALATED',
      restoredSession: {
        orderSessionId: 'sess-restore-escalated-reset',
        clOrdId: 'cl-restore-escalated-reset',
        status: 'ESCALATED' as const,
        challengeRequired: false,
        authorizationReason: 'TRUSTED_AUTH_SESSION' as const,
        accountId: 1,
        symbol: '005930',
        side: 'BUY' as const,
        orderType: 'LIMIT' as const,
        qty: 2,
        price: 70100,
        failureReason: 'ESCALATED_MANUAL_REVIEW' as const,
        expiresAt: null,
      },
      stalePollResult: {
        orderSessionId: 'sess-restore-escalated-reset',
        clOrdId: 'cl-restore-escalated-reset',
        status: 'COMPLETED' as const,
        challengeRequired: false,
        authorizationReason: 'TRUSTED_AUTH_SESSION' as const,
        accountId: 1,
        symbol: '005930',
        side: 'BUY' as const,
        orderType: 'LIMIT' as const,
        qty: 2,
        price: 70100,
        executionResult: 'FILLED' as const,
        executedPrice: 70100,
        expiresAt: null,
      },
      visibleStateTestId: 'order-session-manual-review',
    },
  ])(
    'ignores a stale %s poll result after the user starts a fresh order from a restored session',
    async ({ restoredSession, stalePollResult, visibleStateTestId }) => {
      window.sessionStorage.setItem(
        'fixyz.order-session-id:1',
        restoredSession.orderSessionId,
      );
      const stalePollDeferred = createDeferred<Awaited<ReturnType<typeof getOrderSession>>>();
      vi.mocked(getOrderSession)
        .mockResolvedValueOnce(restoredSession)
        .mockImplementationOnce(() => stalePollDeferred.promise);
      const user = userEvent.setup();

      render(<OrderPage />);

      expect(await screen.findByTestId(visibleStateTestId)).toBeInTheDocument();
      expect(getOrderSession).toHaveBeenCalledWith(restoredSession.orderSessionId);

      await user.click(screen.getByTestId('order-session-reset'));

      expect(screen.getByTestId('order-session-create')).toBeInTheDocument();
      expect(window.sessionStorage.getItem('fixyz.order-session-id:1')).toBeNull();
      expect(screen.getByTestId('order-input-symbol')).toHaveValue(restoredSession.symbol);
      expect(screen.getByTestId('order-input-qty')).toHaveValue(String(restoredSession.qty));
      expect(screen.getByTestId('order-session-selected-summary')).toHaveTextContent(
        restoredSession.symbol,
      );
      expect(screen.getByTestId('order-session-selected-summary')).toHaveTextContent(
        `${restoredSession.qty}주`,
      );
      expect(screen.queryByTestId(visibleStateTestId)).not.toBeInTheDocument();
      expect(screen.queryByTestId('order-session-summary')).not.toBeInTheDocument();
      expect(screen.queryByTestId('external-order-feedback')).not.toBeInTheDocument();

      await act(async () => {
        stalePollDeferred.resolve(stalePollResult);
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(screen.getByTestId('order-session-create')).toBeInTheDocument();
      expect(screen.getByTestId('order-input-symbol')).toHaveValue(restoredSession.symbol);
      expect(screen.getByTestId('order-input-qty')).toHaveValue(String(restoredSession.qty));
      expect(screen.queryByTestId(visibleStateTestId)).not.toBeInTheDocument();
      expect(screen.queryByTestId('order-session-result')).not.toBeInTheDocument();
      expect(screen.queryByTestId('order-session-summary')).not.toBeInTheDocument();
      expect(screen.queryByTestId('external-order-feedback')).not.toBeInTheDocument();
    },
  );

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
    positionQuantityVisible,
    positionQuantityLabel,
    updatedPositionQuantity,
    updatedPositionQuantityLabel,
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
    vi.mocked(fetchAccountPosition).mockResolvedValue({
      accountId: 1,
      memberId: 1,
      symbol: '005930',
      quantity: updatedPositionQuantity ?? 120,
      availableQuantity: 20,
      availableQty: 20,
      balance: 100_000_000,
      availableBalance: 100_000_000,
      currency: 'KRW',
      asOf: '2026-03-18T09:00:00Z',
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

    if (positionQuantityVisible && updatedPositionQuantityLabel) {
      expect(await screen.findByTestId('order-result-position-qty')).toHaveTextContent(
        `${positionQuantityLabel} · ${updatedPositionQuantityLabel}`,
      );
      expect(fetchAccountPosition).toHaveBeenCalledWith({
        accountId: '1',
        symbol: '005930',
      });
    } else {
      expect(screen.queryByTestId('order-result-position-qty')).not.toBeInTheDocument();
      expect(fetchAccountPosition).not.toHaveBeenCalled();
    }
  });

  it('shows a fallback message when refreshed position inquiry fails after a filled result', async () => {
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
      status: 'COMPLETED',
      executionResult: 'FILLED',
    });
    vi.mocked(fetchAccountPosition).mockRejectedValue(new Error('downstream unavailable'));
    const user = userEvent.setup();

    render(<OrderPage />);

    await user.click(screen.getByTestId('order-session-create'));
    await user.click(await screen.findByTestId('order-session-execute'));

    expect(await screen.findByTestId('order-result-position-qty-message')).toHaveTextContent(
      '현재 보유 수량을 불러오지 못했습니다. 잠시 후 다시 확인해 주세요.',
    );
    expect(screen.queryByTestId('order-result-position-qty')).not.toBeInTheDocument();
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

  it('restores a 3-share limit session without relabeling it as market', async () => {
    window.sessionStorage.setItem('fixyz.order-session-id:1', 'sess-restore-limit-3');
    vi.mocked(getOrderSession).mockResolvedValue({
      orderSessionId: 'sess-restore-limit-3',
      clOrdId: 'cl-restore-limit-3',
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

    render(<OrderPage />);

    expect(await screen.findByTestId('order-session-otp-input')).toBeInTheDocument();
    expect(screen.getByTestId('order-session-selected-summary')).toHaveTextContent(
      '005930 · 삼성전자 · 3주',
    );
    expect(screen.getByTestId('order-session-selected-summary')).not.toHaveTextContent('시장가');
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
