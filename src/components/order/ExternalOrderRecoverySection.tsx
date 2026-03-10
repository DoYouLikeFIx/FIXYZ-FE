import { ExternalOrderErrorPanel } from '@/components/order/ExternalOrderErrorPanel';
import type {
  ExternalOrderPresetId,
  ExternalOrderPresetOption,
} from '@/order/external-order-recovery';
import type { ExternalOrderErrorPresentation } from '@/order/external-errors';

interface ExternalOrderRecoverySectionProps {
  feedbackMessage: string | null;
  isSubmitting: boolean;
  presentation: ExternalOrderErrorPresentation | null;
  presets: readonly ExternalOrderPresetOption[];
  selectedPresetId: ExternalOrderPresetId;
  onClear: () => void;
  onSelectPreset: (presetId: ExternalOrderPresetId) => void;
  onSubmit: () => void;
}

export function ExternalOrderRecoverySection({
  feedbackMessage,
  isSubmitting,
  presentation,
  presets,
  selectedPresetId,
  onClear,
  onSelectPreset,
  onSubmit,
}: ExternalOrderRecoverySectionProps) {
  const selectedPreset =
    presets.find((preset) => preset.id === selectedPresetId) ?? presets[0];

  return (
    <article className="portfolio-surface portfolio-surface--guidance">
      <header className="portfolio-card__header">
        <div>
          <p className="status-kicker">Order Recovery UX</p>
          <h3>주문 오류 안내</h3>
        </div>
        <span className="portfolio-card__meta">{selectedPreset.summary}</span>
      </header>

      <p className="portfolio-guidance-note">
        실제 `/api/v1/orders` 응답에서 FEP 오류가 수신되면 재시도, 대기, 문의 안내를 같은
        의미로 노출합니다.
      </p>

      {feedbackMessage ? (
        <p className="external-order-recovery__feedback" data-testid="external-order-feedback">
          {feedbackMessage}
        </p>
      ) : null}

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
            onClick={() => onSelectPreset(preset.id)}
          >
            {preset.label}
          </button>
        ))}
      </div>

      <div className="external-order-recovery__actions">
        <button
          type="button"
          className="portfolio-action portfolio-action--primary"
          data-testid="external-order-recovery-submit"
          disabled={isSubmitting}
          onClick={onSubmit}
        >
          {isSubmitting ? '주문 요청 전송 중...' : '주문 요청 보내기'}
        </button>
        <button
          type="button"
          className="portfolio-action portfolio-action--secondary"
          data-testid="external-order-recovery-clear"
          disabled={(presentation === null && feedbackMessage === null) || isSubmitting}
          onClick={onClear}
        >
          안내 지우기
        </button>
      </div>

      {presentation ? (
        <ExternalOrderErrorPanel presentation={presentation} />
      ) : feedbackMessage === null ? (
        <div className="external-order-recovery__empty" data-testid="external-order-recovery-empty-state">
          아직 대외 오류를 받지 않았습니다. 주문 요청 뒤 오류가 수신되면 이 영역에 복구 안내가
          나타납니다.
        </div>
      ) : null}
    </article>
  );
}
