import {
  DEFAULT_SERVER_ERROR_MESSAGE,
  FORBIDDEN_ERROR_MESSAGE,
  NETWORK_ERROR_MESSAGE,
  TIMEOUT_ERROR_MESSAGE,
} from '@/lib/api-error-messages';
import type { NormalizedApiError } from '@/lib/axios';

const DEFAULT_AUTH_ERROR_MESSAGE =
  '로그인을 완료할 수 없습니다. 잠시 후 다시 시도해 주세요. 문제가 계속되면 고객센터에 문의해 주세요.';
const DEFAULT_REAUTH_MESSAGE = '세션이 만료되었습니다. 다시 로그인해 주세요.';
const SUPPORT_REFERENCE_LABEL = '문의 코드';

type AuthErrorSemantic =
  | 'invalid-credentials'
  | 'account-locked'
  | 'reauth-required'
  | 'withdrawn-account'
  | 'password-policy'
  | 'duplicate-username'
  | 'duplicate-email'
  | 'rate-limited'
  | 'validation'
  | 'register-failed'
  | 'service-unavailable'
  | 'transport'
  | 'unknown';

type AuthRecoveryAction =
  | 'retry-credentials'
  | 'retry-later'
  | 'reauthenticate'
  | 'switch-account'
  | 'fix-password'
  | 'change-username'
  | 'change-email'
  | 'check-input'
  | 'retry-register'
  | 'retry-request'
  | 'contact-support';

interface AuthErrorTemplate {
  semantic: AuthErrorSemantic;
  recoveryAction: AuthRecoveryAction;
  message: string;
}

export interface AuthErrorPresentation {
  code?: string;
  semantic: AuthErrorSemantic;
  recoveryAction: AuthRecoveryAction;
  message: string;
  traceId?: string;
}

const AUTH_TEMPLATE_BY_CODE: Record<string, AuthErrorTemplate> = {
  'AUTH-001': {
    semantic: 'invalid-credentials',
    recoveryAction: 'retry-credentials',
    message: '아이디 또는 비밀번호가 올바르지 않습니다.',
  },
  'AUTH-002': {
    semantic: 'account-locked',
    recoveryAction: 'retry-later',
    message: '로그인 시도가 잠겨 있습니다. 잠시 후 다시 시도해 주세요.',
  },
  'AUTH-003': {
    semantic: 'reauth-required',
    recoveryAction: 'reauthenticate',
    message: DEFAULT_REAUTH_MESSAGE,
  },
  'AUTH-004': {
    semantic: 'withdrawn-account',
    recoveryAction: 'switch-account',
    message: '탈퇴한 계정은 로그인할 수 없습니다.',
  },
  'AUTH-007': {
    semantic: 'password-policy',
    recoveryAction: 'fix-password',
    message: '비밀번호는 8자 이상이며 대문자, 숫자, 특수문자를 포함해야 합니다.',
  },
  'AUTH-008': {
    semantic: 'duplicate-username',
    recoveryAction: 'change-username',
    message: '이미 사용 중인 아이디입니다. 다른 아이디를 선택해 주세요.',
  },
  'AUTH-016': {
    semantic: 'reauth-required',
    recoveryAction: 'reauthenticate',
    message: DEFAULT_REAUTH_MESSAGE,
  },
  'CHANNEL-001': {
    semantic: 'reauth-required',
    recoveryAction: 'reauthenticate',
    message: DEFAULT_REAUTH_MESSAGE,
  },
  'RATE-001': {
    semantic: 'rate-limited',
    recoveryAction: 'retry-later',
    message: '로그인 시도가 너무 많습니다. 잠시 후 다시 시도해 주세요.',
  },
  'VALIDATION-001': {
    semantic: 'validation',
    recoveryAction: 'check-input',
    message: '입력값을 다시 확인해 주세요.',
  },
  'CORE-001': {
    semantic: 'register-failed',
    recoveryAction: 'retry-register',
    message: '회원 가입을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.',
  },
  'SYS-001': {
    semantic: 'service-unavailable',
    recoveryAction: 'retry-later',
    message: '현재 인증 서비스를 사용할 수 없습니다. 잠시 후 다시 시도해 주세요.',
  },
};

