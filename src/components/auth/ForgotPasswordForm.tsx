import { Link } from 'react-router-dom';

import type { PasswordRecoveryChallengeResponse } from '@/types/auth';
import { buildResetPasswordPath } from '@/router/navigation';

interface ForgotPasswordFormProps {
  email: string;
  challengeAnswer: string;
  emailInvalid: boolean;
  challengeAnswerInvalid: boolean;
  acceptedMessage: string | null;
  errorMessage: string | null;
  isSubmitting: boolean;
  isBootstrappingChallenge: boolean;
  challengeMayBeRequired: boolean;
  challengeState: PasswordRecoveryChallengeResponse | null;
  onEmailChange: (value: string) => void;
  onChallengeAnswerChange: (value: string) => void;
  onBootstrapChallenge: () => void;
  onSubmit: () => void;
}

export function ForgotPasswordForm({
  email,
  challengeAnswer,
  emailInvalid,
  challengeAnswerInvalid,
  acceptedMessage,
  errorMessage,
  isSubmitting,
  isBootstrappingChallenge,
  challengeMayBeRequired,
  challengeState,
  onEmailChange,
  onChallengeAnswerChange,
  onBootstrapChallenge,
  onSubmit,
}: ForgotPasswordFormProps) {
  return (
    <form
      className="auth-form auth-form--recovery"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <div className="field">
        <label className="field-label" htmlFor="forgot-password-email">
          이메일
        </label>
        <input
          autoComplete="email"
          aria-invalid={emailInvalid}
          data-testid="forgot-password-email"
          id="forgot-password-email"
          name="email"
          onChange={(event) => onEmailChange(event.target.value)}
          placeholder="가입한 이메일"
          required
          type="email"
          value={email}
        />
        <span className="field-hint">
          가입한 이메일을 입력하면 계정 존재 여부와 관계없이 동일한 안내가 표시됩니다.
        </span>
      </div>

      {acceptedMessage ? (
        <div className="auth-inline-help" data-testid="forgot-password-accepted" role="status">
          <strong className="auth-inline-help__title">요청이 접수되었습니다.</strong>
          <p className="auth-inline-help__body">{acceptedMessage}</p>
          <p className="auth-inline-help__detail">
            계정이 조건을 충족하면 비밀번호 재설정 메일이 발송됩니다.
          </p>
        </div>
      ) : null}

      {challengeMayBeRequired ? (
        <div className="auth-inline-help auth-inline-help--challenge">
          <strong className="auth-inline-help__title">추가 보안 확인</strong>
          <p className="auth-inline-help__body">
            필요 시 보안 확인 정보를 먼저 받아 같은 이메일로 다시 제출할 수 있습니다.
          </p>
          <button
            className="auth-secondary-action"
            data-testid="forgot-password-bootstrap-challenge"
            disabled={isBootstrappingChallenge || isSubmitting}
            type="button"
            onClick={onBootstrapChallenge}
          >
            {isBootstrappingChallenge ? '보안 확인 준비 중...' : '보안 확인 준비'}
          </button>
        </div>
      ) : null}

      {challengeState ? (
        <div className="auth-inline-help auth-inline-help--challenge" data-testid="forgot-password-challenge-state">
          <strong className="auth-inline-help__title">보안 확인 정보가 준비되었습니다.</strong>
          <p className="auth-inline-help__body">
            유형: {challengeState.challengeType}
          </p>
          <p className="auth-inline-help__detail">
            유효 시간: {challengeState.challengeTtlSeconds}초
          </p>
        </div>
      ) : null}

      {challengeState ? (
        <div className="field">
          <label className="field-label" htmlFor="forgot-password-challenge-answer">
            보안 확인 응답
          </label>
          <input
            aria-invalid={challengeAnswerInvalid}
            data-testid="forgot-password-challenge-answer"
            id="forgot-password-challenge-answer"
            name="challengeAnswer"
            onChange={(event) => onChallengeAnswerChange(event.target.value)}
            placeholder="보안 확인 응답"
            required
            type="text"
            value={challengeAnswer}
          />
        </div>
      ) : null}

      {errorMessage ? (
        <p className="form-message form-message--error" data-testid="forgot-password-error" role="alert">
          {errorMessage}
        </p>
      ) : null}

      <button
        className="auth-submit"
        data-testid="forgot-password-submit"
        disabled={isSubmitting || isBootstrappingChallenge}
        type="submit"
      >
        {isSubmitting ? '요청 중...' : challengeState ? '보안 확인 포함 요청' : '재설정 메일 요청'}
      </button>

      <div className="auth-secondary-links">
        <Link data-testid="forgot-password-open-reset" to={buildResetPasswordPath()}>
          이미 링크를 받으셨나요? 비밀번호 재설정으로 이동
        </Link>
      </div>
    </form>
  );
}
