import { ExternalOrderErrorPanel } from '@/components/order/ExternalOrderErrorPanel';
import { useExpiryCountdown } from '@/hooks/auth/useTotpHelpers';
import { formatKRW, formatQuantity } from '@/utils/formatters';
import type {
  ExternalOrderPresetId,
  ExternalOrderPresetOption,
} from '@/order/external-order-recovery';
import type { ExternalOrderErrorPresentation } from '@/order/external-errors';
import {
  resolveOrderFinalResultContent,
  resolveOrderProcessingContent,
} from '@/order/order-session-guidance';
import type { OrderFlowStep, OrderSessionResponse } from '@/types/order';

interface ExternalOrderRecoverySectionProps {
  step: OrderFlowStep;
  feedbackMessage: string | null;
  staleQuoteGuidance: string | null;
  inlineError: string | null;
  errorReasonCategoryLabel?: string | null;
  symbolValue: string;
  quantityValue: string;
  symbolError: string | null;
  quantityError: string | null;
  draftSummary: string;
  marketTicker: {
    symbol: string;
    marketPrice: number | null;
    quoteAsOf: string | null;
    quoteSourceMode: string | null;
    isLoading: boolean;
    error: string | null;
  } | null;
  canSubmit: boolean;
  isInteractionLocked: boolean;
  isSubmitting: boolean;
  isVerifyingOtp: boolean;
  isExecuting: boolean;
  isExtending: boolean;
  isRestoring: boolean;
  presentation: ExternalOrderErrorPresentation | null;
  orderSession: OrderSessionResponse | null;
  updatedPositionQuantity?: number | null;
  updatedPositionQuantityMessage?: string | null;
  hasDetectedSessionExpiry: boolean;
  authorizationReasonMessage: string | null;
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
const quoteDateFormatter = new Intl.DateTimeFormat('ko-KR', {
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

const stepLabel = (step: OrderFlowStep) => {
  if (step === 'COMPLETE') {
    return 'Complete';
  }
  return `Step ${step}`;
};

const isProcessingStatus = (status?: OrderSessionResponse['status']) =>
  status === 'EXECUTING' || status === 'REQUERYING';

const isManualReviewStatus = (status?: OrderSessionResponse['status']) => status === 'ESCALATED';

const isFinalResultStatus = (status?: OrderSessionResponse['status']) =>
  status === 'COMPLETED'
  || status === 'FAILED'
  || status === 'CANCELED';

export function ExternalOrderRecoverySection({
  step,
  feedbackMessage,
  staleQuoteGuidance,
  inlineError,
  errorReasonCategoryLabel = null,
  symbolValue,
  quantityValue,
  symbolError,
  quantityError,
  draftSummary,
  marketTicker,
  canSubmit,
  isInteractionLocked,
  isSubmitting,
  isVerifyingOtp,
  isExecuting,
  isExtending,
  isRestoring,
  presentation,
  orderSession,
  updatedPositionQuantity = null,
  updatedPositionQuantityMessage = null,
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
  const processingContent = orderSession ? resolveOrderProcessingContent(orderSession.status) : null;
  const finalResultContent = orderSession ? resolveOrderFinalResultContent(orderSession) : null;
  const hasExpiry = orderSession?.expiresAt != null;
  const hasActiveSession = orderSession != null && step !== 'COMPLETE';
  const showExpiredModal =
    hasActiveSession && ((hasExpiry && countdown.isExpired) || hasDetectedSessionExpiry);
  const showExpiryWarning =
    hasActiveSession && hasExpiry && countdown.isExpiringSoon && !showExpiredModal;
  const isExpiredInteractionLocked = isInteractionLocked || showExpiredModal;
  const showProcessingState =
    step === 'COMPLETE' && orderSession != null && isProcessingStatus(orderSession.status);
  const showManualReviewState =
    step === 'COMPLETE' && orderSession != null && isManualReviewStatus(orderSession.status);
  const showResultState =
    step === 'COMPLETE' && orderSession != null && isFinalResultStatus(orderSession.status);
  const hasCompleteStateCard = showProcessingState || showManualReviewState || showResultState;
  const effectiveFeedbackMessage =
    step === 'COMPLETE' && hasCompleteStateCard ? null : feedbackMessage;
  const showDedicatedStaleQuoteGuidance =
    step !== 'COMPLETE' && staleQuoteGuidance !== null;
  const hasMarketTickerQuote =
    marketTicker?.marketPrice !== null
    && marketTicker?.marketPrice !== undefined
    && Boolean(marketTicker?.quoteAsOf)
    && Boolean(marketTicker?.quoteSourceMode);
  const marketTickerStatus = marketTicker === null
    ? null
    : marketTicker.error
      ? hasMarketTickerQuote
        ? '마지막 시세를 유지 중입니다. 새 ticker를 다시 연결하고 있어요.'
        : '실시간 ticker를 불러오지 못했습니다.'
      : marketTicker.isLoading && !hasMarketTickerQuote
        ? '실시간 ticker 연결 중...'
        : hasMarketTickerQuote
          ? '5초마다 자동 갱신'
          : '실시간 ticker 데이터가 아직 준비되지 않았습니다.';
  const expiredModalMessage = hasExpiry && countdown.isExpired
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

      {effectiveFeedbackMessage ? (
        <div>
          {errorReasonCategoryLabel ? (
            <p className="portfolio-guidance-note" data-testid="order-session-error-category">
              {errorReasonCategoryLabel}
            </p>
          ) : null}
          <p className="external-order-recovery__feedback" data-testid="external-order-feedback">
            {effectiveFeedbackMessage}
          </p>
        </div>
      ) : null}

      {showDedicatedStaleQuoteGuidance ? (
        <div>
          {!effectiveFeedbackMessage && errorReasonCategoryLabel ? (
            <p className="portfolio-guidance-note" data-testid="order-session-error-category">
              {errorReasonCategoryLabel}
            </p>
          ) : null}
          <p
            className="external-order-recovery__feedback"
            data-testid="order-session-stale-quote-guidance"
          >
            {staleQuoteGuidance}
          </p>
        </div>
      ) : null}

      {inlineError ? (
        <div>
          {!effectiveFeedbackMessage && errorReasonCategoryLabel ? (
            <p className="portfolio-guidance-note" data-testid="order-session-error-category">
              {errorReasonCategoryLabel}
            </p>
          ) : null}
          <p
            className="external-order-recovery__feedback"
            data-testid="order-session-error"
            role="alert"
          >
            {inlineError}
          </p>
        </div>
      ) : null}

      {step === 'A' ? (
        <>
          {marketTicker ? (
            <div className="market-order-ticker" data-testid="market-order-live-ticker">
              <div className="market-order-ticker__header">
                <div>
                  <p className="market-order-ticker__title">시장가 실시간 ticker</p>
                  <p
                    className="market-order-ticker__status"
                    data-testid="market-order-live-ticker-status"
                  >
                    {marketTickerStatus}
                  </p>
                </div>
                <span className="portfolio-card__meta">{marketTicker.symbol}</span>
              </div>

              {hasMarketTickerQuote ? (
                <div className="market-order-ticker__grid">
                  <div className="market-order-ticker__cell">
                    <span className="market-order-ticker__label">현재 시세</span>
                    <strong data-testid="market-order-live-ticker-price">
                      {formatKRW(marketTicker.marketPrice ?? 0)}
                    </strong>
                  </div>
                  <div className="market-order-ticker__cell">
                    <span className="market-order-ticker__label">호가 기준 시각</span>
                    <strong data-testid="market-order-live-ticker-quote-as-of">
                      {quoteDateFormatter.format(new Date(marketTicker.quoteAsOf ?? ''))}
                    </strong>
                  </div>
                  <div className="market-order-ticker__cell">
                    <span className="market-order-ticker__label">호가 source</span>
                    <strong data-testid="market-order-live-ticker-source-mode">
                      {marketTicker.quoteSourceMode}
                    </strong>
                  </div>
                </div>
              ) : null}

              {marketTicker.error && !hasMarketTickerQuote ? (
                <p
                  className="external-order-recovery__feedback"
                  data-testid="market-order-live-ticker-error"
                >
                  {marketTicker.error}
                </p>
              ) : null}
            </div>
          ) : null}
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
                || (
                  effectiveFeedbackMessage === null
                  && staleQuoteGuidance === null
                  && inlineError === null
                  && presentation === null
                )
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
          {authorizationReasonMessage ? (
            <div
              className="external-order-recovery__feedback"
              data-testid="order-session-authorization-message"
            >
              {authorizationReasonMessage}
            </div>
          ) : null}
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
          {authorizationReasonMessage ? (
            <div
              className="external-order-recovery__feedback"
              data-testid="order-session-authorization-message"
            >
              {authorizationReasonMessage}
            </div>
          ) : null}
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
              <p data-testid="order-session-processing-title">{processingContent?.title}</p>
              <p data-testid="order-session-processing-body">{processingContent?.body}</p>
              <p data-testid="order-result-clordid">ClOrdID · {orderSession.clOrdId}</p>
            </div>
          ) : null}

          {showManualReviewState ? (
            <div
              className="external-order-recovery__feedback"
              data-testid="order-session-manual-review"
            >
              <p data-testid="order-session-processing-title">{processingContent?.title}</p>
              <p data-testid="order-session-processing-body">{processingContent?.body}</p>
              <p data-testid="order-result-clordid">ClOrdID · {orderSession.clOrdId}</p>
            </div>
          ) : null}

          {showResultState ? (
            <div className="external-order-recovery__feedback" data-testid="order-session-result">
              <p data-testid="order-session-result-title">{finalResultContent?.title}</p>
              <p data-testid="order-session-result-body">{finalResultContent?.body}</p>
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
              {updatedPositionQuantity !== null ? (
                <p data-testid="order-result-position-qty">
                  현재 보유 수량 · {formatQuantity(updatedPositionQuantity)}주
                </p>
              ) : null}
              {updatedPositionQuantity === null && updatedPositionQuantityMessage ? (
                <p data-testid="order-result-position-qty-message">
                  {updatedPositionQuantityMessage}
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
            <p className="external-order-recovery__modal-title">세션이 만료되었습니다</p>
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
