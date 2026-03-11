import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

import {
  fetchAccountOrderHistory,
  fetchAccountPositions,
  fetchAccountSummary,
} from '@/api/accountApi';
import { PortfolioPage } from '@/pages/PortfolioPage';
import { resetAuthStore, useAuthStore } from '@/store/useAuthStore';
import type { AccountOrderHistoryPage, AccountPosition } from '@/types/account';
import type { Member } from '@/types/auth';

vi.mock('@/api/accountApi', () => ({
  fetchAccountOrderHistory: vi.fn(),
  fetchAccountPositions: vi.fn(),
  fetchAccountSummary: vi.fn(),
}));

const memberFixture: Member = {
  memberUuid: 'member-001',
  email: 'demo@fix.com',
  name: 'Demo User',
  role: 'ROLE_USER',
  totpEnrolled: true,
  accountId: '110123456789',
};

const positionsFixture: AccountPosition[] = [
  {
    accountId: 1,
    memberId: 1,
    symbol: '005930',
    quantity: 120,
    availableQuantity: 20,
    availableQty: 20,
    balance: 100_000_000,
    availableBalance: 100_000_000,
    currency: 'KRW',
    asOf: '2026-03-11T09:10:00Z',
  },
  {
    accountId: 1,
    memberId: 1,
    symbol: '000660',
    quantity: 15,
    availableQuantity: 7,
    availableQty: 7,
    balance: 98_500_000,
    availableBalance: 98_500_000,
    currency: 'KRW',
    asOf: '2026-03-11T09:20:00Z',
  },
];

