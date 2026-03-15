import { ExternalOrderErrorPanel } from '@/components/order/ExternalOrderErrorPanel';
import { useExpiryCountdown } from '@/hooks/auth/useTotpHelpers';
import { formatKRW, formatQuantity } from '@/utils/formatters';
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
  hasDetectedSessionExpiry: boolean;
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

const isProcessingStatus = (status?: string) =>
  status === 'EXECUTING' || status === 'REQUERYING';

const isManualReviewStatus = (status?: string) => status === 'ESCALATED';

const isFinalResultStatus = (status?: string) =>
  status === 'COMPLETED'
  || status === 'FAILED'
  || status === 'CANCELED';

const resolveProcessingTitle = (status?: string) => {
  if (status === 'REQUERYING') {
    return '주문 체결 결과를 다시 확인하고 있어요';
  }

  return '주문을 거래소에 전송했어요';
};

const resolveProcessingBody = (status?: string) => {
  if (status === 'REQUERYING') {
    return '체결 결과를 재조회하는 중입니다. 완료로 간주하지 말고 상태가 바뀔 때까지 기다려 주세요.';
  }

  return '체결 결과가 아직 확정되지 않았습니다. 잠시 후 상태가 자동으로 갱신됩니다.';
};

const resolveResultTitle = (session: OrderSessionResponse) => {
  if (session.status === 'FAILED') {
    return '주문이 실패했습니다';
  }

  if (session.status === 'CANCELED') {
    if (session.executionResult === 'PARTIAL_FILL_CANCEL') {
      return '일부 체결 후 나머지 수량이 취소되었습니다';
    }

    return '주문이 취소되었습니다';
  }

  if (session.executionResult === 'PARTIAL_FILL') {
    return '주문이 일부 체결되었습니다';
  }

  if (session.executionResult === 'VIRTUAL_FILL') {
    return '주문이 승인 처리되었습니다';
  }

  return '주문이 체결되었습니다';
};

const resolveResultBody = (session: OrderSessionResponse) => {
  if (session.status === 'FAILED') {
    return '실패 사유를 확인한 뒤 주문 조건을 조정해 다시 시도해 주세요.';
  }

  if (session.status === 'CANCELED') {
    if (session.executionResult === 'PARTIAL_FILL_CANCEL') {
      return '체결된 수량과 취소된 잔여 수량을 함께 확인해 주세요.';
    }

    return '취소 결과를 확인한 뒤 필요하면 새 주문을 시작해 주세요.';
  }

  if (session.executionResult === 'PARTIAL_FILL') {
    return '체결 수량과 남은 수량을 확인한 뒤 필요하면 새 주문을 시작해 주세요.';
  }

  return '주문 결과 요약을 확인해 주세요.';
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
  hasDetectedSessionExpiry,
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
  const hasActiveSession = orderSession != null && step !== 'COMPLETE';
  const showExpiredModal =
    hasActiveSession && (countdown.isExpired || hasDetectedSessionExpiry);
  const showExpiryWarning = hasActiveSession && countdown.isExpiringSoon && !showExpiredModal;
  const isExpiredInteractionLocked = isInteractionLocked || showExpiredModal;
  const showProcessingState =
    step === 'COMPLETE' && orderSession != null && isProcessingStatus(orderSession.status);
  const showManualReviewState =
    step === 'COMPLETE' && orderSession != null && isManualReviewStatus(orderSession.status);
  const showResultState =
    step === 'COMPLETE' && orderSession != null && isFinalResultStatus(orderSession.status);
  const expiredModalMessage = countdown.isExpired
    ? `${countdown.expiresAtLabel}에 세션이 종료되었습니다. 입력한 주문을 확인한 뒤 다시 시작해 주세요.`
    : '주문 세션이 더 이상 유효하지 않습니다. 입력한 주문을 확인한 뒤 다시 시작해 주세요.';

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
          <strong>{orderSession.symbol}</strong> · {formatQuantity(orderSession.qty)}주 ·{' '}
          {orderSession.price === null ? '시장가' : formatKRW(orderSession.price)} · 상태{' '}
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
        <>
          {showProcessingState ? (
            <div
              className="external-order-recovery__feedback"
              data-testid="order-session-processing"
            >
              <p data-testid="order-session-processing-title">
                {resolveProcessingTitle(orderSession.status)}
              </p>
              <p>{resolveProcessingBody(orderSession.status)}</p>
              <p data-testid="order-result-clordid">ClOrdID · {orderSession.clOrdId}</p>
            </div>
          ) : null}

          {showManualReviewState ? (
            <div
              className="external-order-recovery__feedback"
              data-testid="order-session-manual-review"
            >
              <p>처리 중 문제가 발생해 수동 확인이 필요합니다.</p>
              <p>주문 번호를 확인한 뒤 고객센터에 문의해 주세요.</p>
              <p data-testid="order-result-clordid">ClOrdID · {orderSession.clOrdId}</p>
            </div>
          ) : null}

          {showResultState ? (
            <div className="external-order-recovery__feedback" data-testid="order-session-result">
              <p data-testid="order-session-result-title">{resolveResultTitle(orderSession)}</p>
              <p>{resolveResultBody(orderSession)}</p>
              <p data-testid="order-result-clordid">ClOrdID · {orderSession.clOrdId}</p>
              {orderSession.externalOrderId ? (
                <p data-testid="order-result-external-id">
                  거래소 주문번호 · {orderSession.externalOrderId}
                </p>
              ) : null}
              {orderSession.executionResult ? (
                <p data-testid="order-result-execution-result">
                  실행 결과 · {orderSession.executionResult}
                </p>
              ) : null}
              {orderSession.executedQty !== null && orderSession.executedQty !== undefined ? (
                <p data-testid="order-result-executed-qty">
                  체결 수량 · {formatQuantity(orderSession.executedQty)}주
                </p>
              ) : null}
              {orderSession.executedPrice !== null && orderSession.executedPrice !== undefined ? (
                <p data-testid="order-result-executed-price">
                  체결 단가 · {formatKRW(orderSession.executedPrice)}
                </p>
              ) : null}
              {orderSession.leavesQty !== null && orderSession.leavesQty !== undefined ? (
                <p data-testid="order-result-leaves-qty">
                  잔여 수량 · {formatQuantity(orderSession.leavesQty)}주
                </p>
              ) : null}
              {orderSession.canceledAt ? (
                <p data-testid="order-result-canceled-at">
                  취소 시각 · {orderSession.canceledAt}
                </p>
              ) : null}
              {orderSession.failureReason ? (
                <p data-testid="order-result-failure-reason">
                  실패 사유 · {orderSession.failureReason}
                </p>
              ) : null}
            </div>
          ) : null}

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
        </>
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
            <p className="external-order-recovery__modal-body">{expiredModalMessage}</p>
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
