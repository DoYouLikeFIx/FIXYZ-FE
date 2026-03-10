import type { ExternalOrderErrorPresentation } from '@/order/external-errors';

interface ExternalOrderErrorPanelProps {
  presentation: ExternalOrderErrorPresentation;
  testId?: string;
}

export function ExternalOrderErrorPanel({
  presentation,
  testId = 'external-order-error-panel',
}: ExternalOrderErrorPanelProps) {
  return (
    <section
      className={`external-order-panel external-order-panel--${presentation.severity}`}
      data-testid={testId}
    >
      <div className="external-order-panel__header">
        <p className="external-order-panel__eyebrow">
          {presentation.semantic.replace(/-/g, ' ')}
        </p>
        {presentation.code ? (
          <span className="external-order-panel__code" data-testid="external-order-error-code">
            {presentation.code}
          </span>
        ) : null}
      </div>

      <div className="external-order-panel__body">
        <h3 className="external-order-panel__title" data-testid="external-order-error-title">
          {presentation.title}
        </h3>
        <p className="external-order-panel__message" data-testid="external-order-error-message">
          {presentation.message}
        </p>
        <p className="external-order-panel__next-step" data-testid="external-order-error-next-step">
          {presentation.nextStep}
        </p>
        {presentation.supportReference ? (
          <p
            className="external-order-panel__support"
            data-testid="external-order-error-support-reference"
          >
            {presentation.supportReference}
          </p>
        ) : null}
      </div>
    </section>
  );
}