const createHistoryPage = (
  overrides?: Partial<AccountOrderHistoryPage>,
): AccountOrderHistoryPage => ({
  content: [
    {
      symbol: '005930',
      symbolName: '삼성전자',
      side: 'BUY',
      qty: 3,
      unitPrice: 70_100,
      totalAmount: 210_300,
      status: 'FILLED',
      clOrdId: 'cl-001',
      createdAt: '2026-03-11T09:00:00Z',
    },
  ],
  totalElements: 6,
  totalPages: 2,
  number: 0,
  size: 10,
  ...overrides,
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

describe('PortfolioPage', () => {
  beforeEach(() => {
    resetAuthStore();
    useAuthStore.setState({ member: memberFixture, status: 'authenticated' });
    vi.mocked(fetchAccountSummary).mockReset();
    vi.mocked(fetchAccountPositions).mockReset();
    vi.mocked(fetchAccountOrderHistory).mockReset();
    vi.mocked(fetchAccountSummary).mockResolvedValue({
      accountId: 1,
      memberId: 1,
      symbol: '',
      quantity: 0,
      availableQuantity: 0,
      availableQty: 0,
      balance: 100_000_000,
      availableBalance: 100_000_000,
      currency: 'KRW',
      asOf: '2026-03-11T09:05:00Z',
    });
    vi.mocked(fetchAccountPositions).mockResolvedValue(positionsFixture);
    vi.mocked(fetchAccountOrderHistory).mockResolvedValue(createHistoryPage());
  });

  it('renders the masked account summary and keeps the dedicated order boundary link', async () => {
    render(
      <MemoryRouter>
        <PortfolioPage />
      </MemoryRouter>,
    );

    expect(screen.getByTestId('portfolio-demo-order')).toHaveAttribute('href', '/orders');
    expect(await screen.findByTestId('portfolio-total-balance')).toHaveTextContent(
      '₩100,000,000',
    );
    expect(screen.getByTestId('portfolio-masked-account')).toHaveTextContent(
      '110-****-6789',
    );
    expect(screen.getByTestId('portfolio-symbol-005930')).toBeInTheDocument();
    expect(screen.getByTestId('portfolio-symbol-000660')).toBeInTheDocument();
    expect(screen.queryByTestId('external-order-recovery-submit')).not.toBeInTheDocument();
  });

  it('switches the selected owned position and re-queries history when the page size or page changes', async () => {
    const user = userEvent.setup();

    vi.mocked(fetchAccountOrderHistory)
      .mockResolvedValueOnce(createHistoryPage())
      .mockResolvedValueOnce(
        createHistoryPage({
          content: [
            {
              symbol: '000660',
              symbolName: 'SK하이닉스',
              side: 'SELL',
              qty: 2,
              unitPrice: 120_000,
              totalAmount: 240_000,
              status: 'CANCELED',
              clOrdId: 'cl-002',
              createdAt: '2026-03-11T09:30:00Z',
            },
          ],
          size: 20,
          totalPages: 3,
        }),
      )
      .mockResolvedValueOnce(
        createHistoryPage({
          content: [
            {
              symbol: '005935',
              symbolName: '삼성전자우',
              side: 'BUY',
              qty: 1,
              unitPrice: 50_000,
              totalAmount: 50_000,
              status: 'FAILED',
              clOrdId: 'cl-003',
              createdAt: '2026-03-11T10:00:00Z',
            },
          ],
          number: 1,
          size: 20,
          totalPages: 3,
        }),
      );

    render(
      <MemoryRouter>
        <PortfolioPage />
      </MemoryRouter>,
    );

    expect(await screen.findByTestId('portfolio-available-quantity')).toHaveTextContent(
      '20주',
    );

    await user.click(screen.getByTestId('portfolio-symbol-000660'));
    expect(await screen.findByTestId('portfolio-available-quantity')).toHaveTextContent('7주');

    await user.click(screen.getByTestId('portfolio-tab-history'));
    expect(await screen.findByTestId('order-row-cl-001')).toBeInTheDocument();
    expect(screen.getByTestId('order-cl-ord-id-cl-001')).toHaveTextContent('cl-001');

    await user.click(screen.getByTestId('portfolio-history-size-20'));
    expect(await screen.findByTestId('order-row-cl-002')).toBeInTheDocument();

    await user.click(screen.getByTestId('portfolio-history-next'));
    expect(await screen.findByTestId('order-row-cl-003')).toBeInTheDocument();

    expect(fetchAccountPositions).toHaveBeenCalledWith({
      accountId: '110123456789',
    });
    expect(fetchAccountSummary).toHaveBeenCalledWith({
      accountId: '110123456789',
    });
    expect(fetchAccountOrderHistory).toHaveBeenNthCalledWith(1, {
      accountId: '110123456789',
      page: 0,
      size: 10,
    });
    expect(fetchAccountOrderHistory).toHaveBeenNthCalledWith(2, {
      accountId: '110123456789',
      page: 0,
      size: 20,
    });
    expect(fetchAccountOrderHistory).toHaveBeenNthCalledWith(3, {
      accountId: '110123456789',
      page: 1,
      size: 20,
    });
  });

  it('ignores stale history responses after the linked account changes', async () => {
    const user = userEvent.setup();
    const firstRequest = createDeferred<AccountOrderHistoryPage>();
    const secondRequest = createDeferred<AccountOrderHistoryPage>();

    vi.mocked(fetchAccountOrderHistory)
      .mockReturnValueOnce(firstRequest.promise)
      .mockReturnValueOnce(secondRequest.promise);

    render(
      <MemoryRouter>
        <PortfolioPage />
      </MemoryRouter>,
    );

    await user.click(screen.getByTestId('portfolio-tab-history'));

    act(() => {
      useAuthStore.setState({
        member: {
          ...memberFixture,
          accountId: '220123456789',
        },
        status: 'authenticated',
      });
    });

    await act(async () => {
      secondRequest.resolve(
        createHistoryPage({
          content: [
            {
              symbol: '000660',
              symbolName: 'SK하이닉스',
              side: 'SELL',
              qty: 2,
              unitPrice: 120_000,
              totalAmount: 240_000,
              status: 'CANCELED',
              clOrdId: 'cl-fast',
              createdAt: '2026-03-11T10:30:00Z',
            },
          ],
        }),
      );
      await Promise.resolve();
    });

    expect(await screen.findByTestId('order-row-cl-fast')).toBeInTheDocument();

    await act(async () => {
      firstRequest.resolve(
        createHistoryPage({
          content: [
            {
              symbol: '005930',
              symbolName: '삼성전자',
              side: 'BUY',
              qty: 9,
              unitPrice: 71_000,
              totalAmount: 639_000,
              status: 'FILLED',
              clOrdId: 'cl-slow',
              createdAt: '2026-03-11T10:00:00Z',
            },
          ],
        }),
      );
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(screen.queryByTestId('order-row-cl-slow')).not.toBeInTheDocument();
    });
    expect(fetchAccountOrderHistory).toHaveBeenCalledWith({
      accountId: '220123456789',
      page: 0,
      size: 10,
    });
  });

  it('restarts history pagination from page 0 on every account switch, including returning to a prior account', async () => {
    const user = userEvent.setup();

    vi.mocked(fetchAccountOrderHistory)
      .mockResolvedValueOnce(createHistoryPage())
      .mockResolvedValueOnce(
        createHistoryPage({
          number: 1,
          totalPages: 3,
          content: [
            {
              symbol: '005930',
              symbolName: '삼성전자',
              side: 'BUY',
              qty: 1,
              unitPrice: 70_000,
              totalAmount: 70_000,
              status: 'FILLED',
              clOrdId: 'cl-page-1',
              createdAt: '2026-03-11T09:10:00Z',
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        createHistoryPage({
          content: [
            {
              symbol: '000660',
              symbolName: 'SK하이닉스',
              side: 'SELL',
              qty: 2,
              unitPrice: 120_000,
              totalAmount: 240_000,
              status: 'CANCELED',
              clOrdId: 'cl-account-b',
              createdAt: '2026-03-11T09:20:00Z',
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        createHistoryPage({
          content: [
            {
              symbol: '005930',
              symbolName: '삼성전자',
              side: 'BUY',
              qty: 4,
              unitPrice: 71_000,
              totalAmount: 284_000,
              status: 'FILLED',
              clOrdId: 'cl-account-a-reset',
              createdAt: '2026-03-11T09:30:00Z',
            },
          ],
        }),
      );

    render(
      <MemoryRouter>
        <PortfolioPage />
      </MemoryRouter>,
    );

    await user.click(screen.getByTestId('portfolio-tab-history'));
    expect(await screen.findByTestId('order-row-cl-001')).toBeInTheDocument();

    await user.click(screen.getByTestId('portfolio-history-next'));
    expect(await screen.findByTestId('order-row-cl-page-1')).toBeInTheDocument();

    act(() => {
      useAuthStore.setState({
        member: {
          ...memberFixture,
          accountId: '220123456789',
        },
        status: 'authenticated',
      });
    });

    expect(await screen.findByTestId('order-row-cl-account-b')).toBeInTheDocument();

    act(() => {
      useAuthStore.setState({
        member: {
          ...memberFixture,
          accountId: '110123456789',
        },
        status: 'authenticated',
      });
    });

    expect(await screen.findByTestId('order-row-cl-account-a-reset')).toBeInTheDocument();
    expect(fetchAccountOrderHistory).toHaveBeenNthCalledWith(4, {
      accountId: '110123456789',
      page: 0,
      size: 10,
    });
  });

  it('keeps the balance summary visible for cash-only accounts with no owned positions', async () => {
    vi.mocked(fetchAccountPositions).mockResolvedValue([]);
    vi.mocked(fetchAccountSummary).mockResolvedValue({
      accountId: 1,
      memberId: 1,
      symbol: '',
      quantity: 0,
      availableQuantity: 0,
      availableQty: 0,
      balance: 75_000_000,
      availableBalance: 75_000_000,
      currency: 'KRW',
      asOf: '2026-03-11T09:00:00Z',
    });

    render(
      <MemoryRouter>
        <PortfolioPage />
      </MemoryRouter>,
    );

    expect(await screen.findByTestId('portfolio-total-balance')).toHaveTextContent(
      '₩75,000,000',
    );
    expect(screen.getByTestId('portfolio-available-quantity')).toHaveTextContent('0주');
    expect(screen.getByTestId('portfolio-symbol-empty')).toHaveTextContent(
      '아직 보유 중인 종목이 없습니다.',
    );
    expect(screen.queryByTestId('portfolio-summary-empty')).not.toBeInTheDocument();
  });

  it('shows standardized retry guidance when history loading fails', async () => {
    const user = userEvent.setup();

    vi.mocked(fetchAccountOrderHistory).mockRejectedValue(new Error('order history failed'));

    render(
      <MemoryRouter>
        <PortfolioPage />
      </MemoryRouter>,
    );

    await user.click(screen.getByTestId('portfolio-tab-history'));

    expect(await screen.findByTestId('portfolio-history-error')).toHaveTextContent(
      'order history failed',
    );
    expect(screen.getByTestId('portfolio-history-error')).toHaveTextContent(
      '페이지를 새로고침한 뒤 다시 시도해 주세요. 문제가 계속되면 고객센터에 문의해 주세요.',
    );
  });

  it('keeps the order boundary unavailable when the authenticated member has no linked order account', () => {
    useAuthStore.setState({
      member: {
        ...memberFixture,
        accountId: undefined,
      },
      status: 'authenticated',
    });

    render(
      <MemoryRouter>
        <PortfolioPage />
      </MemoryRouter>,
    );

    expect(screen.queryByTestId('portfolio-demo-order')).not.toBeInTheDocument();
    expect(screen.getByTestId('portfolio-demo-order-unavailable')).toBeDisabled();
  });

  it('shows unavailable account states and disables history controls when no linked account exists', async () => {
    const user = userEvent.setup();

    useAuthStore.setState({
      member: {
        ...memberFixture,
        accountId: undefined,
      },
      status: 'authenticated',
    });

    render(
      <MemoryRouter>
        <PortfolioPage />
      </MemoryRouter>,
    );

    expect(screen.getByTestId('portfolio-summary-unavailable')).toHaveTextContent(
      '연결된 계좌가 없어 계좌 요약을 불러올 수 없습니다.',
    );
    expect(screen.getByTestId('portfolio-symbol-unavailable')).toHaveTextContent(
      '연결된 계좌가 없어 보유 종목 리스트를 불러올 수 없습니다.',
    );

    await user.click(screen.getByTestId('portfolio-tab-history'));

    expect(screen.getByTestId('portfolio-history-unavailable')).toHaveTextContent(
      '연결된 계좌가 없어 주문 내역을 조회할 수 없습니다.',
    );
    expect(screen.queryByTestId('portfolio-history-loading')).not.toBeInTheDocument();
    expect(screen.getByTestId('portfolio-history-size-5')).toBeDisabled();
    expect(screen.getByTestId('portfolio-history-prev')).toBeDisabled();
    expect(screen.getByTestId('portfolio-history-next')).toBeDisabled();
  });
});
