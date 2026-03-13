import { Link } from 'react-router-dom';

interface MfaRecoveryEntryFormProps {
  currentPassword: string;
  errorMessage: string | null;
  forgotPasswordHref: string;
  hasRecoveryProof: boolean;
  isAuthenticatedEntry: boolean;
  isSubmitting: boolean;
  suggestedEmail: string;
  onCurrentPasswordChange: (value: string) => void;
  onRetryProofBootstrap: () => void;
  onSubmit: () => void;
}

export function MfaRecoveryEntryForm({
  currentPassword,
  errorMessage,
  forgotPasswordHref,
  hasRecoveryProof,
  isAuthenticatedEntry,
  isSubmitting,
  suggestedEmail,
  onCurrentPasswordChange,
  onRetryProofBootstrap,
  onSubmit,
}: MfaRecoveryEntryFormProps) {
  const shouldShowPasswordEntry = isAuthenticatedEntry && !hasRecoveryProof;

  return (
    <form
      className="auth-form auth-form--recovery"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <div className="auth-inline-help auth-inline-help--mfa" data-testid="mfa-recovery-entry" role="status">
        <strong className="auth-inline-help__title">MFA 복구 안내</strong>
        {hasRecoveryProof ? (
          <>
            <p className="auth-inline-help__body">
              비밀번호 재설정이 완료되어 새 authenticator 등록을 준비하고 있습니다.
            </p>
            <p className="auth-inline-help__detail">
              잠시 후 자동으로 다음 단계로 이동합니다.
            </p>
          </>
        ) : shouldShowPasswordEntry ? (
          <>
            <p className="auth-inline-help__body">
              현재 로그인된 세션을 확인한 뒤 기존 authenticator를 새 기기로 교체합니다.
            </p>
            <p className="auth-inline-help__detail">
              현재 비밀번호를 다시 입력하면 새 authenticator 등록 단계가 시작됩니다.
            </p>
          </>
        ) : (
          <>
            <p className="auth-inline-help__body">
              기존 authenticator를 사용할 수 없으면 비밀번호 재설정을 먼저 완료한 뒤 복구를 이어가야 합니다.
            </p>
            <p className="auth-inline-help__detail">
              {suggestedEmail
                ? `입력했던 이메일(${suggestedEmail})로 비밀번호 재설정을 진행하면 다음 단계로 바로 이어집니다.`
                : '비밀번호 재설정을 완료하면 이 화면에서 새 authenticator 등록으로 이어집니다.'}
            </p>
          </>
        )}
      </div>

      {shouldShowPasswordEntry ? (
        <div className="field">
          <label className="field-label" htmlFor="mfa-recovery-current-password">
            현재 비밀번호
          </label>
          <input
            autoComplete="current-password"
            data-testid="mfa-recovery-current-password"
            id="mfa-recovery-current-password"
            name="currentPassword"
            onChange={(event) => onCurrentPasswordChange(event.target.value)}
            placeholder="현재 비밀번호"
            required
            type="password"
            value={currentPassword}
          />
          <span className="field-hint">
            확인이 완료되면 이전 authenticator는 비활성화되고 새 등록 단계가 시작됩니다.
          </span>
        </div>
      ) : null}

      {errorMessage ? (
        <p className="form-message form-message--error" data-testid="mfa-recovery-error" role="alert">
          {errorMessage}
        </p>
      ) : null}

      {shouldShowPasswordEntry ? (
        <button
          className="auth-submit"
          data-testid="mfa-recovery-submit"
          disabled={isSubmitting}
          type="submit"
        >
          {isSubmitting ? '복구 준비 중...' : '새 authenticator 등록 시작'}
        </button>
      ) : hasRecoveryProof ? (
        <button
          className="auth-secondary-action"
          data-testid="mfa-recovery-retry"
          disabled={isSubmitting}
          type="button"
          onClick={onRetryProofBootstrap}
        >
          {isSubmitting ? '복구 준비 중...' : '복구 단계 다시 시도'}
        </button>
      ) : (
        <div className="auth-secondary-links">
          <Link data-testid="mfa-recovery-open-forgot-password" to={forgotPasswordHref}>
            비밀번호 재설정으로 이동
          </Link>
        </div>
      )}
    </form>
  );
}
