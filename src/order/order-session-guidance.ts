import type {
  OrderAuthorizationReason,
  OrderSessionResponse,
  OrderSessionStatus,
} from '@/types/order';

type FinalResultSession = Pick<
  OrderSessionResponse,
  'status' | 'failureReason' | 'executionResult'
>;

export const resolveOrderAuthorizationGuidance = (
  reason?: OrderAuthorizationReason | null,
) => {
  if (reason === 'RECENT_LOGIN_MFA' || reason === 'TRUSTED_AUTH_SESSION') {
    return '현재 인증 세션이 신뢰되어 추가 OTP 없이 바로 주문을 실행할 수 있습니다.';
  }

  return '고위험 주문으로 분류되어 주문 실행 전에 OTP 인증을 완료해야 합니다.';
};

export const resolveOrderProcessingContent = (status?: OrderSessionStatus | null) => {
  if (status === 'EXECUTING') {
    return {
      title: '주문을 거래소에 전송했어요',
      body: '체결 결과가 아직 확정되지 않았습니다. 잠시 후 상태가 자동으로 갱신됩니다.',
    };
  }

  if (status === 'REQUERYING') {
    return {
      title: '주문 체결 결과를 다시 확인하고 있어요',
      body: '체결 결과를 재조회하는 중입니다. 완료로 간주하지 말고 상태가 바뀔 때까지 기다려 주세요.',
    };
  }

  if (status === 'ESCALATED') {
    return {
      title: '수동 확인이 필요합니다.',
      body: '처리 중 문제가 발생해 수동 확인이 필요합니다. 주문 번호를 확인한 뒤 고객센터에 문의해 주세요.',
    };
  }

  return null;
};

export const resolveOrderFinalResultContent = (
  session: FinalResultSession,
) => {
  if (session.status === 'FAILED') {
    if (session.failureReason === 'OTP_EXCEEDED') {
      return {
        title: '주문 인증에 실패했습니다',
        body: 'OTP 시도 횟수를 초과했습니다. 주문을 다시 시작해 주세요.',
      };
    }

    return {
      title: '주문이 실패했습니다',
      body: '실패 사유를 확인한 뒤 주문 조건을 조정해 다시 시도해 주세요.',
    };
  }

  if (session.status === 'CANCELED') {
    if (session.executionResult === 'PARTIAL_FILL_CANCEL') {
      return {
        title: '일부 체결 후 나머지 수량이 취소되었습니다',
        body: '체결된 수량과 취소된 잔여 수량을 함께 확인해 주세요.',
      };
    }

    return {
      title: '주문이 취소되었습니다',
      body: '취소 결과를 확인한 뒤 필요하면 새 주문을 시작해 주세요.',
    };
  }

  if (session.executionResult === 'PARTIAL_FILL') {
    return {
      title: '주문이 일부 체결되었습니다',
      body: '체결 수량과 남은 수량을 확인한 뒤 필요하면 새 주문을 시작해 주세요.',
    };
  }

  if (session.executionResult === 'VIRTUAL_FILL') {
    return {
      title: '주문이 승인 처리되었습니다',
      body: '주문 결과 요약을 확인해 주세요.',
    };
  }

  return {
    title: '주문이 체결되었습니다',
    body: '주문 결과 요약을 확인해 주세요.',
  };
};