const DUPLICATE_EMAIL_TEMPLATE: AuthErrorTemplate = {
  semantic: 'duplicate-email',
  recoveryAction: 'change-email',
  message: '이미 가입된 이메일입니다. 다른 이메일을 입력해 주세요.',
};

const UNKNOWN_AUTH_TEMPLATE: AuthErrorTemplate = {
  semantic: 'unknown',
  recoveryAction: 'contact-support',
  message: DEFAULT_AUTH_ERROR_MESSAGE,
};

const TRANSPORT_MESSAGES = new Set([
  DEFAULT_SERVER_ERROR_MESSAGE,
  NETWORK_ERROR_MESSAGE,
  TIMEOUT_ERROR_MESSAGE,
  FORBIDDEN_ERROR_MESSAGE,
]);

const getErrorCode = (error: unknown) =>
  typeof error === 'object' && error !== null && 'code' in error
    ? (error as Partial<NormalizedApiError>).code
    : undefined;

const getErrorMessage = (error: unknown) =>
  typeof error === 'object' && error !== null && 'message' in error
    ? (error as Partial<NormalizedApiError>).message
    : undefined;

const getTraceId = (error: unknown) =>
  typeof error === 'object' && error !== null && 'traceId' in error
    ? (error as Partial<NormalizedApiError>).traceId
    : undefined;

const canonicalizeContractCode = (code?: string) =>
  typeof code === 'string' && /^(AUTH|CHANNEL|RATE|VALIDATION|CORE|SYS)_[0-9]{3}$/.test(code)
    ? code.replace(/_/g, '-')
    : code;

const toPresentation = (
  template: AuthErrorTemplate,
  options?: { code?: string; traceId?: string },
): AuthErrorPresentation => ({
  code: options?.code,
  semantic: template.semantic,
  recoveryAction: template.recoveryAction,
  message:
    template.semantic === 'unknown' && options?.traceId
      ? `${template.message} ${SUPPORT_REFERENCE_LABEL}: ${options.traceId}`
      : template.message,
  traceId: options?.traceId,
});

export const isReauthError = (error: unknown) => {
  const code = canonicalizeContractCode(getErrorCode(error));

  return code === 'AUTH-003' || code === 'CHANNEL-001' || code === 'AUTH-016';
};

export const resolveAuthErrorPresentation = (
  error: unknown,
): AuthErrorPresentation => {
  const rawCode = getErrorCode(error);
  const code = canonicalizeContractCode(rawCode);
  const message = getErrorMessage(error);
  const traceId = getTraceId(error);

  if (rawCode === 'BAD_REQUEST' && message === 'member already exists') {
    return toPresentation(DUPLICATE_EMAIL_TEMPLATE, { code: rawCode, traceId });
  }

  if (code && AUTH_TEMPLATE_BY_CODE[code]) {
    return toPresentation(AUTH_TEMPLATE_BY_CODE[code], { code, traceId });
  }

  if (!code && message && TRANSPORT_MESSAGES.has(message)) {
    return {
      code: rawCode,
      semantic: 'transport',
      recoveryAction: 'retry-request',
      message,
      traceId,
    };
  }

  return toPresentation(UNKNOWN_AUTH_TEMPLATE, { code: code ?? rawCode, traceId });
};

export const getReauthMessage = (error: unknown) => {
  const presentation = resolveAuthErrorPresentation(error);

  if (presentation.semantic === 'reauth-required') {
    return presentation.message;
  }

  return DEFAULT_REAUTH_MESSAGE;
};

export const getAuthErrorMessage = (error: unknown) =>
  resolveAuthErrorPresentation(error).message;
