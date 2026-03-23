import { useEffect, useEffectEvent, useReducer, useRef, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useController, useForm } from 'react-hook-form';

import { fetchAccountPosition } from '@/api/accountApi';
import {
  createOrderSession,
  extendOrderSession,
  executeOrderSession,
  getOrderSession,
  verifyOrderSessionOtp,
} from '@/api/orderApi';
import { getErrorMessage } from '@/lib/errors';
import type { NormalizedApiError } from '@/lib/axios';
import {
  buildExternalOrderDraftSummary,
  buildExternalOrderRequest,
  createInitialExternalOrderDraft,
  draftFromPreset,
  externalOrderPresetOptions,
  matchPresetIdFromDraft,
  normalizeExternalOrderSymbol,
  resolveExternalOrderDraftSelection,
  resolveExternalOrderTypeFromPresetId,
  type ExternalOrderType,
  type ExternalOrderPresetId,
  type ExternalOrderFieldErrors,
} from '@/order/external-order-recovery';
import {
  externalOrderDraftSchema,
  type ExternalOrderDraftFormValues,
} from '@/lib/schemas/order.schema';
import {
  clearPersistedOrderSessionId,
  persistOrderSessionId,
  readPersistedOrderSessionId,
} from '@/order/order-session-storage';
import {
  initialOrderFlowState,
  orderFlowReducer,
} from '@/order/order-flow-state';
import {
  isVisibleExternalOrderError,
  resolveExternalOrderErrorPresentation,
} from '@/order/external-errors';
import {
  getOrderReasonCategoryLabel,
  resolveOrderReasonCategory,
} from '@/order/order-error-category';
import {
  resolveOrderAuthorizationGuidance,
  resolveOrderFinalResultContent,
  resolveOrderProcessingContent,
} from '@/order/order-session-guidance';
import type { AccountPosition } from '@/types/account';
import type {
  OrderSessionResponse,
  OrderSessionStatus,
} from '@/types/order';

const ORDER_STATUS_POLL_INTERVAL_MS = 30_000;
const MARKET_TICKER_POLL_INTERVAL_MS = 5_000;
const POSITION_EXECUTION_RESULTS = new Set([
  'FILLED',
  'PARTIAL_FILL',
  'VIRTUAL_FILL',
  'PARTIAL_FILL_CANCEL',
]);

interface UseOrderRecoveryControllerInput {
  accountId?: string;
}

const canonicalizeErrorCode = (code?: string) =>
  typeof code === 'string' && /^[A-Z]+_[0-9]{3}$/.test(code)
    ? code.replace(/_/g, '-')
    : code;

const getErrorCode = (error: unknown) =>
  typeof error === 'object' && error !== null && 'code' in error
    ? canonicalizeErrorCode((error as Partial<NormalizedApiError>).code)
    : undefined;

const isFinalResultStatus = (status?: OrderSessionStatus | null) =>
  status === 'COMPLETED'
  || status === 'FAILED'
  || status === 'CANCELED';

const isServerExpiredStatus = (status?: OrderSessionStatus | null) => status === 'EXPIRED';

const isPollingStatus = (status?: OrderSessionStatus | null) =>
  status === 'EXECUTING'
  || status === 'REQUERYING'
  || status === 'ESCALATED';

const shouldLoadUpdatedPositionQuantity = (session?: OrderSessionResponse | null) =>
  Boolean(
    session
    && isFinalResultStatus(session.status)
    && session.executionResult
    && POSITION_EXECUTION_RESULTS.has(session.executionResult),
  );

const isSessionExpiredError = (error: unknown) => {
  const code = getErrorCode(error);
  return code === 'ORD-008' || code === 'CHANNEL-001';
};

const resolveInFlightGuidance = (status?: OrderSessionStatus | null) => {
  const processingContent = resolveOrderProcessingContent(status);
  return processingContent?.body ?? null;
};

const resolveFinalResultGuidance = (session: OrderSessionResponse) => {
  if (session.status === 'FAILED') {
    if (session.failureReason === 'OTP_EXCEEDED') {
      return 'OTP 시도 횟수를 초과했습니다. 주문을 다시 시작해 주세요.';
    }
    return '주문이 최종 실패했습니다. 실패 사유를 확인한 뒤 새 주문을 시작해 주세요.';
  }

  return resolveOrderFinalResultContent(session).body;
};

