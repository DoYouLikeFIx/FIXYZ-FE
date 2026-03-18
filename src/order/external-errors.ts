import {
  DEFAULT_SERVER_ERROR_MESSAGE,
  NETWORK_ERROR_MESSAGE,
  TIMEOUT_ERROR_MESSAGE,
} from '@/lib/api-error-messages';
import type { NormalizedApiError } from '@/lib/axios';
import {
  getOrderReasonCategoryLabel,
  type OrderReasonCategory,
} from '@/order/order-error-category';

export const SUPPORT_REFERENCE_LABEL = '문의 코드';

type ExternalOrderErrorSemantic =
  | 'service-unavailable'
  | 'pending-confirmation'
  | 'exchange-rejected'
  | 'connection-interrupted'
  | 'unknown-state';

type ExternalOrderRecoveryAction =
  | 'retry-order'
  | 'wait-for-update'
  | 'review-order'
  | 'contact-support';

type ExternalOrderSeverity = 'info' | 'warning' | 'error';

interface ExternalOrderErrorTemplate {
  semantic: ExternalOrderErrorSemantic;
  recoveryAction: ExternalOrderRecoveryAction;
  severity: ExternalOrderSeverity;
  title: string;
  message: string;
  nextStep: string;
}

export interface ExternalOrderErrorPresentation {
  code?: string;
  operatorCode?: string;
  reasonCategory: OrderReasonCategory;
  reasonCategoryLabel: string;
  semantic: ExternalOrderErrorSemantic;
  recoveryAction: ExternalOrderRecoveryAction;
  severity: ExternalOrderSeverity;
  title: string;
  message: string;
  nextStep: string;
  traceId?: string;
  retryAfterSeconds?: number;
  supportReference?: string;
}

const TRANSPORT_MESSAGES = new Set([
  DEFAULT_SERVER_ERROR_MESSAGE,
  NETWORK_ERROR_MESSAGE,
  TIMEOUT_ERROR_MESSAGE,
]);

const FEP_001_RETRY_TEMPLATE: ExternalOrderErrorTemplate = {
  semantic: 'service-unavailable',
  recoveryAction: 'retry-order',
  severity: 'warning',
  title: '주문 서비스를 잠시 사용할 수 없습니다',
  message: '거래소 연결이 일시적으로 불안정합니다. 주문이 접수되지 않았을 수 있습니다.',
  nextStep: '잠시 후 다시 주문해 주세요.',
};

const FEP_001_CONTACT_TEMPLATE: ExternalOrderErrorTemplate = {
  semantic: 'service-unavailable',
  recoveryAction: 'contact-support',
  severity: 'warning',
  title: '주문 서비스를 점검하고 있습니다',
  message: '거래소 연결 점검이 필요합니다. 주문이 접수되지 않았을 수 있습니다.',
  nextStep: '잠시 후 다시 시도하고, 계속되면 고객센터에 문의해 주세요.',
};

const TEMPLATE_BY_CODE: Record<string, ExternalOrderErrorTemplate> = {
  'FEP-002': {
    semantic: 'pending-confirmation',
    recoveryAction: 'wait-for-update',
    severity: 'info',
    title: '주문 결과를 확인하고 있습니다',
    message:
      '주문이 아직 확정되지 않았습니다. 체결 완료로 간주하지 말고 알림이나 주문 상태를 확인해 주세요.',
    nextStep: '잠시 후 알림이 없으면 주문 내역을 다시 조회해 주세요.',
  },
  'FEP-003': {
    semantic: 'exchange-rejected',
    recoveryAction: 'review-order',
    severity: 'error',
    title: '거래소가 주문을 거절했습니다',
    message:
      '주문이 체결 완료로 처리되지 않았습니다. 주문 조건을 확인한 뒤 다시 시도해 주세요.',
    nextStep: '수량, 가격, 장 상태를 확인한 뒤 다시 주문해 주세요.',
  },
};

const TRANSPORT_TEMPLATE: ExternalOrderErrorTemplate = {
  semantic: 'connection-interrupted',
  recoveryAction: 'retry-order',
  severity: 'warning',
  title: '주문 요청을 다시 보내 주세요',
  message: '네트워크 연결이 불안정해 주문 요청을 확인하지 못했습니다.',
  nextStep: '연결 상태를 확인한 뒤 다시 주문해 주세요.',
};

const UNKNOWN_TEMPLATE: ExternalOrderErrorTemplate = {
  semantic: 'unknown-state',
  recoveryAction: 'contact-support',
  severity: 'warning',
  title: '주문 상태 확인이 더 필요합니다',
  message: '주문 결과가 아직 확정되지 않았습니다. 완료로 간주하지 말고 알림을 기다려 주세요.',
  nextStep: '안내가 계속 바뀌지 않으면 문의 코드와 함께 고객센터에 연락해 주세요.',
};

