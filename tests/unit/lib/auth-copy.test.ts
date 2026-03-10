import {
  REGISTER_EMAIL_USAGE_HINT,
  buildPasswordRecoveryGuidance,
} from '@/lib/auth-copy';

describe('auth copy', () => {
  it('returns the shared register email hint', () => {
    expect(REGISTER_EMAIL_USAGE_HINT).toBe(
      '로그인과 비밀번호 재설정에 같은 이메일을 사용합니다.',
    );
  });

  it('builds recovery guidance with the entered email when present', () => {
    expect(buildPasswordRecoveryGuidance('demo@fix.com')).toEqual({
      title: '비밀번호 재설정 안내',
      body: '비밀번호 재설정은 가입한 이메일 기준으로 진행됩니다. 로그인에도 같은 이메일을 사용하세요.',
      detail: '현재 입력된 이메일: demo@fix.com',
    });
  });

  it('builds recovery guidance without an entered email', () => {
    expect(buildPasswordRecoveryGuidance('')).toEqual({
      title: '비밀번호 재설정 안내',
      body: '비밀번호 재설정은 가입한 이메일 기준으로 진행됩니다. 로그인에도 같은 이메일을 사용하세요.',
      detail:
        '가입한 이메일을 먼저 입력해 두면 이후 재설정 요청에도 같은 주소를 사용할 수 있습니다.',
    });
  });
});
