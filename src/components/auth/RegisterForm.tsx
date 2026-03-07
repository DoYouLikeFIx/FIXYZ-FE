import type { FormEventHandler } from 'react';

interface RegisterFormProps {
  username: string;
  email: string;
  name: string;
  password: string;
  confirmPassword: string;
  showPassword: boolean;
  showConfirmPassword: boolean;
  usernameInvalid: boolean;
  emailInvalid: boolean;
  nameInvalid: boolean;
  passwordInvalid: boolean;
  confirmPasswordInvalid: boolean;
  isPasswordValid: boolean;
  isConfirmDirty: boolean;
  isConfirmPasswordValid: boolean;
  passwordPolicyMessage: string;
  confirmPasswordMessage: string;
  errorMessage: string | null;
  isSubmitting: boolean;
  onUsernameChange: (value: string) => void;
  onEmailChange: (value: string) => void;
  onNameChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onConfirmPasswordChange: (value: string) => void;
  onTogglePasswordVisibility: () => void;
  onToggleConfirmPasswordVisibility: () => void;
  onSubmit: FormEventHandler<HTMLFormElement>;
}

export function RegisterForm({
  username,
  email,
  name,
  password,
  confirmPassword,
  showPassword,
  showConfirmPassword,
  usernameInvalid,
  emailInvalid,
  nameInvalid,
  passwordInvalid,
  confirmPasswordInvalid,
  isPasswordValid,
  isConfirmDirty,
  isConfirmPasswordValid,
  passwordPolicyMessage,
  confirmPasswordMessage,
  errorMessage,
  isSubmitting,
  onUsernameChange,
  onEmailChange,
  onNameChange,
  onPasswordChange,
  onConfirmPasswordChange,
  onTogglePasswordVisibility,
  onToggleConfirmPasswordVisibility,
  onSubmit,
}: RegisterFormProps) {
  return (
    <form className="auth-form auth-form--register" noValidate onSubmit={onSubmit}>
      <div className="field field--register-username">
        <label className="field-label" htmlFor="register-username">
          아이디
        </label>
        <input
          autoComplete="username"
          aria-invalid={usernameInvalid}
          data-testid="register-username"
          id="register-username"
          name="username"
          onChange={(event) => onUsernameChange(event.target.value)}
          placeholder="아이디"
          required
          value={username}
        />
      </div>

      <div className="field field--register-email">
        <label className="field-label" htmlFor="register-email">
          이메일
        </label>
        <input
          autoComplete="email"
          aria-invalid={emailInvalid}
          data-testid="register-email"
          id="register-email"
          name="email"
          onChange={(event) => onEmailChange(event.target.value)}
          placeholder="이메일"
          required
          type="email"
          value={email}
        />
      </div>

      <div className="field field--register-name">
        <label className="field-label" htmlFor="register-name">
          이름
        </label>
        <input
          autoComplete="name"
          aria-invalid={nameInvalid}
          data-testid="register-name"
          id="register-name"
          name="name"
          onChange={(event) => onNameChange(event.target.value)}
          placeholder="이름"
          required
          value={name}
        />
      </div>

      <div className="field field--with-action field--register-password">
        <label className="field-label" htmlFor="register-password">
          비밀번호
        </label>
        <div className="field-control">
          <input
            aria-describedby="register-password-policy-status"
            aria-invalid={passwordInvalid || (password.length > 0 && !isPasswordValid)}
            autoComplete="new-password"
            data-testid="register-password"
            id="register-password"
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
            data-testid="register-password-toggle"
            type="button"
            onClick={onTogglePasswordVisibility}
          >
            {showPassword ? '숨김' : '보기'}
          </button>
        </div>
        <span
          className={`field-hint ${
            isPasswordValid ? 'field-hint--valid' : 'field-hint--pending'
          }`}
          data-testid="register-password-policy-status"
          id="register-password-policy-status"
        >
          {passwordPolicyMessage}
        </span>
      </div>

      <div className="field field--with-action field--register-confirm">
        <label className="field-label" htmlFor="register-password-confirm">
          비밀번호 확인
        </label>
        <div className="field-control">
          <input
            aria-describedby="register-password-match-status"
            aria-invalid={
              confirmPasswordInvalid || (isConfirmDirty && !isConfirmPasswordValid)
            }
            autoComplete="new-password"
            data-testid="register-password-confirm"
            id="register-password-confirm"
            name="confirmPassword"
            onChange={(event) => onConfirmPasswordChange(event.target.value)}
            placeholder="비밀번호 확인"
            required
            type={showConfirmPassword ? 'text' : 'password'}
            value={confirmPassword}
          />
          <button
            aria-label={
              showConfirmPassword ? '비밀번호 확인 숨기기' : '비밀번호 확인 표시'
            }
            className="field__action"
            data-testid="register-password-confirm-toggle"
            type="button"
            onClick={onToggleConfirmPasswordVisibility}
          >
            {showConfirmPassword ? '숨김' : '보기'}
          </button>
        </div>
        <span
          className={`field-hint ${
            isConfirmDirty
              ? isConfirmPasswordValid
                ? 'field-hint--valid'
                : 'field-hint--invalid'
              : 'field-hint--pending'
          }`}
          data-testid="register-password-match-status"
          id="register-password-match-status"
        >
          {confirmPasswordMessage}
        </span>
      </div>

      {errorMessage && (
        <p className="form-message form-message--error" data-testid="error-message" role="alert">
          {errorMessage}
        </p>
      )}

      <button
        className="auth-submit auth-submit--register"
        data-testid="register-submit"
        disabled={isSubmitting}
        type="submit"
      >
        {isSubmitting ? '가입 중...' : '회원가입'}
      </button>
    </form>
  );
}
