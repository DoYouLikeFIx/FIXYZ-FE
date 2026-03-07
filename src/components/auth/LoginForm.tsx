import type { FormEventHandler } from 'react';

interface LoginFormProps {
  username: string;
  password: string;
  showPassword: boolean;
  usernameInvalid: boolean;
  passwordInvalid: boolean;
  errorMessage: string | null;
  isSubmitting: boolean;
  onUsernameChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onTogglePasswordVisibility: () => void;
  onSubmit: FormEventHandler<HTMLFormElement>;
}

export function LoginForm({
  username,
  password,
  showPassword,
  usernameInvalid,
  passwordInvalid,
  errorMessage,
  isSubmitting,
  onUsernameChange,
  onPasswordChange,
  onTogglePasswordVisibility,
  onSubmit,
}: LoginFormProps) {
  return (
    <form className="auth-form auth-form--login" noValidate onSubmit={onSubmit}>
      <div className="field">
        <label className="field-label" htmlFor="login-username">
          아이디
        </label>
        <input
          autoComplete="username"
          aria-invalid={usernameInvalid}
          data-testid="login-username"
          id="login-username"
          name="username"
          onChange={(event) => onUsernameChange(event.target.value)}
          placeholder="아이디"
          required
          value={username}
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
        <button className="auth-help-link" type="button">
          비밀번호 찾기
        </button>
      </div>

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