const canonicalizeContractCode = (code?: string) =>
  typeof code === 'string' && /^[A-Z]+_[0-9]{3}$/.test(code)
    ? code.replace(/_/g, '-')
    : code;

const FEP_ERROR_CODE_PATTERN = /^FEP-\d{3}$/;
const UNKNOWN_EXTERNAL_OPERATOR_CODE_PATTERN = /^UNKNOWN_EXTERNAL/;

const parseRetryAfterSeconds = (value: unknown) => {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.round(value);
  }

  if (typeof value === 'string' && /^\d+$/.test(value)) {
    return Number.parseInt(value, 10);
  }

  return undefined;
};

const getField = <K extends keyof NormalizedApiError>(error: unknown, key: K) =>
  typeof error === 'object' && error !== null && key in error
    ? (error as Partial<NormalizedApiError>)[key]
    : undefined;

export const isVisibleExternalOrderError = (error: unknown) => {
  const rawCode = getField(error, 'code');
  const code = canonicalizeContractCode(
    typeof rawCode === 'string' ? rawCode : undefined,
  );
  const message = getField(error, 'message');
  const operatorCode = getField(error, 'operatorCode');

  if (code && FEP_ERROR_CODE_PATTERN.test(code)) {
    return true;
  }

  if (
    typeof operatorCode === 'string'
    && UNKNOWN_EXTERNAL_OPERATOR_CODE_PATTERN.test(operatorCode)
  ) {
    return true;
  }

  return !code && typeof message === 'string' && TRANSPORT_MESSAGES.has(message);
};

const toPresentation = (
  template: ExternalOrderErrorTemplate,
  options?: {
    code?: string;
    operatorCode?: string;
    traceId?: string;
    retryAfterSeconds?: number;
    nextStep?: string;
  },
): ExternalOrderErrorPresentation => ({
  code: options?.code,
  operatorCode: options?.operatorCode,
  reasonCategory: 'external',
  reasonCategoryLabel: getOrderReasonCategoryLabel('external') ?? '대외',
  semantic: template.semantic,
  recoveryAction: template.recoveryAction,
  severity: template.severity,
  title: template.title,
  message: template.message,
  nextStep: options?.nextStep ?? template.nextStep,
  traceId: options?.traceId,
  retryAfterSeconds: options?.retryAfterSeconds,
  supportReference: options?.traceId
    ? `${SUPPORT_REFERENCE_LABEL}: ${options.traceId}`
    : undefined,
});

const formatRetryNextStep = (retryAfterSeconds?: number) =>
  retryAfterSeconds && retryAfterSeconds > 0
    ? `약 ${retryAfterSeconds}초 후 다시 주문해 주세요.`
    : FEP_001_RETRY_TEMPLATE.nextStep;

const buildFep001Presentation = (options?: {
  code?: string;
  operatorCode?: string;
  traceId?: string;
  retryAfterSeconds?: number;
}) => {
  if (options?.operatorCode === 'KEY_EXPIRED') {
    return toPresentation(FEP_001_CONTACT_TEMPLATE, options);
  }

  return toPresentation(FEP_001_RETRY_TEMPLATE, {
    ...options,
    nextStep: formatRetryNextStep(options?.retryAfterSeconds),
  });
};

export const resolveExternalOrderErrorPresentation = (
  error: unknown,
): ExternalOrderErrorPresentation => {
  const rawCode = getField(error, 'code');
  const code = canonicalizeContractCode(
    typeof rawCode === 'string' ? rawCode : undefined,
  );
  const message = getField(error, 'message');
  const traceId = getField(error, 'traceId');
  const operatorCode = getField(error, 'operatorCode');
  const retryAfterSeconds = parseRetryAfterSeconds(
    getField(error, 'retryAfterSeconds'),
  );

  if (code === 'FEP-001') {
    return buildFep001Presentation({
      code,
      operatorCode: typeof operatorCode === 'string' ? operatorCode : undefined,
      traceId: typeof traceId === 'string' ? traceId : undefined,
      retryAfterSeconds,
    });
  }

  if (code && TEMPLATE_BY_CODE[code]) {
    return toPresentation(TEMPLATE_BY_CODE[code], {
      code,
      operatorCode: typeof operatorCode === 'string' ? operatorCode : undefined,
      traceId: typeof traceId === 'string' ? traceId : undefined,
      retryAfterSeconds,
    });
  }

  if (!code && typeof message === 'string' && TRANSPORT_MESSAGES.has(message)) {
    return toPresentation(TRANSPORT_TEMPLATE, {
      traceId: typeof traceId === 'string' ? traceId : undefined,
    });
  }

  return toPresentation(UNKNOWN_TEMPLATE, {
    code,
    operatorCode: typeof operatorCode === 'string' ? operatorCode : undefined,
    traceId: typeof traceId === 'string' ? traceId : undefined,
    retryAfterSeconds,
  });
};
