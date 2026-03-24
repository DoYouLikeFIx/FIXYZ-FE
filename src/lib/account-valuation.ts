import type {
  AccountPosition,
  ValuationStatus,
  ValuationUnavailableReason,
} from '@/types/account';

export const VALUATION_UNAVAILABLE_LABEL = '확인 불가';
export const VALUATION_STATUS_PENDING_LABEL = '상태 확인 필요';

export const isFreshValuationStatus = (
  status: ValuationStatus | null | undefined,
) => status === 'FRESH';

export const resolveValuationStatus = (
  position: Partial<AccountPosition> | null | undefined,
): ValuationStatus | null => {
  const explicitStatus = typeof position?.valuationStatus === 'string'
    ? position.valuationStatus.trim()
    : '';

  if (explicitStatus) {
    return explicitStatus as ValuationStatus;
  }

  return null;
};

export const resolveValuationStatusLabel = (
  status: ValuationStatus | null | undefined,
) => {
  switch (status) {
    case 'FRESH':
      return '평가 가능';
    case 'STALE':
      return '시세 지연';
    case 'UNAVAILABLE':
      return '평가 불가';
    default:
      return VALUATION_STATUS_PENDING_LABEL;
  }
};

export const resolveValuationGuidance = (
  status: ValuationStatus | null | undefined,
  reason: ValuationUnavailableReason | null | undefined,
) => {
  switch (status) {
    case 'FRESH':
      return null;
    case 'STALE':
      return '호가 기준이 오래되어 평가 손익을 숨겼습니다.';
    case 'UNAVAILABLE':
      switch (reason) {
        case 'QUOTE_MISSING':
          return '시세 스냅샷이 없어 평가 손익을 숨겼습니다.';
        case 'PROVIDER_UNAVAILABLE':
          return '시세 제공자가 응답하지 않아 평가 손익을 숨겼습니다.';
        default:
          return '시세를 확인할 수 없어 평가 손익을 숨겼습니다.';
      }
    default:
      return status
        ? '백엔드 freshness 상태를 확인할 수 없어 평가 정보를 보수적으로 표시합니다.'
        : null;
  }
};
