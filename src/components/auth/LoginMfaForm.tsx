import type { FormEventHandler } from 'react';

interface LoginMfaFormProps {
  otpCode: string;
  errorMessage: string | null;
  expiresAtLabel: string;
  remainingLabel: string;
  isSubmitting: boolean;
  onOtpCodeChange: (value: string) => void;
  onRestartLogin: () => void;
  onSubmit: FormEventHandler<HTMLFormElement>;
}

export function LoginMfaForm({
  otpCode,
  errorMessage,
  expiresAtLabel,
  remainingLabel,
  isSubmitting,
  onOtpCodeChange,
  onRestartLogin,
  onSubmit,
}: LoginMfaFormProps) {
  return (
    <form className="auth-form auth-form--mfa" noValidate onSubmit={onSubmit}>
      <div className="auth-inline-help auth-inline-help--mfa" data-testid="login-mfa-guidance">
        <strong className="auth-inline-help__title">비밀번호 확인이 완료되었습니다</strong>
        <p className="auth-inline-help__body">
          Google Authenticator 앱의 현재 6자리 코드를 입력해 주세요.
        </p>
        <p className="auth-inline-help__detail">
          인증 단계 만료: {expiresAtLabel} · {remainingLabel}
        </p>
      </div>

      <div className="field">
        <label className="field-label" htmlFor="login-mfa-input">
          인증 코드
        </label>
        <input
          autoComplete="one-time-code"
          data-testid="login-mfa-input"
          id="login-mfa-input"
          inputMode="numeric"
          maxLength={6}
          name="otpCode"
          onChange={(event) => onOtpCodeChange(event.target.value)}
          pattern="[0-9]*"
          placeholder="6자리 코드"
          required
          value={otpCode}
        />
      </div>

      {errorMessage ? (
        <p className="form-message form-message--error" data-testid="login-mfa-error" role="alert">
          {errorMessage}
        </p>
      ) : null}

      <button
        className="auth-submit"
        data-testid="login-mfa-submit"
        disabled={isSubmitting}
        type="submit"
      >
        {isSubmitting ? '인증 중...' : '인증 완료'}
      </button>

      <button
        className="auth-secondary-action"
        data-testid="login-mfa-reset"
        type="button"
        onClick={onRestartLogin}
      >
        비밀번호 다시 입력
      </button>
    </form>
  );
}
