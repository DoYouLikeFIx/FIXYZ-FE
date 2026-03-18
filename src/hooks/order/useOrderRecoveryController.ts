import { useEffect, useEffectEvent, useRef, useState } from 'react';
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
  isVisibleExternalOrderError,
  resolveExternalOrderErrorPresentation,
  type ExternalOrderErrorPresentation,
} from '@/order/external-errors';
import {
  getOrderReasonCategoryLabel,
  resolveOrderReasonCategory,
  type OrderReasonCategory,
} from '@/order/order-error-category';
import {
  resolveOrderAuthorizationGuidance,
  resolveOrderFinalResultContent,
  resolveOrderProcessingContent,
} from '@/order/order-session-guidance';
import type { AccountPosition } from '@/types/account';
import type {
  OrderFlowStep,
  OrderSessionResponse,
  OrderSessionStatus,
} from '@/types/order';

const ORDER_STATUS_POLL_INTERVAL_MS = 30_000;
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

type OrderabilityBoundaryType =
  | 'insufficient-position'
  | 'daily-sell-limit'
  | 'generic-orderability';

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
} => {
  if (!(error instanceof Error)) {
    return {
      fieldErrors: {},
      guidance: null,
      inlineError: null,
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
    };
  }

  if (code === 'VALIDATION-001' || code === 'VALIDATION-003') {
    return {
      fieldErrors: {},
      guidance: VALIDATION_GUIDANCE,
      inlineError: message || null,
    };
  }

  return {
    fieldErrors: {},
    guidance: null,
    inlineError: null,
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
  const [step, setStep] = useState<OrderFlowStep>('A');
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null);
  const [inlineError, setInlineError] = useState<string | null>(null);
  const [errorReasonCategory, setErrorReasonCategory] =
    useState<OrderReasonCategory | null>(null);
  const [serverFieldErrors, setServerFieldErrors] = useState<ExternalOrderFieldErrors>({});
  const [presentation, setPresentation] =
    useState<ExternalOrderErrorPresentation | null>(null);
  const [orderSession, setOrderSession] = useState<OrderSessionResponse | null>(null);
  const [updatedPosition, setUpdatedPosition] = useState<AccountPosition | null>(null);
  const [updatedPositionMessage, setUpdatedPositionMessage] = useState<string | null>(null);
  const [hasDetectedSessionExpiry, setHasDetectedSessionExpiry] = useState(false);
  const [otpValue, setOtpValueState] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isVerifyingOtp, setIsVerifyingOtp] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const [isExtending, setIsExtending] = useState(false);
  const operationVersionRef = useRef(0);
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

  const clearTransientFeedback = (options?: { preservePresentation?: boolean }) => {
    setFeedbackMessage(null);
    setInlineError(null);
    if (!options?.preservePresentation) {
      setPresentation(null);
      setErrorReasonCategory(null);
    }
  };

  const invalidatePendingOperations = () => {
    operationVersionRef.current += 1;
  };

  const clearServerFieldErrors = (targets?: Array<keyof ExternalOrderFieldErrors>) => {
    if (!targets || targets.length === 0) {
      setServerFieldErrors({});
      return;
    }

    setServerFieldErrors((current) => {
      const next = { ...current };
      for (const target of targets) {
        delete next[target];
      }
      return next;
    });
  };

  const persistSessionId = (orderSessionId: string) => {
    persistOrderSessionId(accountId, orderSessionId);
  };

  const clearPersistedSessionId = () => {
    clearPersistedOrderSessionId(accountId);
  };

  const clearUpdatedPositionState = () => {
    setUpdatedPosition(null);
    setUpdatedPositionMessage(null);
  };

  const resetFlow = (options?: { keepPreset?: boolean; message?: string }) => {
    invalidatePendingOperations();
    clearPersistedSessionId();
    setStep('A');
    setOrderSession(null);
    clearUpdatedPositionState();
    setHasDetectedSessionExpiry(false);
    setOtpValueState('');
    clearServerFieldErrors();
    setPresentation(null);
    setErrorReasonCategory(null);
    setInlineError(options?.message ?? null);
    setFeedbackMessage(null);
    setIsSubmitting(false);
    setIsVerifyingOtp(false);
    setIsExecuting(false);
    setIsExtending(false);
    if (!options?.keepPreset) {
      form.reset(createInitialExternalOrderDraft());
      setSelectedPresetId(externalOrderPresetOptions[0].id);
    }
  };

  const discardDraftSessionContext = () => {
    if (orderSession === null) {
      return;
    }

    invalidatePendingOperations();
    clearPersistedSessionId();
    setOrderSession(null);
    clearUpdatedPositionState();
    setHasDetectedSessionExpiry(false);
    setOtpValueState('');
    setPresentation(null);
    setErrorReasonCategory(null);
    setInlineError(null);
    setFeedbackMessage(null);
    setIsExtending(false);
  };

  const goBackToDraft = () => {
    if (orderSession === null) {
      setStep('A');
      return;
    }

    invalidatePendingOperations();
    setHasDetectedSessionExpiry(false);
    setStep('A');
    setOtpValueState('');
    setIsVerifyingOtp(false);
    clearTransientFeedback();
    setFeedbackMessage(resolveOrderAuthorizationGuidance(orderSession.authorizationReason));
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
    clearServerFieldErrors();
    setPresentation(null);
    clearUpdatedPositionState();
    setErrorReasonCategory(null);
    setFeedbackMessage(null);
    setInlineError(null);
    setOrderSession(expiredSession);
    setHasDetectedSessionExpiry(true);
    setOtpValueState('');
    setIsSubmitting(false);
    setIsVerifyingOtp(false);
    setIsExecuting(false);
    setIsExtending(false);
    setStep(expiredSession.challengeRequired ? 'B' : 'C');
  };

  const applySessionState = (
    session: OrderSessionResponse,
    options?: { restoring?: boolean; preservePresentation?: boolean },
  ) => {
    setOrderSession(session);
    setHasDetectedSessionExpiry(false);
    clearServerFieldErrors();
    form.reset({
      symbol: session.symbol,
      quantity: String(session.qty),
    });
    setSelectedPresetId(matchPresetIdFromDraft({
      symbol: session.symbol,
      quantity: String(session.qty),
    }));
    persistSessionId(session.orderSessionId);
    clearTransientFeedback({
      preservePresentation: options?.preservePresentation,
    });

    if (session.status === 'AUTHED') {
      setStep('C');
      if (!options?.restoring) {
        setFeedbackMessage(resolveOrderAuthorizationGuidance(session.authorizationReason));
      }
      return;
    }

    if (session.status === 'PENDING_NEW' && session.challengeRequired) {
      setStep('B');
      return;
    }

    if (isPollingStatus(session.status)) {
      setStep('COMPLETE');
      setFeedbackMessage(resolveInFlightGuidance(session.status));
      return;
    }

    if (isFinalResultStatus(session.status)) {
      setStep('COMPLETE');
      setFeedbackMessage(resolveFinalResultGuidance(session));
      clearPersistedSessionId();
      return;
    }

    if (isServerExpiredStatus(session.status)) {
      markSessionExpired(session);
      return;
    }

    setStep('A');
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
      setIsRestoring(true);
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
          setIsRestoring(false);
        }
      }
    };

    void restore();

    return () => {
      cancelled = true;
    };
  }, [accountId]);

  useEffect(() => {
    const completedOrderSession = orderSession;
    if (!completedOrderSession || !shouldLoadUpdatedPositionQuantity(completedOrderSession)) {
      setUpdatedPosition(null);
      setUpdatedPositionMessage(null);
      return;
    }

    const queryAccountId = accountId ?? String(completedOrderSession.accountId);
    if (!queryAccountId) {
      setUpdatedPosition(null);
      setUpdatedPositionMessage(null);
      return;
    }

    let cancelled = false;
    setUpdatedPosition(null);
    setUpdatedPositionMessage('현재 보유 수량 확인 중...');

    const loadUpdatedPosition = async () => {
      try {
        const position = await fetchAccountPosition({
          accountId: queryAccountId,
          symbol: completedOrderSession.symbol,
        });
        if (!cancelled) {
          setUpdatedPosition(position);
          setUpdatedPositionMessage(null);
        }
      } catch {
        if (!cancelled) {
          setUpdatedPosition(null);
          setUpdatedPositionMessage(
            '현재 보유 수량을 불러오지 못했습니다. 잠시 후 다시 확인해 주세요.',
          );
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

        setInlineError(getErrorMessage(error));
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
      });

      if (!request) {
        setErrorReasonCategory(null);
        setInlineError('주문에 사용할 계좌 정보를 확인할 수 없습니다.');
        setPresentation(null);
        return;
      }

      clearTransientFeedback();
      clearServerFieldErrors();
      clearUpdatedPositionState();
      setIsSubmitting(true);
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
          setErrorReasonCategory(reasonCategory);
          setServerFieldErrors(validationPresentation.fieldErrors);
          setInlineError(validationPresentation.inlineError);
          setFeedbackMessage(
            validationPresentation.guidance
            ?? buildServerValidationGuidance(validationPresentation.fieldErrors),
          );
          return;
        }

        if (validationPresentation.guidance || validationPresentation.inlineError) {
          setErrorReasonCategory(reasonCategory);
          setFeedbackMessage(validationPresentation.guidance);
          setInlineError(validationPresentation.inlineError);
          return;
        }

        setErrorReasonCategory(resolveOrderReasonCategory(getErrorCode(error)));
        setInlineError(getErrorMessage(error));
      } finally {
        if (operationVersion === operationVersionRef.current) {
          setIsSubmitting(false);
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
    setIsVerifyingOtp(true);
    const operationVersion = ++operationVersionRef.current;

    try {
      const session = await verifyOrderSessionOtp(orderSession.orderSessionId, value);
      if (operationVersion !== operationVersionRef.current) {
        return;
      }

      setOtpValueState('');
      applySessionState(session);
    } catch (error) {
      if (operationVersion !== operationVersionRef.current) {
        return;
      }

      const normalized = error as NormalizedApiError;
      setOtpValueState('');
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

      setErrorReasonCategory(resolveOrderReasonCategory(getErrorCode(normalized)));
      setInlineError(formatOtpError(normalized));
    } finally {
      if (operationVersion === operationVersionRef.current) {
        setIsVerifyingOtp(false);
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
        preservePresentation: options?.preservePresentation,
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
    setIsExecuting(true);
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
        setPresentation(nextPresentation);
        setErrorReasonCategory(nextPresentation.reasonCategory);
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
      setErrorReasonCategory(resolveOrderReasonCategory(getErrorCode(error)));
      setInlineError(getErrorMessage(error));
    } finally {
      if (operationVersion === operationVersionRef.current) {
        setIsExecuting(false);
      }
    }
  };

  const handleExtend = async () => {
    if (!orderSession || isExtending) {
      return;
    }

    clearTransientFeedback();
    setIsExtending(true);
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
      setErrorReasonCategory(resolveOrderReasonCategory(getErrorCode(error)));
      setInlineError(getErrorMessage(error));
    } finally {
      if (operationVersion === operationVersionRef.current) {
        setIsExtending(false);
      }
    }
  };

  return {
    step,
    feedbackMessage,
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
    draftSummary: buildExternalOrderDraftSummary(draft),
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
      setSelectedPresetId(matchPresetIdFromDraft(nextDraft));
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
      setSelectedPresetId(matchPresetIdFromDraft(nextDraft));
    },
    setOtpValue: (value: string) => {
      const nextValue = value.replace(/\D/g, '').slice(0, 6);
      setOtpValueState(nextValue);
      if (nextValue.length === 6) {
        void handleVerifyOtp(nextValue);
      }
    },
    submit: handleSubmit,
    execute: handleExecute,
    extend: handleExtend,
  };
};
