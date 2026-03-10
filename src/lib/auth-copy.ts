export const REGISTER_EMAIL_USAGE_HINT =
  '로그인과 비밀번호 재설정에 같은 이메일을 사용합니다.';

export const buildPasswordRecoveryGuidance = (email: string) => {
  const normalizedEmail = email.trim();

  return {
    title: '비밀번호 재설정 안내',
    body: '비밀번호 재설정은 가입한 이메일 기준으로 진행됩니다. 로그인에도 같은 이메일을 사용하세요.',
    detail: normalizedEmail
      ? `현재 입력된 이메일: ${normalizedEmail}`
      : '가입한 이메일을 먼저 입력해 두면 이후 재설정 요청에도 같은 주소를 사용할 수 있습니다.',
  };
};
