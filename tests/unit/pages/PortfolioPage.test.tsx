import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import { PortfolioPage } from '@/pages/PortfolioPage';
import { resetAuthStore, useAuthStore } from '@/store/useAuthStore';
import type { Member } from '@/types/auth';

const memberFixture: Member = {
  memberUuid: 'member-001',
  email: 'demo@fix.com',
  name: 'Demo User',
  role: 'ROLE_USER',
  totpEnrolled: true,
  accountId: '1',
};

describe('PortfolioPage', () => {
  beforeEach(() => {
    resetAuthStore();
    useAuthStore.setState({ member: memberFixture, status: 'authenticated' });
  });

  it('links to the dedicated order boundary instead of rendering recovery controls inline', () => {
    render(
      <MemoryRouter>
        <PortfolioPage />
      </MemoryRouter>,
    );

    expect(screen.getByTestId('portfolio-demo-order')).toHaveAttribute('href', '/orders');
    expect(screen.queryByTestId('external-order-recovery-submit')).not.toBeInTheDocument();
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
});
