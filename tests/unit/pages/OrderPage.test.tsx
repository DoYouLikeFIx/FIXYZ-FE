import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { submitExternalOrder } from '@/api/orderApi';
import { OrderPage } from '@/pages/OrderPage';
import { resetAuthStore, useAuthStore } from '@/store/useAuthStore';
import type { Member } from '@/types/auth';

vi.mock('@/api/orderApi', () => ({
  submitExternalOrder: vi.fn(),
}));

const memberFixture: Member = {
  memberUuid: 'member-001',
  email: 'demo@fix.com',
  name: 'Demo User',
  role: 'ROLE_USER',
  totpEnrolled: true,
  accountId: '1',
};

describe('OrderPage', () => {
  beforeEach(() => {
    resetAuthStore();
    useAuthStore.setState({ member: memberFixture, status: 'authenticated' });
    vi.mocked(submitExternalOrder).mockReset();
  });

  it('renders visible external guidance when the channel returns an FEP error', async () => {
    vi.mocked(submitExternalOrder).mockRejectedValue(
      Object.assign(new Error('pending confirmation'), {
        name: 'ApiClientError',
        code: 'FEP-002',
        message: '주문이 아직 확정되지 않았습니다. 체결 완료로 간주하지 말고 알림이나 주문 상태를 확인해 주세요.',
        traceId: 'trace-fep-002',
      }),
    );
    const user = userEvent.setup();

    render(<OrderPage />);

    await user.click(screen.getByTestId('external-order-recovery-submit'));

    expect(await screen.findByTestId('external-order-error-title')).toHaveTextContent(
      '주문 결과를 확인하고 있습니다',
    );
    expect(screen.getByTestId('external-order-error-support-reference')).toHaveTextContent(
      '문의 코드: trace-fep-002',
    );
  });

  it('shows inline feedback for non-external application errors', async () => {
    vi.mocked(submitExternalOrder).mockRejectedValue(
      Object.assign(new Error('입력 값을 다시 확인해 주세요.'), {
        name: 'ApiClientError',
        code: 'ORD-006',
        status: 400,
      }),
    );
    const user = userEvent.setup();

    render(<OrderPage />);

    await user.click(screen.getByTestId('external-order-recovery-submit'));

    expect(await screen.findByTestId('external-order-feedback')).toHaveTextContent(
      '입력 값을 다시 확인해 주세요.',
    );
    await waitFor(() => {
      expect(screen.queryByTestId('external-order-error-panel')).not.toBeInTheDocument();
    });
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
    expect(screen.queryByTestId('external-order-recovery-submit')).not.toBeInTheDocument();
  });
});
