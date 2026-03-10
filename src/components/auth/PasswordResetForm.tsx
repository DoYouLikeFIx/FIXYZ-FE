import { Link } from 'react-router-dom';

import { FORGOT_PASSWORD_ROUTE } from '@/router/navigation';

interface PasswordResetFormProps {
  hasToken: boolean;
  newPassword: string;
  showPassword: boolean;
  passwordInvalid: boolean;
  passwordPolicyMessage: string;
  errorMessage: string | null;
  isSubmitting: boolean;
  onPasswordChange: (value: string) => void;
  onTogglePasswordVisibility: () => void;
  onSubmit: () => void;
}

export function PasswordResetForm({
  hasToken,
  newPassword,
  showPassword,
  passwordInvalid,
  passwordPolicyMessage,
  errorMessage,
  isSubmitting,
  onPasswordChange,
  onTogglePasswordVisibility,
  onSubmit,
}: PasswordResetFormProps) {
  if (!hasToken) {
    return (
      <div className="auth-form auth-form--recovery">
        <div className="auth-inline-help auth-inline-help--challenge" data-testid="reset-password-missing-token">
          <strong className="auth-inline-help__title">재설정 링크를 다시 확인해 주세요.</strong>
          <p className="auth-inline-help__body">
            링크가 유효하지 않거나 만료되었을 수 있습니다.
          </p>
          <p className="auth-inline-help__detail">
            비밀번호 재설정을 다시 요청한 뒤 최신 링크를 사용해 주세요.
          </p>
        </div>
        <Link className="auth-secondary-action auth-secondary-action--link" to={FORGOT_PASSWORD_ROUTE}>
          비밀번호 재설정 다시 요청
        </Link>
      </div>
    );
  }

  return (
    <form
      className="auth-form auth-form--recovery"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <div className="field field--with-action">
        <label className="field-label" htmlFor="reset-password-new-password">
          새 비밀번호
        </label>
        <div className="field-control">
          <input
            autoComplete="new-password"
            aria-invalid={passwordInvalid}
            data-testid="reset-password-new-password"
            id="reset-password-new-password"
            name="newPassword"
            onChange={(event) => onPasswordChange(event.target.value)}
            placeholder="새 비밀번호"
            required
            type={showPassword ? 'text' : 'password'}
            value={newPassword}
          />
          <button
            aria-label={showPassword ? '비밀번호 숨기기' : '비밀번호 표시'}
            className="field__action"
            data-testid="reset-password-toggle"
            type="button"
            onClick={onTogglePasswordVisibility}
          >
            {showPassword ? '숨김' : '보기'}
          </button>
        </div>
        <span
          className={`field-hint ${passwordInvalid ? 'field-hint--invalid' : 'field-hint--pending'}`}
          data-testid="reset-password-policy"
        >
          {passwordPolicyMessage}
        </span>
      </div>

      {errorMessage ? (
        <p className="form-message form-message--error" data-testid="reset-password-error" role="alert">
          {errorMessage}
        </p>
      ) : null}

      <button
        className="auth-submit"
        data-testid="reset-password-submit"
        disabled={isSubmitting}
        type="submit"
      >
        {isSubmitting ? '변경 중...' : '새 비밀번호 저장'}
      </button>

      <div className="auth-secondary-links">
        <Link to={FORGOT_PASSWORD_ROUTE}>비밀번호 재설정 링크 다시 요청</Link>
      </div>
    </form>
  );
}