const formatOtpError = (error: NormalizedApiError) => {
  const code = canonicalizeErrorCode(error.code);

  if (code === 'CHANNEL-002' && typeof error.remainingAttempts === 'number') {
    return `OTP 코드가 일치하지 않습니다. 남은 시도 ${error.remainingAttempts}회`;
  }

  if (code === 'AUTH-011') {
    return '이미 사용한 OTP 코드입니다. 새 코드가 표시되면 다시 입력해 주세요.';
  }

  if (code === 'RATE-001') {
    return 'OTP를 너무 빠르게 연속 제출했습니다. 잠시 후 다시 시도해 주세요.';
  }

  if (code === 'ORD-009') {
    return '현재 주문 세션 상태에서는 OTP를 다시 확인할 수 없습니다. 주문 상태를 새로 확인해 주세요.';
  }

  return error.message;
};

const ORDERABILITY_BOUNDARY_GUIDANCE =
  '보유 수량 또는 일일 매도 가능 한도를 확인한 뒤 수량을 조정해 주세요.';
const ORDERABILITY_BOUNDARY_FIELD_ERROR =
  '주문 수량이 현재 주문 가능 범위를 초과했습니다.';
const POSITION_QUANTITY_GUIDANCE =
  '보유 수량을 확인한 뒤 수량을 조정해 주세요.';
const POSITION_QUANTITY_FIELD_ERROR =
  '보유 수량을 다시 확인해 주세요.';
const DAILY_SELL_LIMIT_GUIDANCE =
  '일일 매도 가능 한도를 확인한 뒤 수량을 조정해 주세요.';
const DAILY_SELL_LIMIT_FIELD_ERROR =
  '일일 매도 가능 한도를 초과했습니다.';
const VALIDATION_GUIDANCE =
  '입력값을 확인한 뒤 다시 시도해 주세요.';
const STALE_QUOTE_GUIDANCE =
  '시장가 주문 사전검증에 사용한 시세가 최신이 아닙니다. 대시보드의 quoteAsOf와 source badge를 확인한 뒤 같은 주문을 다시 시작해 주세요.';

type OrderabilityBoundaryType =
  | 'insufficient-position'
  | 'daily-sell-limit'
  | 'generic-orderability';

const isStaleQuoteValidation = (
  normalized: Partial<NormalizedApiError>,
  code?: string,
) => {
  const details = normalized.details;
  const hasStaleQuoteDetails =
    typeof details?.quoteSnapshotId === 'string'
    || typeof details?.quoteSourceMode === 'string'
    || typeof details?.snapshotAgeMs === 'number'
    || typeof details?.symbol === 'string';

  return (
    code === 'VALIDATION-003'
    && (
      normalized.userMessageKey === 'error.quote.stale'
      || normalized.operatorCode === 'STALE_QUOTE'
      || hasStaleQuoteDetails
    )
  );
};

const buildStaleQuoteGuidance = (normalized: Partial<NormalizedApiError>) => {
  const details = normalized.details;
  const detailParts: string[] = [];

  if (details && typeof details.symbol === 'string' && details.symbol.trim()) {
    detailParts.push(`symbol=${details.symbol.trim()}`);
  }

  if (
    details
    && typeof details.quoteSnapshotId === 'string'
    && details.quoteSnapshotId.trim()
  ) {
    detailParts.push(`quoteSnapshotId=${details.quoteSnapshotId.trim()}`);
  }

  if (details && typeof details.quoteSourceMode === 'string' && details.quoteSourceMode.trim()) {
    detailParts.push(`quoteSourceMode=${details.quoteSourceMode.trim()}`);
  }

  if (
    details
    && typeof details.snapshotAgeMs === 'number'
    && Number.isFinite(details.snapshotAgeMs)
    && details.snapshotAgeMs >= 0
  ) {
    detailParts.push(`snapshotAgeMs=${Math.trunc(details.snapshotAgeMs)}`);
  }

  return detailParts.length > 0
    ? `${STALE_QUOTE_GUIDANCE} ${detailParts.join(', ')}`
    : STALE_QUOTE_GUIDANCE;
};

const resolveOrderabilityBoundaryType = (
  normalized: Partial<NormalizedApiError>,
  code?: string,
): OrderabilityBoundaryType => {
  if (
    normalized.userMessageKey === 'error.order.insufficient_position'
    || normalized.operatorCode === 'INSUFFICIENT_POSITION'
    || code === 'ORD-003'
  ) {
    return 'insufficient-position';
  }

  if (
    normalized.userMessageKey === 'error.order.daily_sell_limit_exceeded'
    || normalized.operatorCode === 'DAILY_SELL_LIMIT_EXCEEDED'
    || code === 'ORD-002'
  ) {
    return 'daily-sell-limit';
  }

  return 'generic-orderability';
};

