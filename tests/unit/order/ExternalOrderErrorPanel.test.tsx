import { render, screen } from '@testing-library/react';

import { ExternalOrderErrorPanel } from '@/components/order/ExternalOrderErrorPanel';

describe('ExternalOrderErrorPanel', () => {
  it('renders support reference details for unknown external states', () => {
    render(
      <ExternalOrderErrorPanel
        presentation={{
          code: 'FEP-999',
          semantic: 'unknown-state',
          recoveryAction: 'contact-support',
          severity: 'warning',
          title: '주문 상태 확인이 더 필요합니다',
          message: '주문 결과가 아직 확정되지 않았습니다. 완료로 간주하지 말고 알림을 기다려 주세요.',
          nextStep: '안내가 계속 바뀌지 않으면 문의 코드와 함께 고객센터에 연락해 주세요.',
          traceId: 'trace-unknown-001',
          supportReference: '문의 코드: trace-unknown-001',
        }}
      />,
    );

    expect(screen.getByTestId('external-order-error-title')).toHaveTextContent(
      '주문 상태 확인이 더 필요합니다',
    );
    expect(screen.getByTestId('external-order-error-next-step')).toHaveTextContent(
      '문의 코드와 함께 고객센터에 연락해 주세요.',
    );
    expect(screen.getByTestId('external-order-error-support-reference')).toHaveTextContent(
      '문의 코드: trace-unknown-001',
    );
  });
});
