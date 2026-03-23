import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

import {
  getPathname,
  installMockAxiosModule,
  successEnvelope,
} from '../fixtures/mockAxiosModule';

const quoteDateFormatter = new Intl.DateTimeFormat('ko-KR', {
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

describe.sequential('PortfolioPage quote freshness transport coverage', () => {
  afterEach(() => {
    cleanup();
    vi.doUnmock('axios');
    vi.restoreAllMocks();
  });

  it('renders delayed and replay quote freshness from the transport-backed account responses', async () => {
    await installMockAxiosModule((request) => {
      if (request.method === 'GET' && getPathname(request.url) === '/api/v1/accounts/1/summary') {
        return successEnvelope({
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
      }

      if (
        request.method === 'GET'
        && getPathname(request.url) === '/api/v1/accounts/1/positions/list'
      ) {
        return successEnvelope([
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
            marketPrice: 70_100,
            quoteSnapshotId: 'quote-delayed-001',
            quoteAsOf: '2026-03-11T09:09:00Z',
            quoteSourceMode: 'DELAYED',
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
            marketPrice: 203_000,
            quoteSnapshotId: 'quote-replay-001',
            quoteAsOf: '2026-03-11T09:19:00Z',
            quoteSourceMode: 'REPLAY',
          },
        ]);
      }

      throw new Error(`Unhandled request: ${request.method} ${request.url}`);
    });

    const authStore = await import('@/store/useAuthStore');
    const { PortfolioPage } = await import('@/pages/PortfolioPage');
    const user = userEvent.setup();

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

    render(
      <MemoryRouter>
        <PortfolioPage />
      </MemoryRouter>,
    );

    expect(await screen.findByTestId('portfolio-market-price')).toHaveTextContent('₩70,100');
    expect(screen.getByTestId('portfolio-quote-source-mode')).toHaveTextContent('DELAYED');
    expect(screen.getByTestId('portfolio-quote-as-of')).toHaveTextContent(
      quoteDateFormatter.format(new Date('2026-03-11T09:09:00Z')),
    );

    await user.click(screen.getByTestId('portfolio-symbol-000660'));

    expect(await screen.findByTestId('portfolio-market-price')).toHaveTextContent('₩203,000');
    expect(screen.getByTestId('portfolio-quote-source-mode')).toHaveTextContent('REPLAY');
    expect(screen.getByTestId('portfolio-quote-as-of')).toHaveTextContent(
      quoteDateFormatter.format(new Date('2026-03-11T09:19:00Z')),
    );
  });
});
