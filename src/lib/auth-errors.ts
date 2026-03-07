import type { NormalizedApiError } from '@/lib/axios';

const DEFAULT_AUTH_ERROR_MESSAGE =
  '로그인을 완료할 수 없습니다. 잠시 후 다시 시도해 주세요.';
const DEFAULT_REAUTH_MESSAGE = '세션이 만료되었습니다. 다시 로그인해 주세요.';

const AUTH_MESSAGE_BY_CODE: Record<string, string> = {
  'AUTH-001': '아이디 또는 비밀번호가 올바르지 않습니다.',
  'AUTH-002': '로그인 시도가 잠겨 있습니다. 잠시 후 다시 시도해 주세요.',
  'AUTH-004': '탈퇴한 계정은 로그인할 수 없습니다.',
  'AUTH-007':
    '비밀번호는 8자 이상이며 대문자, 숫자, 특수문자를 포함해야 합니다.',
  'AUTH-008': '이미 사용 중인 아이디입니다. 다른 아이디를 선택해 주세요.',
  'RATE-001': '로그인 시도가 너무 많습니다. 잠시 후 다시 시도해 주세요.',
  'VALIDATION-001': '입력값을 다시 확인해 주세요.',
  'CORE-001': '회원 가입을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.',
  'SYS-001': '현재 인증 서비스를 사용할 수 없습니다. 잠시 후 다시 시도해 주세요.',
};

const getErrorCode = (error: unknown) =>
  typeof error === 'object' && error !== null && 'code' in error
    ? (error as Partial<NormalizedApiError>).code
    : undefined;

const getErrorMessage = (error: unknown) =>
  typeof error === 'object' && error !== null && 'message' in error
    ? (error as Partial<NormalizedApiError>).message
    : undefined;

export const isReauthError = (error: unknown) => {
  const code = getErrorCode(error);

  return code === 'AUTH-003' || code === 'CHANNEL-001' || code === 'AUTH-016';
};

export const getReauthMessage = (error: unknown) => {
  if (isReauthError(error)) {
    return DEFAULT_REAUTH_MESSAGE;
  }

  return getErrorMessage(error) || DEFAULT_REAUTH_MESSAGE;
};

export const getAuthErrorMessage = (error: unknown) => {
  if (isReauthError(error)) {
    return getReauthMessage(error);
  }

  const code = getErrorCode(error);

  if (code && AUTH_MESSAGE_BY_CODE[code]) {
    return AUTH_MESSAGE_BY_CODE[code];
  }

  return getErrorMessage(error) || DEFAULT_AUTH_ERROR_MESSAGE;
};
