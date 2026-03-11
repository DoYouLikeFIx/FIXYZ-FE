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
            <p className="status-kicker">Order boundary</p>
            <h2 className="order-page__title" data-testid="protected-area-title">
              External error handling
            </h2>
          </div>
          <span className="portfolio-card__meta">{member?.accountId ?? '계좌 연동 대기'}</span>
        </header>

        <p className="portfolio-guidance-note">
          주문 요청은 실제 channel boundary(`/api/v1/orders`)로 전송됩니다. 외부 오류가 반환될 때만
          아래 복구 패널이 나타납니다.
        </p>
      </article>

      {hasOrderAccount ? (
        <ExternalOrderRecoverySection
          feedbackMessage={orderRecovery.feedbackMessage}
          isSubmitting={orderRecovery.isSubmitting}
          presentation={orderRecovery.presentation}
          presets={orderRecovery.presets}
          selectedPresetId={orderRecovery.selectedPresetId}
          onClear={orderRecovery.clear}
          onSelectPreset={orderRecovery.selectPreset}
          onSubmit={orderRecovery.submit}
        />
      ) : (
        <article
          className="portfolio-surface portfolio-surface--guidance"
          data-testid="order-boundary-unavailable"
        >
          <header className="portfolio-card__header">
            <div>
              <p className="status-kicker">Order boundary</p>
              <h3>주문 계좌 연동 필요</h3>
            </div>
            <span className="portfolio-card__meta">inactive</span>
          </header>

          <p className="portfolio-guidance-note">
            현재 세션에는 `/api/v1/orders`에 전달할 주문 계좌 ID가 없습니다. 계좌 연동이
            완료된 사용자에게만 주문 경계를 활성화합니다.
          </p>
        </article>
      )}
    </section>
  );
}
