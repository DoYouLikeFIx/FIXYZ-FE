import { ExternalOrderErrorPanel } from '@/components/order/ExternalOrderErrorPanel';
import { useExpiryCountdown } from '@/hooks/auth/useTotpHelpers';
import type {
  ExternalOrderPresetId,
  ExternalOrderPresetOption,
} from '@/order/external-order-recovery';
import type { ExternalOrderErrorPresentation } from '@/order/external-errors';
import type { OrderSessionResponse } from '@/api/orderApi';

interface ExternalOrderRecoverySectionProps {
  step: 'A' | 'B' | 'C' | 'COMPLETE';
  feedbackMessage: string | null;
  inlineError: string | null;
  symbolValue: string;
  quantityValue: string;
  symbolError: string | null;
  quantityError: string | null;
  draftSummary: string;
  canSubmit: boolean;
  isInteractionLocked: boolean;
  isSubmitting: boolean;
  isVerifyingOtp: boolean;
  isExecuting: boolean;
  isExtending: boolean;
  isRestoring: boolean;
  presentation: ExternalOrderErrorPresentation | null;
  orderSession: OrderSessionResponse | null;
  authorizationReasonMessage: string;
  otpValue: string;
  presets: readonly ExternalOrderPresetOption[];
  selectedPresetId: ExternalOrderPresetId | null;
  onClear: () => void;
  onReset: () => void;
  onRestartExpiredSession: () => void;
  onBackToDraft: () => void;
  onSelectPreset: (presetId: ExternalOrderPresetId) => void;
  onSetSymbolValue: (value: string) => void;
  onSetQuantityValue: (value: string) => void;
  onSetOtpValue: (value: string) => void;
  onSubmit: () => void;
  onExecute: () => void;
  onExtend: () => void;
}

const EMPTY_EXPIRY = '1970-01-01T00:00:00Z';

const stepLabel = (step: 'A' | 'B' | 'C' | 'COMPLETE') => {
  if (step === 'COMPLETE') {
    return 'Complete';
  }
  return `Step ${step}`;
};

