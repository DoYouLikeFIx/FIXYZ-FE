import {
  DEFAULT_SERVER_ERROR_MESSAGE,
  NETWORK_ERROR_MESSAGE,
  TIMEOUT_ERROR_MESSAGE,
} from '@/lib/api-error-messages';
import {
  isVisibleExternalOrderError,
  resolveExternalOrderErrorPresentation,
} from '@/order/external-errors';
import { externalOrderErrorContract } from '../../fixtures/external-order-error-contract';

describe('external order errors', () => {
  it.each(externalOrderErrorContract.cases)(
    'maps contract case $codes/$operatorCode with parity',
    (contractCase) => {
      const error = Object.assign(new Error(contractCase.message), {
        name: 'ApiClientError',
        code: contractCase.codes?.[0],
        operatorCode: contractCase.operatorCode,
        retryAfterSeconds: contractCase.retryAfterSeconds,
        traceId: 'trace-contract-001',
      });
      const presentation = resolveExternalOrderErrorPresentation(error);

      expect(isVisibleExternalOrderError(error)).toBe(true);
      expect(presentation.reasonCategory).toBe(contractCase.reasonCategory);
      expect(presentation.reasonCategoryLabel).toBe('대외');
      expect(presentation.semantic).toBe(contractCase.semantic);
      expect(presentation.recoveryAction).toBe(contractCase.recoveryAction);
      expect(presentation.severity).toBe(contractCase.severity);
      expect(presentation.title).toBe(contractCase.title);
      expect(presentation.message).toBe(contractCase.message);
      expect(presentation.nextStep).toBe(contractCase.nextStep);
      expect(presentation.supportReference).toBe(
        `${externalOrderErrorContract.supportReferenceLabel}: trace-contract-001`,
      );
    },
  );

  it('falls back to unknown guidance without claiming completion', () => {
    const presentation = resolveExternalOrderErrorPresentation(
      Object.assign(new Error('Unknown external state'), {
        name: 'ApiClientError',
        code: 'FEP-999',
        operatorCode: 'UNKNOWN_EXTERNAL_STATE',
        traceId: 'trace-unknown-001',
      }),
    );

    expect(presentation.semantic).toBe(
      externalOrderErrorContract.unknownFallback.semantic,
    );
    expect(presentation.reasonCategory).toBe(
      externalOrderErrorContract.unknownFallback.reasonCategory,
    );
    expect(presentation.title).toBe(externalOrderErrorContract.unknownFallback.title);
    expect(presentation.nextStep).toBe(
      externalOrderErrorContract.unknownFallback.nextStep,
    );
  });

  it.each([
    DEFAULT_SERVER_ERROR_MESSAGE,
    NETWORK_ERROR_MESSAGE,
    TIMEOUT_ERROR_MESSAGE,
  ])('treats transport failures as visible retry guidance: %s', (message) => {
    expect(
      isVisibleExternalOrderError(
        Object.assign(new Error(message), {
          name: 'ApiClientError',
        }),
      ),
    ).toBe(true);
  });

  it('keeps non-external application errors out of the visible contract', () => {
    expect(
      isVisibleExternalOrderError(
        Object.assign(new Error('Invalid order payload'), {
          name: 'ApiClientError',
          code: 'ORD-006',
        }),
      ),
    ).toBe(false);
  });
});
