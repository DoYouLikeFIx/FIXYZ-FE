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
  | 'current-password-mismatch'
  | 'account-locked'
  | 'reauth-required'
  | 'withdrawn-account'
  | 'password-policy'
  | 'password-reset-token-invalid'
  | 'password-reset-token-consumed'
  | 'password-reset-rate-limited'
  | 'password-reset-same-password'
  | 'recovery-challenge-invalid'
  | 'recovery-challenge-bootstrap-unavailable'
  | 'recovery-challenge-replayed'
  | 'recovery-challenge-verify-unavailable'
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
  | 'request-password-reset'
  | 'request-new-reset-link'
  | 'refresh-challenge'
  | 'restart-recovery-challenge'
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

export interface MfaErrorPresentation {
  code?: string;
  message: string;
  restartLogin: boolean;
  navigateToEnroll: boolean;
  navigateToRecovery: boolean;
  enrollUrl?: string;
  recoveryUrl?: string;
}

const AUTH_TEMPLATE_BY_CODE: Record<string, AuthErrorTemplate> = {
  'AUTH-001': {
    semantic: 'invalid-credentials',
    recoveryAction: 'retry-credentials',
    message: '이메일 또는 비밀번호가 올바르지 않습니다.',
  },
  'AUTH-002': {
    semantic: 'account-locked',
    recoveryAction: 'retry-later',
    message: '로그인 시도가 잠겨 있습니다. 잠시 후 다시 시도해 주세요.',
  },
  'AUTH-026': {
    semantic: 'current-password-mismatch',
    recoveryAction: 'retry-credentials',
    message: '현재 비밀번호가 일치하지 않습니다. 다시 입력해 주세요.',
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
  'AUTH-012': {
    semantic: 'password-reset-token-invalid',
    recoveryAction: 'request-password-reset',
    message: '재설정 링크가 유효하지 않거나 만료되었습니다. 비밀번호 재설정을 다시 요청해 주세요.',
  },
  'AUTH-013': {
    semantic: 'password-reset-token-consumed',
    recoveryAction: 'request-new-reset-link',
    message: '이미 사용된 재설정 링크입니다. 새로운 재설정 링크를 요청해 주세요.',
  },
  'AUTH-014': {
    semantic: 'password-reset-rate-limited',
    recoveryAction: 'retry-request',
    message: '비밀번호 재설정 요청이 너무 많습니다.',
  },
  'AUTH-015': {
    semantic: 'password-reset-same-password',
    recoveryAction: 'fix-password',
    message: '현재 비밀번호와 다른 새 비밀번호를 입력해 주세요.',
  },
  'AUTH-022': {
    semantic: 'recovery-challenge-invalid',
    recoveryAction: 'refresh-challenge',
    message: '보안 확인이 유효하지 않거나 만료되었습니다. 새 보안 확인을 다시 진행해 주세요.',
  },
  'AUTH-023': {
    semantic: 'recovery-challenge-bootstrap-unavailable',
    recoveryAction: 'retry-later',
    message: '지금은 보안 확인을 시작할 수 없습니다. 잠시 후 다시 시도해 주세요.',
  },
  'AUTH-024': {
    semantic: 'recovery-challenge-replayed',
    recoveryAction: 'refresh-challenge',
    message: '이미 사용된 보안 확인입니다. 새 보안 확인을 다시 받아 주세요.',
  },
  'AUTH-025': {
    semantic: 'recovery-challenge-verify-unavailable',
    recoveryAction: 'restart-recovery-challenge',
    message: '보안 확인을 검증하는 중 문제가 발생했습니다. 현재 보안 확인을 지우고 다시 시작해 주세요.',
  },
  'AUTH-017': {
    semantic: 'duplicate-email',
    recoveryAction: 'change-email',
    message: '이미 가입된 이메일입니다. 다른 이메일을 입력해 주세요.',
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
  options?: {
    code?: string;
    retryAfterSeconds?: number;
    traceId?: string;
  },
): AuthErrorPresentation => ({
  code: options?.code,
  semantic: template.semantic,
  recoveryAction: template.recoveryAction,
  message:
    template.semantic === 'password-reset-rate-limited' && options?.retryAfterSeconds !== undefined
      ? `${template.message} ${options.retryAfterSeconds}초 후 다시 시도해 주세요.`
      : template.semantic === 'unknown' && options?.traceId
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
  const retryAfterSeconds =
    typeof error === 'object' && error !== null && 'retryAfterSeconds' in error
      ? (error as Partial<NormalizedApiError>).retryAfterSeconds
      : undefined;
  const traceId = getTraceId(error);

  if (code && AUTH_TEMPLATE_BY_CODE[code]) {
    return toPresentation(AUTH_TEMPLATE_BY_CODE[code], {
      code,
      retryAfterSeconds,
      traceId,
    });
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

const getMfaErrorOptions = (error: unknown) =>
  typeof error === 'object' && error !== null
    ? {
        code: canonicalizeContractCode(getErrorCode(error)),
        traceId: getTraceId(error),
        retryAfterSeconds:
          'retryAfterSeconds' in error
            ? (error as Partial<NormalizedApiError>).retryAfterSeconds
            : undefined,
        enrollUrl:
          'enrollUrl' in error && typeof (error as Partial<NormalizedApiError>).enrollUrl === 'string'
            ? (error as Partial<NormalizedApiError>).enrollUrl
            : undefined,
        recoveryUrl:
          'recoveryUrl' in error && typeof (error as Partial<NormalizedApiError>).recoveryUrl === 'string'
            ? (error as Partial<NormalizedApiError>).recoveryUrl
            : undefined,
        message: getErrorMessage(error),
      }
    : {
        code: undefined,
        traceId: undefined,
        retryAfterSeconds: undefined,
        enrollUrl: undefined,
        recoveryUrl: undefined,
        message: undefined,
      };

export const resolveMfaErrorPresentation = (
  error: unknown,
): MfaErrorPresentation => {
  const {
    code,
    traceId,
    retryAfterSeconds,
    enrollUrl,
    recoveryUrl,
    message,
  } = getMfaErrorOptions(error);

  if (code === 'AUTH-009') {
    return {
      code,
      message: 'Google Authenticator 등록이 필요합니다. 인증 앱을 연결한 뒤 첫 코드를 확인해 주세요.',
      restartLogin: false,
      navigateToEnroll: true,
      navigateToRecovery: false,
      enrollUrl,
    };
  }

  if (code === 'AUTH-026') {
    return {
      code,
      message: '현재 비밀번호가 일치하지 않습니다. 다시 입력해 주세요.',
      restartLogin: false,
      navigateToEnroll: false,
      navigateToRecovery: false,
    };
  }

  if (code === 'AUTH-010') {
    return {
      code,
      message: '인증 코드가 올바르지 않습니다. 앱에 표시된 현재 6자리 코드를 다시 입력해 주세요.',
      restartLogin: false,
      navigateToEnroll: false,
      navigateToRecovery: false,
    };
  }

  if (code === 'AUTH-011') {
    return {
      code,
      message: '방금 사용한 인증 코드는 다시 사용할 수 없습니다. 새로운 6자리 코드를 입력해 주세요.',
      restartLogin: false,
      navigateToEnroll: false,
      navigateToRecovery: false,
    };
  }

  if (code === 'AUTH-018') {
    return {
      code,
      message: '인증 단계가 만료되었습니다. 이메일과 비밀번호부터 다시 로그인해 주세요.',
      restartLogin: true,
      navigateToEnroll: false,
      navigateToRecovery: false,
    };
  }

  if (code === 'AUTH-019') {
    return {
      code,
      message: '복구 단계가 유효하지 않거나 만료되었습니다. 비밀번호 재설정을 다시 진행해 주세요.',
      restartLogin: false,
      navigateToEnroll: false,
      navigateToRecovery: false,
    };
  }

  if (code === 'AUTH-020') {
    return {
      code,
      message: '이미 사용된 복구 단계입니다. 비밀번호 재설정을 다시 진행해 주세요.',
      restartLogin: false,
      navigateToEnroll: false,
      navigateToRecovery: false,
    };
  }

  if (code === 'AUTH-021') {
    return {
      code,
      message: '기존 인증기를 사용할 수 없어 복구가 필요합니다. 새 인증 앱을 연결하는 복구 단계를 진행해 주세요.',
      restartLogin: false,
      navigateToEnroll: false,
      navigateToRecovery: true,
      recoveryUrl,
    };
  }

  if (code === 'RATE-001') {
    return {
      code,
      message:
        retryAfterSeconds !== undefined
          ? `인증 시도가 너무 많습니다. ${retryAfterSeconds}초 후 다시 시도해 주세요.`
          : '인증 시도가 너무 많습니다. 잠시 후 다시 시도해 주세요.',
      restartLogin: false,
      navigateToEnroll: false,
      navigateToRecovery: false,
    };
  }

  if (!code && message === FORBIDDEN_ERROR_MESSAGE) {
    return {
      message: '보안 토큰을 다시 확인했습니다. 같은 작업을 한 번 더 시도해 주세요.',
      restartLogin: false,
      navigateToEnroll: false,
      navigateToRecovery: false,
    };
  }

  const fallback = resolveAuthErrorPresentation(error);

  return {
    code: fallback.code,
    message:
      fallback.semantic === 'unknown' && traceId
        ? `${fallback.message} ${SUPPORT_REFERENCE_LABEL}: ${traceId}`
        : fallback.message,
    restartLogin: fallback.semantic === 'reauth-required',
    navigateToEnroll: false,
    navigateToRecovery: false,
  };
};
