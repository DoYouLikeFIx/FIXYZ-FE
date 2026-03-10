import type { FormEventHandler } from 'react';

import { buildPasswordRecoveryGuidance } from '@/lib/auth-copy';

interface LoginFormProps {
  email: string;
  password: string;
  showPassword: boolean;
  emailInvalid: boolean;
  passwordInvalid: boolean;
  showPasswordRecoveryHelp: boolean;
  errorMessage: string | null;
  isSubmitting: boolean;
  onEmailChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onTogglePasswordVisibility: () => void;
  onTogglePasswordRecoveryHelp: () => void;
  onSubmit: FormEventHandler<HTMLFormElement>;
}

export function LoginForm({
  email,
  password,
  showPassword,
  emailInvalid,
  passwordInvalid,
  showPasswordRecoveryHelp,
  errorMessage,
  isSubmitting,
  onEmailChange,
  onPasswordChange,
  onTogglePasswordVisibility,
  onTogglePasswordRecoveryHelp,
  onSubmit,
}: LoginFormProps) {
  const passwordRecoveryGuidance = buildPasswordRecoveryGuidance(email);

  return (
    <form className="auth-form auth-form--login" noValidate onSubmit={onSubmit}>
      <div className="field">
        <label className="field-label" htmlFor="login-email">
          이메일
        </label>
        <input
          autoComplete="email"
          aria-invalid={emailInvalid}
          data-testid="login-email"
          id="login-email"
          name="email"
          onChange={(event) => onEmailChange(event.target.value)}
          placeholder="이메일"
          required
          type="email"
          value={email}
        />
      </div>

      <div className="field field--with-action">
        <label className="field-label" htmlFor="login-password">
          비밀번호
        </label>
        <div className="field-control">
          <input
            autoComplete="current-password"
            aria-invalid={passwordInvalid}
            data-testid="login-password"
            id="login-password"
            name="password"
            onChange={(event) => onPasswordChange(event.target.value)}
            placeholder="비밀번호"
            required
            type={showPassword ? 'text' : 'password'}
            value={password}
          />
          <button
            aria-label={showPassword ? '비밀번호 숨기기' : '비밀번호 표시'}
            className="field__action"
            data-testid="login-password-toggle"
            type="button"
            onClick={onTogglePasswordVisibility}
          >
            {showPassword ? '숨김' : '보기'}
          </button>
        </div>
      </div>

      <div className="auth-meta">
        <button
          aria-expanded={showPasswordRecoveryHelp}
          className="auth-help-link"
          data-testid="login-password-recovery-toggle"
          type="button"
          onClick={onTogglePasswordRecoveryHelp}
        >
          {showPasswordRecoveryHelp ? '안내 닫기' : '비밀번호 재설정 안내'}
        </button>
      </div>

      {showPasswordRecoveryHelp ? (
        <div
          className="auth-inline-help"
          data-testid="login-password-recovery-help"
          role="status"
        >
          <strong className="auth-inline-help__title">
            {passwordRecoveryGuidance.title}
          </strong>
          <p className="auth-inline-help__body">{passwordRecoveryGuidance.body}</p>
          <p className="auth-inline-help__detail">{passwordRecoveryGuidance.detail}</p>
        </div>
      ) : null}

      {errorMessage && (
        <p className="form-message form-message--error" data-testid="error-message" role="alert">
          {errorMessage}
        </p>
      )}

      <button
        className="auth-submit"
        data-testid="login-submit"
        disabled={isSubmitting}
        type="submit"
      >
        {isSubmitting ? '로그인 중...' : '로그인'}
      </button>
    </form>
  );
}