export function ExternalOrderRecoverySection({
  step,
  feedbackMessage,
  inlineError,
  symbolValue,
  quantityValue,
  symbolError,
  quantityError,
  draftSummary,
  canSubmit,
  isInteractionLocked,
  isSubmitting,
  isVerifyingOtp,
  isExecuting,
  isExtending,
  isRestoring,
  presentation,
  orderSession,
  authorizationReasonMessage,
  otpValue,
  presets,
  selectedPresetId,
  onClear,
  onReset,
  onRestartExpiredSession,
  onBackToDraft,
  onSelectPreset,
  onSetSymbolValue,
  onSetQuantityValue,
  onSetOtpValue,
  onSubmit,
  onExecute,
  onExtend,
}: ExternalOrderRecoverySectionProps) {
  const countdown = useExpiryCountdown(orderSession?.expiresAt ?? EMPTY_EXPIRY);
  const hasActiveSession = orderSession !== null && step !== 'COMPLETE';
  const showExpiredModal = hasActiveSession && countdown.isExpired;
  const showExpiryWarning = hasActiveSession && countdown.isExpiringSoon && !showExpiredModal;
  const isExpiredInteractionLocked = isInteractionLocked || showExpiredModal;

  return (
    <article className="portfolio-surface portfolio-surface--guidance external-order-recovery">
      <header className="portfolio-card__header">
        <div>
          <p className="status-kicker">Order Session</p>
          <h3>주문 Step A/B/C</h3>
        </div>
        <span className="portfolio-card__meta">{stepLabel(step)}</span>
      </header>

      <p className="portfolio-guidance-note">
        주문은 `create → conditional OTP verify → execute` 순서로 진행됩니다. 세션이 남아
        있으면 새로고침 뒤에도 같은 상태를 복원합니다.
      </p>

      <div className="portfolio-preview-switch" role="tablist" aria-label="주문 예시 선택">
        {presets.map((preset) => (
          <button
            key={preset.id}
            type="button"
            role="tab"
            aria-selected={selectedPresetId === preset.id}
            className={`portfolio-preview-switch__button ${
              selectedPresetId === preset.id
                ? 'portfolio-preview-switch__button--active'
                : ''
            }`}
            data-testid={`external-order-preset-${preset.id}`}
            disabled={isExpiredInteractionLocked}
            onClick={() => onSelectPreset(preset.id)}
          >
            {preset.label}
          </button>
        ))}
      </div>

      <p className="portfolio-guidance-note" data-testid="order-session-selected-summary">
        현재 입력: {draftSummary}
      </p>

      {orderSession ? (
        <div className="external-order-recovery__feedback" data-testid="order-session-summary">
          <strong>{orderSession.symbol}</strong> · {orderSession.qty}주 ·{' '}
          {orderSession.price === null ? '시장가' : `${orderSession.price.toLocaleString()}원`} · 상태{' '}
          {orderSession.status}
        </div>
      ) : null}

      {showExpiryWarning ? (
        <div className="external-order-recovery__warning" data-testid="order-session-warning">
          <div className="external-order-recovery__warning-copy">
            <p className="external-order-recovery__warning-title">주문 세션이 곧 만료돼요</p>
            <p className="external-order-recovery__warning-note">
              {countdown.remainingLabel} · 연장하면 입력한 주문은 그대로 유지돼요.
            </p>
          </div>
          <button
            type="button"
            className="portfolio-action portfolio-action--secondary external-order-recovery__warning-action"
            data-testid="order-session-extend"
            disabled={isExtending || showExpiredModal}
            onClick={onExtend}
          >
            {isExtending ? '세션 연장 중...' : '세션 60분 연장'}
          </button>
        </div>
      ) : null}

      {feedbackMessage ? (
        <p className="external-order-recovery__feedback" data-testid="external-order-feedback">
          {feedbackMessage}
        </p>
      ) : null}

      {inlineError ? (
        <p
          className="external-order-recovery__feedback"
          data-testid="order-session-error"
          role="alert"
        >
          {inlineError}
        </p>
      ) : null}

      {step === 'A' ? (
        <>
          <div className="external-order-recovery__field-group">
            <label className="portfolio-guidance-note" htmlFor="order-input-symbol">
              종목코드
            </label>
            <input
              id="order-input-symbol"
              data-testid="order-input-symbol"
              inputMode="numeric"
              maxLength={6}
              value={symbolValue}
              disabled={isSubmitting || isRestoring || showExpiredModal}
              onChange={(event) => onSetSymbolValue(event.target.value)}
            />
            {symbolError ? (
              <p
                className="external-order-recovery__feedback"
                data-testid="order-input-symbol-error"
                role="alert"
              >
                {symbolError}
              </p>
            ) : null}
          </div>
          <div className="external-order-recovery__field-group">
            <label className="portfolio-guidance-note" htmlFor="order-input-qty">
              수량
            </label>
            <input
              id="order-input-qty"
              data-testid="order-input-qty"
              inputMode="numeric"
              maxLength={6}
              value={quantityValue}
              disabled={isSubmitting || isRestoring || showExpiredModal}
              onChange={(event) => onSetQuantityValue(event.target.value)}
            />
            {quantityError ? (
              <p
                className="external-order-recovery__feedback"
                data-testid="order-input-qty-error"
                role="alert"
              >
                {quantityError}
              </p>
            ) : null}
          </div>
          <div className="external-order-recovery__actions">
            <button
              type="button"
              className="portfolio-action portfolio-action--primary"
              data-testid="order-session-create"
              disabled={!canSubmit || showExpiredModal}
              onClick={onSubmit}
            >
              {isSubmitting ? '주문 세션 생성 중...' : 'Step A 시작'}
            </button>
            <button
              type="button"
              className="portfolio-action portfolio-action--secondary"
              data-testid="external-order-recovery-clear"
              disabled={
                showExpiredModal
                || (feedbackMessage === null && inlineError === null && presentation === null)
              }
              onClick={onClear}
            >
              안내 지우기
            </button>
          </div>
        </>
      ) : null}

      {step === 'B' ? (
        <>
          <div className="external-order-recovery__feedback" data-testid="order-session-authorization-message">
            {authorizationReasonMessage}
          </div>
          <label className="portfolio-guidance-note" htmlFor="order-session-otp-input">
            Step B OTP 6자리
          </label>
          <input
            id="order-session-otp-input"
            data-testid="order-session-otp-input"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={otpValue}
            disabled={isVerifyingOtp || showExpiredModal}
            onChange={(event) => onSetOtpValue(event.target.value)}
          />
          <div className="external-order-recovery__actions">
            <button
              type="button"
              className="portfolio-action portfolio-action--secondary"
              data-testid="order-session-reset"
              disabled={showExpiredModal}
              onClick={onBackToDraft}
            >
              Step A로 돌아가기
            </button>
          </div>
        </>
      ) : null}

      {step === 'C' ? (
        <>
          <div className="external-order-recovery__feedback" data-testid="order-session-authorization-message">
            {authorizationReasonMessage}
          </div>
          <div className="external-order-recovery__actions">
            <button
              type="button"
              className="portfolio-action portfolio-action--primary"
              data-testid="order-session-execute"
              disabled={isExecuting || showExpiredModal}
              onClick={onExecute}
            >
              {isExecuting ? '주문 실행 중...' : '주문 실행'}
            </button>
            <button
              type="button"
              className="portfolio-action portfolio-action--secondary"
              data-testid="order-session-reset"
              disabled={isExecuting || showExpiredModal}
              onClick={onReset}
            >
              새 주문
            </button>
          </div>
        </>
      ) : null}

      {step === 'COMPLETE' ? (
        <div className="external-order-recovery__actions">
          <button
            type="button"
            className="portfolio-action portfolio-action--secondary"
            data-testid="order-session-reset"
            onClick={onReset}
          >
            새 주문 시작
          </button>
        </div>
      ) : null}

      {presentation ? (
        <ExternalOrderErrorPanel presentation={presentation} />
      ) : null}

      {showExpiredModal ? (
        <div
          className="external-order-recovery__modal-overlay"
          data-testid="order-session-expired-modal"
        >
          <div className="external-order-recovery__modal" role="dialog" aria-modal="true">
            <p className="external-order-recovery__modal-title">주문 세션이 만료되었어요</p>
            <p className="external-order-recovery__modal-body">
              {countdown.expiresAtLabel}에 세션이 종료되었습니다. 입력한 주문을 확인한 뒤
              다시 시작해 주세요.
            </p>
            <div className="external-order-recovery__modal-actions">
              <button
                type="button"
                className="portfolio-action portfolio-action--primary"
                data-testid="order-session-expired-restart"
                onClick={onRestartExpiredSession}
              >
                새 주문 시작
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </article>
  );
}
