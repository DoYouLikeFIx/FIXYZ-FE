import { ExternalOrderRecoverySection } from '@/components/order/ExternalOrderRecoverySection';
import { useOrderRecoveryController } from '@/hooks/order/useOrderRecoveryController';
import { hasExternalOrderAccountId } from '@/order/external-order-recovery';
import { useAuthStore } from '@/store/useAuthStore';

export function OrderPage() {
  const member = useAuthStore((state) => state.member);
  const hasOrderAccount = hasExternalOrderAccountId(member?.accountId);
  const orderRecovery = useOrderRecoveryController({
    accountId: member?.accountId,
  });

  return (
    <section className="order-page">
      <article className="portfolio-surface portfolio-surface--guidance">
        <header className="portfolio-card__header">
          <div>
            <p className="status-kicker">Order session</p>
            <h2 className="order-page__title" data-testid="protected-area-title">
              Session-based order flow
            </h2>
          </div>
          <span className="portfolio-card__meta">{member?.accountId ?? '계좌 연동 대기'}</span>
        </header>

        <p className="portfolio-guidance-note">
          주문 준비는 `/api/v1/orders/sessions`에서 시작하고, 필요할 때만 OTP Step B를 거쳐
          최종 execute까지 이어집니다.
        </p>
      </article>

      {hasOrderAccount ? (
        <ExternalOrderRecoverySection
          step={orderRecovery.step}
          feedbackMessage={orderRecovery.feedbackMessage}
          inlineError={orderRecovery.inlineError}
          symbolValue={orderRecovery.symbolValue}
          quantityValue={orderRecovery.quantityValue}
          symbolError={orderRecovery.symbolError}
          quantityError={orderRecovery.quantityError}
          draftSummary={orderRecovery.draftSummary}
          canSubmit={orderRecovery.canSubmit}
          isInteractionLocked={orderRecovery.isInteractionLocked}
          isSubmitting={orderRecovery.isSubmitting}
          isVerifyingOtp={orderRecovery.isVerifyingOtp}
          isExecuting={orderRecovery.isExecuting}
          isExtending={orderRecovery.isExtending}
          isRestoring={orderRecovery.isRestoring}
          presentation={orderRecovery.presentation}
          orderSession={orderRecovery.orderSession}
          authorizationReasonMessage={orderRecovery.authorizationReasonMessage}
          otpValue={orderRecovery.otpValue}
          presets={orderRecovery.presets}
          selectedPresetId={orderRecovery.selectedPresetId}
          onClear={orderRecovery.clear}
          onReset={orderRecovery.reset}
          onRestartExpiredSession={orderRecovery.restartExpiredSession}
          onBackToDraft={orderRecovery.backToDraft}
          onSelectPreset={orderRecovery.selectPreset}
          onSetSymbolValue={orderRecovery.setSymbolValue}
          onSetQuantityValue={orderRecovery.setQuantityValue}
          onSetOtpValue={orderRecovery.setOtpValue}
          onSubmit={orderRecovery.submit}
          onExecute={orderRecovery.execute}
          onExtend={orderRecovery.extend}
        />
      ) : (
        <article
          className="portfolio-surface portfolio-surface--guidance"
          data-testid="order-boundary-unavailable"
        >
          <header className="portfolio-card__header">
            <div>
              <p className="status-kicker">Order session</p>
              <h3>주문 계좌 연동 필요</h3>
            </div>
            <span className="portfolio-card__meta">inactive</span>
          </header>

          <p className="portfolio-guidance-note">
            현재 세션에는 주문 세션 생성에 사용할 계좌 ID가 없습니다. 계좌 연동이
            완료된 사용자에게만 주문 경계를 활성화합니다.
          </p>
        </article>
      )}
    </section>
  );
}