const resolveServerValidationFieldErrors = (
  error: unknown,
): {
  fieldErrors: ExternalOrderFieldErrors;
  guidance: string | null;
  inlineError: string | null;
  staleQuoteGuidance: string | null;
} => {
  if (!(error instanceof Error)) {
    return {
      fieldErrors: {},
      guidance: null,
      inlineError: null,
      staleQuoteGuidance: null,
    };
  }

  const normalized = error as Partial<NormalizedApiError>;
  const code = canonicalizeErrorCode(normalized.code);
  const message = normalized.message ?? '';

  if (code === 'ORD-006' || code === 'ORD-001') {
    return {
      fieldErrors: {},
      guidance: '매수 가능 금액을 확인하거나 수량을 조정한 뒤 다시 시도해 주세요.',
      inlineError: message || null,
      staleQuoteGuidance: null,
    };
  }

  if (code === 'ORD-005' || code === 'ORD-002' || code === 'ORD-003') {
    const orderabilityType = resolveOrderabilityBoundaryType(normalized, code);
    const fieldError =
      orderabilityType === 'insufficient-position'
        ? POSITION_QUANTITY_FIELD_ERROR
        : orderabilityType === 'daily-sell-limit'
          ? DAILY_SELL_LIMIT_FIELD_ERROR
          : message || ORDERABILITY_BOUNDARY_FIELD_ERROR;
    const guidance =
      orderabilityType === 'insufficient-position'
        ? POSITION_QUANTITY_GUIDANCE
        : orderabilityType === 'daily-sell-limit'
          ? DAILY_SELL_LIMIT_GUIDANCE
          : ORDERABILITY_BOUNDARY_GUIDANCE;

    return {
      fieldErrors: {
        quantity: fieldError,
      },
      guidance,
      inlineError: null,
      staleQuoteGuidance: null,
    };
  }

  if (isStaleQuoteValidation(normalized, code)) {
    const staleQuoteGuidance = buildStaleQuoteGuidance(normalized);

    return {
      fieldErrors: {},
      guidance: null,
      inlineError: null,
      staleQuoteGuidance,
    };
  }

  if (code === 'VALIDATION-001' || code === 'VALIDATION-003') {
    return {
      fieldErrors: {},
      guidance: VALIDATION_GUIDANCE,
      inlineError: message || null,
      staleQuoteGuidance: null,
    };
  }

  return {
    fieldErrors: {},
    guidance: null,
    inlineError: null,
    staleQuoteGuidance: null,
  };
};

const buildServerValidationGuidance = (errors: ExternalOrderFieldErrors) => {
  if (errors.symbol && errors.quantity) {
    return '입력값을 수정한 뒤 다시 시도해 주세요.';
  }

  if (errors.symbol) {
    return '종목코드를 수정한 뒤 다시 시도해 주세요.';
  }

  if (errors.quantity) {
    return '수량을 수정한 뒤 다시 시도해 주세요.';
  }

  return null;
};

export const useOrderRecoveryController = ({
  accountId,
}: UseOrderRecoveryControllerInput) => {
  const form = useForm<ExternalOrderDraftFormValues>({
    defaultValues: createInitialExternalOrderDraft(),
    mode: 'onChange',
    reValidateMode: 'onChange',
    resolver: zodResolver(externalOrderDraftSchema),
  });
  const { field: symbolField, fieldState: symbolFieldState } = useController({
    control: form.control,
    name: 'symbol',
  });
  const { field: quantityField, fieldState: quantityFieldState } = useController({
    control: form.control,
    name: 'quantity',
  });
  const [selectedPresetId, setSelectedPresetId] = useState<ExternalOrderPresetId | null>(
    externalOrderPresetOptions[0].id,
  );
  const [selectedOrderType, setSelectedOrderType] = useState<ExternalOrderType>(
    resolveExternalOrderTypeFromPresetId(externalOrderPresetOptions[0].id),
  );
  const [marketTickerPosition, setMarketTickerPosition] = useState<AccountPosition | null>(null);
  const [marketTickerError, setMarketTickerError] = useState<string | null>(null);
  const [isMarketTickerLoading, setIsMarketTickerLoading] = useState(false);
  const [flowState, dispatch] = useReducer(orderFlowReducer, initialOrderFlowState);
  const operationVersionRef = useRef(0);
  const marketTickerPositionRef = useRef<AccountPosition | null>(null);
  const {
    step,
    feedbackMessage,
    staleQuoteGuidance,
    inlineError,
    errorReasonCategory,
    serverFieldErrors,
    presentation,
    orderSession,
    updatedPosition,
    updatedPositionMessage,
    hasDetectedSessionExpiry,
    otpValue,
    isSubmitting,
    isVerifyingOtp,
    isExecuting,
    isRestoring,
    isExtending,
  } = flowState;
  const draft = {
    symbol: symbolField.value ?? '',
    quantity: quantityField.value ?? '',
  };
  const mergedFieldErrors: ExternalOrderFieldErrors = {
    symbol: symbolFieldState.error?.message ?? serverFieldErrors.symbol,
    quantity: quantityFieldState.error?.message ?? serverFieldErrors.quantity,
  };
  const isInteractionLocked =
    isSubmitting || isVerifyingOtp || isExecuting || isRestoring || isExtending;
  const canSubmit =
    externalOrderDraftSchema.safeParse(draft).success
    && !serverFieldErrors.symbol
    && !serverFieldErrors.quantity
    && !isInteractionLocked;
  const marketTickerSymbol = normalizeExternalOrderSymbol(draft.symbol);
  const showMarketTicker =
    step === 'A'
    && selectedOrderType === 'MARKET'
    && Boolean(accountId)
    && /^\d{6}$/.test(marketTickerSymbol);

  useEffect(() => {
    marketTickerPositionRef.current = marketTickerPosition;
  }, [marketTickerPosition]);

  const clearTransientFeedback = (options?: { preservePresentation?: boolean }) => {
    dispatch({
      type: 'clearTransientFeedback',
      preservePresentation: options?.preservePresentation,
    });
  };

  const invalidatePendingOperations = () => {
    operationVersionRef.current += 1;
  };

  const clearServerFieldErrors = (targets?: Array<keyof ExternalOrderFieldErrors>) => {
    dispatch({
      type: 'clearServerFieldErrors',
      targets,
    });
  };

  const persistSessionId = (orderSessionId: string) => {
    persistOrderSessionId(accountId, orderSessionId);
  };

  const clearPersistedSessionId = () => {
    clearPersistedOrderSessionId(accountId);
  };

  const clearUpdatedPositionState = () => {
    dispatch({
      type: 'patch',
      payload: {
        updatedPosition: null,
        updatedPositionMessage: null,
      },
    });
  };

  const resetFlow = (options?: { keepPreset?: boolean; message?: string }) => {
    invalidatePendingOperations();
    clearPersistedSessionId();
    dispatch({
      type: 'reset',
      inlineError: options?.message ?? null,
    });
    if (!options?.keepPreset) {
      form.reset(createInitialExternalOrderDraft());
      setSelectedPresetId(externalOrderPresetOptions[0].id);
      setSelectedOrderType(resolveExternalOrderTypeFromPresetId(externalOrderPresetOptions[0].id));
    }
  };

  const discardDraftSessionContext = () => {
    if (orderSession === null) {
      return;
    }

    invalidatePendingOperations();
    clearPersistedSessionId();
    dispatch({
      type: 'discardDraftSessionContext',
    });
  };

  const goBackToDraft = () => {
    if (orderSession === null) {
      dispatch({
        type: 'patch',
        payload: {
          step: 'A',
        },
      });
      return;
    }

    invalidatePendingOperations();
    dispatch({
      type: 'goBackToDraft',
      feedbackMessage: resolveOrderAuthorizationGuidance(orderSession.authorizationReason),
    });
  };

  const restartExpiredSession = () => {
    resetFlow({
      keepPreset: true,
      message: '주문 세션이 만료되었습니다. 입력한 주문을 확인한 뒤 다시 시작해 주세요.',
    });
  };

  const markSessionExpired = (session?: OrderSessionResponse | null) => {
    const expiredSession = session ?? orderSession;
    if (!expiredSession) {
      resetFlow({
        keepPreset: true,
        message: '주문 세션이 만료되었습니다. 입력한 주문을 확인한 뒤 다시 시작해 주세요.',
      });
      return;
    }

    invalidatePendingOperations();
    clearPersistedSessionId();
    dispatch({
      type: 'markSessionExpired',
      session: expiredSession,
    });
  };

  const applySessionState = (
    session: OrderSessionResponse,
    options?: { restoring?: boolean; preservePresentation?: boolean },
  ) => {
    form.reset({
      symbol: session.symbol,
      quantity: String(session.qty),
    });
    const restoredOrderType = session.orderType === 'MARKET' ? 'MARKET' : 'LIMIT';
    setSelectedOrderType(restoredOrderType);
    setSelectedPresetId(matchPresetIdFromDraft({
      symbol: session.symbol,
      quantity: String(session.qty),
    }, {
      orderType: restoredOrderType,
    }));
    persistSessionId(session.orderSessionId);

    if (session.status === 'AUTHED') {
      dispatch({
        type: 'syncSessionState',
        session,
        step: 'C',
        feedbackMessage: options?.restoring
          ? null
          : resolveOrderAuthorizationGuidance(session.authorizationReason),
        preservePresentation: options?.preservePresentation,
      });
      return;
    }

    if (session.status === 'PENDING_NEW' && session.challengeRequired) {
      dispatch({
        type: 'syncSessionState',
        session,
        step: 'B',
        feedbackMessage: null,
        preservePresentation: options?.preservePresentation,
      });
      return;
    }

    if (isPollingStatus(session.status)) {
      dispatch({
        type: 'syncSessionState',
        session,
        step: 'COMPLETE',
        feedbackMessage: resolveInFlightGuidance(session.status),
        preservePresentation: options?.preservePresentation,
      });
      return;
    }

    if (isFinalResultStatus(session.status)) {
      dispatch({
        type: 'syncSessionState',
        session,
        step: 'COMPLETE',
        feedbackMessage: resolveFinalResultGuidance(session),
        preservePresentation: options?.preservePresentation,
      });
      clearPersistedSessionId();
      return;
    }

    if (isServerExpiredStatus(session.status)) {
      markSessionExpired(session);
      return;
    }

    dispatch({
      type: 'syncSessionState',
      session,
      step: 'A',
      feedbackMessage: null,
      preservePresentation: options?.preservePresentation,
    });
  };
  const applySessionStateEvent = useEffectEvent(applySessionState);
  const resetFlowEvent = useEffectEvent(resetFlow);
  const markSessionExpiredEvent = useEffectEvent(markSessionExpired);

  useEffect(() => {
    if (!accountId) {
      return;
    }

    const storedOrderSessionId = readPersistedOrderSessionId(accountId);
    if (!storedOrderSessionId) {
      return;
    }

    let cancelled = false;

    const restore = async () => {
      dispatch({
        type: 'setBusyFlag',
        flag: 'isRestoring',
        value: true,
      });
      try {
        const session = await getOrderSession(storedOrderSessionId);
        if (!cancelled) {
          applySessionStateEvent(session, { restoring: true });
        }
      } catch (error) {
        if (!cancelled) {
          if (isSessionExpiredError(error)) {
            resetFlowEvent({
              keepPreset: true,
              message: '주문 세션이 만료되었습니다. 입력한 주문을 확인한 뒤 다시 시작해 주세요.',
            });
            return;
          }
          resetFlowEvent({
            keepPreset: true,
            message: getErrorMessage(error),
          });
        }
      } finally {
        if (!cancelled) {
          dispatch({
            type: 'setBusyFlag',
            flag: 'isRestoring',
            value: false,
          });
        }
      }
    };

    void restore();

    return () => {
      cancelled = true;
    };
  }, [accountId]);

  useEffect(() => {
    if (!showMarketTicker || !accountId) {
      marketTickerPositionRef.current = null;
      setMarketTickerPosition(null);
      setMarketTickerError(null);
      setIsMarketTickerLoading(false);
      return;
    }

    let cancelled = false;
    marketTickerPositionRef.current = null;
    setMarketTickerPosition(null);
    setMarketTickerError(null);
    setIsMarketTickerLoading(true);

    const loadMarketTicker = async () => {
      if (!marketTickerPositionRef.current) {
        setIsMarketTickerLoading(true);
      }

      try {
        const position = await fetchAccountPosition({
          accountId,
          symbol: marketTickerSymbol,
        });
        if (cancelled) {
          return;
        }
        marketTickerPositionRef.current = position;
        setMarketTickerPosition(position);
        setMarketTickerError(null);
      } catch (error) {
        if (cancelled) {
          return;
        }
        setMarketTickerError(getErrorMessage(error));
      } finally {
        if (!cancelled) {
          setIsMarketTickerLoading(false);
        }
      }
    };

    void loadMarketTicker();
    const timer = window.setInterval(() => {
      void loadMarketTicker();
    }, MARKET_TICKER_POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [accountId, marketTickerSymbol, showMarketTicker]);

  useEffect(() => {
    const completedOrderSession = orderSession;
    if (!completedOrderSession || !shouldLoadUpdatedPositionQuantity(completedOrderSession)) {
      dispatch({
        type: 'patch',
        payload: {
          updatedPosition: null,
          updatedPositionMessage: null,
        },
      });
      return;
    }

    const queryAccountId = accountId ?? String(completedOrderSession.accountId);
    if (!queryAccountId) {
      dispatch({
        type: 'patch',
        payload: {
          updatedPosition: null,
          updatedPositionMessage: null,
        },
      });
      return;
    }

    let cancelled = false;
    dispatch({
      type: 'patch',
      payload: {
        updatedPosition: null,
        updatedPositionMessage: '현재 보유 수량 확인 중...',
      },
    });

    const loadUpdatedPosition = async () => {
      try {
        const position = await fetchAccountPosition({
          accountId: queryAccountId,
          symbol: completedOrderSession.symbol,
        });
        if (!cancelled) {
          dispatch({
            type: 'patch',
            payload: {
              updatedPosition: position,
              updatedPositionMessage: null,
            },
          });
        }
      } catch {
        if (!cancelled) {
          dispatch({
            type: 'patch',
            payload: {
              updatedPosition: null,
              updatedPositionMessage:
                '현재 보유 수량을 불러오지 못했습니다. 잠시 후 다시 확인해 주세요.',
            },
          });
        }
      }
    };

    void loadUpdatedPosition();

    return () => {
      cancelled = true;
    };
  }, [
    accountId,
    orderSession,
  ]);

  useEffect(() => {
    const pollingOrderSessionId = orderSession?.orderSessionId ?? null;
    const pollingOrderSessionStatus = orderSession?.status ?? null;

    if (!pollingOrderSessionId || !pollingOrderSessionStatus || !isPollingStatus(pollingOrderSessionStatus)) {
      return;
    }

    let cancelled = false;

    const pollOrderSession = async () => {
      try {
        const session = await getOrderSession(pollingOrderSessionId);
        if (!cancelled) {
          applySessionStateEvent(session, {
            restoring: true,
            preservePresentation: presentation !== null && isPollingStatus(session.status),
          });
        }
      } catch (error) {
        if (cancelled) {
          return;
        }

        if (isSessionExpiredError(error)) {
          markSessionExpiredEvent();
          return;
        }

        dispatch({
          type: 'patch',
          payload: {
            inlineError: getErrorMessage(error),
          },
        });
      }
    };

    const timer = window.setInterval(() => {
      void pollOrderSession();
    }, ORDER_STATUS_POLL_INTERVAL_MS);
    void pollOrderSession();

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [orderSession?.orderSessionId, orderSession?.status, presentation]);

  const handleSubmit = async () => {
    void form.handleSubmit(async (values) => {
      if (isSubmitting || isVerifyingOtp || isExecuting) {
        return;
      }

      const request = buildExternalOrderRequest({
        accountId,
        symbol: values.symbol,
        quantity: values.quantity,
        orderType: selectedOrderType,
      });

      if (!request) {
        dispatch({
          type: 'patch',
          payload: {
            errorReasonCategory: null,
            inlineError: '주문에 사용할 계좌 정보를 확인할 수 없습니다.',
            presentation: null,
          },
        });
        return;
      }

      clearTransientFeedback();
      clearServerFieldErrors();
      clearUpdatedPositionState();
      dispatch({
        type: 'setBusyFlag',
        flag: 'isSubmitting',
        value: true,
      });
      const operationVersion = ++operationVersionRef.current;

      try {
        const session = await createOrderSession(request);
        if (operationVersion === operationVersionRef.current) {
          applySessionState(session);
        }
      } catch (error) {
        if (operationVersion !== operationVersionRef.current) {
          return;
        }

        const validationPresentation = resolveServerValidationFieldErrors(error);
        const reasonCategory = resolveOrderReasonCategory(getErrorCode(error)) ?? 'validation';
        if (
          validationPresentation.fieldErrors.symbol
          || validationPresentation.fieldErrors.quantity
        ) {
          dispatch({
            type: 'patch',
            payload: {
              errorReasonCategory: reasonCategory,
              serverFieldErrors: validationPresentation.fieldErrors,
              inlineError: validationPresentation.inlineError,
              staleQuoteGuidance: validationPresentation.staleQuoteGuidance,
              feedbackMessage:
                validationPresentation.guidance
                ?? buildServerValidationGuidance(validationPresentation.fieldErrors),
            },
          });
          return;
        }

        if (
          validationPresentation.guidance
          || validationPresentation.inlineError
          || validationPresentation.staleQuoteGuidance
        ) {
          dispatch({
            type: 'patch',
            payload: {
              errorReasonCategory: reasonCategory,
              feedbackMessage: validationPresentation.guidance,
              inlineError: validationPresentation.inlineError,
              staleQuoteGuidance: validationPresentation.staleQuoteGuidance,
            },
          });
          return;
        }

        dispatch({
          type: 'patch',
          payload: {
            errorReasonCategory: resolveOrderReasonCategory(getErrorCode(error)),
            staleQuoteGuidance: null,
            inlineError: getErrorMessage(error),
          },
        });
      } finally {
        if (operationVersion === operationVersionRef.current) {
          dispatch({
            type: 'setBusyFlag',
            flag: 'isSubmitting',
            value: false,
          });
        }
      }
    }, () => {
      clearTransientFeedback();
    })();
  };

  const handleVerifyOtp = async (value: string) => {
    if (!orderSession || isVerifyingOtp || value.length !== 6) {
      return;
    }

    clearTransientFeedback();
    dispatch({
      type: 'setBusyFlag',
      flag: 'isVerifyingOtp',
      value: true,
    });
    const operationVersion = ++operationVersionRef.current;

    try {
      const session = await verifyOrderSessionOtp(orderSession.orderSessionId, value);
      if (operationVersion !== operationVersionRef.current) {
        return;
      }

      dispatch({
        type: 'setOtpValue',
        value: '',
      });
      applySessionState(session);
    } catch (error) {
      if (operationVersion !== operationVersionRef.current) {
        return;
      }

      const normalized = error as NormalizedApiError;
      dispatch({
        type: 'setOtpValue',
        value: '',
      });
      if (isSessionExpiredError(normalized)) {
        markSessionExpired();
        return;
      }

      if (getErrorCode(normalized) === 'CHANNEL-003') {
        resetFlow({
          keepPreset: true,
          message: 'OTP 시도 횟수를 모두 사용했습니다. 새 주문을 다시 시작해 주세요.',
        });
        return;
      }

      if (getErrorCode(normalized) === 'ORD-009') {
        try {
          const session = await getOrderSession(orderSession.orderSessionId);
          if (operationVersion !== operationVersionRef.current) {
            return;
          }
          applySessionState(session);
          return;
        } catch (refreshError) {
          if (operationVersion !== operationVersionRef.current) {
            return;
          }
          if (isSessionExpiredError(refreshError)) {
            markSessionExpired();
            return;
          }
        }
      }

      dispatch({
        type: 'patch',
        payload: {
          errorReasonCategory: resolveOrderReasonCategory(getErrorCode(normalized)),
          inlineError: formatOtpError(normalized),
        },
      });
    } finally {
      if (operationVersion === operationVersionRef.current) {
        dispatch({
          type: 'setBusyFlag',
          flag: 'isVerifyingOtp',
          value: false,
        });
      }
    }
  };

  const refreshOrderSessionState = async (
    currentOrderSessionId: string,
    operationVersion: number,
    options?: { preservePresentation?: boolean },
  ) => {
    try {
      const session = await getOrderSession(currentOrderSessionId);
      if (operationVersion !== operationVersionRef.current) {
        return true;
      }
      applySessionState(session, {
        preservePresentation:
          options?.preservePresentation && !isFinalResultStatus(session.status),
      });
      return true;
    } catch (error) {
      if (operationVersion !== operationVersionRef.current) {
        return true;
      }
      if (isSessionExpiredError(error)) {
        markSessionExpired();
        return true;
      }
      return false;
    }
  };

  const handleExecute = async () => {
    if (!orderSession || isExecuting) {
      return;
    }

    clearTransientFeedback();
    clearUpdatedPositionState();
    dispatch({
      type: 'setBusyFlag',
      flag: 'isExecuting',
      value: true,
    });
    const operationVersion = ++operationVersionRef.current;

    try {
      const session = await executeOrderSession(orderSession.orderSessionId);
      if (operationVersion === operationVersionRef.current) {
        applySessionState(session);
      }
    } catch (error) {
      if (operationVersion !== operationVersionRef.current) {
        return;
      }

      if (isSessionExpiredError(error)) {
        markSessionExpired();
        return;
      }

      if (getErrorCode(error) === 'ORD-009') {
        const handled = await refreshOrderSessionState(orderSession.orderSessionId, operationVersion);
        if (handled) {
          return;
        }
      }

      if (isVisibleExternalOrderError(error)) {
        const nextPresentation = resolveExternalOrderErrorPresentation(error);
        dispatch({
          type: 'patch',
          payload: {
            presentation: nextPresentation,
            errorReasonCategory: nextPresentation.reasonCategory,
          },
        });
        const handled = await refreshOrderSessionState(
          orderSession.orderSessionId,
          operationVersion,
          { preservePresentation: true },
        );
        if (handled) {
          return;
        }
        return;
      }
      dispatch({
        type: 'patch',
        payload: {
          errorReasonCategory: resolveOrderReasonCategory(getErrorCode(error)),
          inlineError: getErrorMessage(error),
        },
      });
    } finally {
      if (operationVersion === operationVersionRef.current) {
        dispatch({
          type: 'setBusyFlag',
          flag: 'isExecuting',
          value: false,
        });
      }
    }
  };

  const handleExtend = async () => {
    if (!orderSession || isExtending) {
      return;
    }

    clearTransientFeedback();
    dispatch({
      type: 'setBusyFlag',
      flag: 'isExtending',
      value: true,
    });
    const operationVersion = ++operationVersionRef.current;

    try {
      const session = await extendOrderSession(orderSession.orderSessionId);
      if (operationVersion === operationVersionRef.current) {
        applySessionState(session);
      }
    } catch (error) {
      if (operationVersion !== operationVersionRef.current) {
        return;
      }
      if (isSessionExpiredError(error)) {
        markSessionExpired();
        return;
      }
      dispatch({
        type: 'patch',
        payload: {
          errorReasonCategory: resolveOrderReasonCategory(getErrorCode(error)),
          inlineError: getErrorMessage(error),
        },
      });
    } finally {
      if (operationVersion === operationVersionRef.current) {
        dispatch({
          type: 'setBusyFlag',
          flag: 'isExtending',
          value: false,
        });
      }
    }
  };

  return {
    step,
    feedbackMessage,
    staleQuoteGuidance,
    inlineError,
    errorReasonCategoryLabel: getOrderReasonCategoryLabel(errorReasonCategory),
    isSubmitting,
    isVerifyingOtp,
    isExecuting,
    isExtending,
    isRestoring,
    presentation,
    orderSession,
    updatedPositionQuantity: updatedPosition?.quantity ?? null,
    updatedPositionQuantityMessage: updatedPositionMessage,
    hasDetectedSessionExpiry,
    otpValue,
    authorizationReasonMessage: orderSession
      ? resolveOrderAuthorizationGuidance(orderSession.authorizationReason)
      : null,
    symbolValue: draft.symbol,
    quantityValue: draft.quantity,
    symbolError: mergedFieldErrors.symbol ?? null,
    quantityError: mergedFieldErrors.quantity ?? null,
    draftSummary: buildExternalOrderDraftSummary(draft, {
      orderType: selectedOrderType,
    }),
    marketTicker: showMarketTicker ? {
      symbol: marketTickerSymbol,
      marketPrice: marketTickerPosition?.marketPrice ?? null,
      quoteAsOf: marketTickerPosition?.quoteAsOf ?? null,
      quoteSourceMode: marketTickerPosition?.quoteSourceMode ?? null,
      isLoading: isMarketTickerLoading,
      error: marketTickerError,
    } : null,
    canSubmit,
    isInteractionLocked,
    presets: externalOrderPresetOptions,
    selectedPresetId,
    clear: () => {
      clearTransientFeedback();
    },
    reset: () => {
      resetFlow({ keepPreset: true });
    },
    restartExpiredSession,
    selectPreset: (presetId: ExternalOrderPresetId) => {
      clearTransientFeedback();
      setSelectedOrderType(resolveExternalOrderTypeFromPresetId(presetId));
      setSelectedPresetId(presetId);
      form.reset(draftFromPreset(presetId));
      if (orderSession !== null) {
        resetFlow({ keepPreset: true });
      }
    },
    backToDraft: goBackToDraft,
    setSymbolValue: (value: string) => {
      clearTransientFeedback();
      clearServerFieldErrors(['symbol']);
      if (orderSession !== null && step === 'A') {
        discardDraftSessionContext();
      }
      const normalizedSymbol = normalizeExternalOrderSymbol(value).slice(0, 6);
      const nextDraft = {
        ...draft,
        symbol: normalizedSymbol,
      };
      symbolField.onChange(normalizedSymbol);
      const nextSelection = resolveExternalOrderDraftSelection(nextDraft, selectedOrderType);
      setSelectedOrderType(nextSelection.orderType);
      setSelectedPresetId(nextSelection.presetId);
    },
    setQuantityValue: (value: string) => {
      clearTransientFeedback();
      clearServerFieldErrors(['quantity']);
      if (orderSession !== null && step === 'A') {
        discardDraftSessionContext();
      }
      const nextDraft = {
        ...draft,
        quantity: value.replace(/[^\d]/g, '').slice(0, 6),
      };
      quantityField.onChange(nextDraft.quantity);
      const nextSelection = resolveExternalOrderDraftSelection(nextDraft, selectedOrderType);
      setSelectedOrderType(nextSelection.orderType);
      setSelectedPresetId(nextSelection.presetId);
    },
    setOtpValue: (value: string) => {
      const nextValue = value.replace(/\D/g, '').slice(0, 6);
      dispatch({
        type: 'setOtpValue',
        value: nextValue,
      });
      if (nextValue.length === 6) {
        void handleVerifyOtp(nextValue);
      }
    },
    submit: handleSubmit,
    execute: handleExecute,
    extend: handleExtend,
  };
};
