import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useController, useForm } from 'react-hook-form';

import {
  createOrderSession,
  extendOrderSession,
  executeOrderSession,
  getOrderSession,
  verifyOrderSessionOtp,
  type OrderSessionResponse,
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

type OrderFlowStep = 'A' | 'B' | 'C' | 'COMPLETE';

const ORDER_STATUS_POLL_INTERVAL_MS = 30_000;

interface UseOrderRecoveryControllerInput {
  accountId?: string;
}

const authorizationReasonMessage = (reason?: string) => {
  if (reason === 'RECENT_LOGIN_MFA' || reason === 'TRUSTED_AUTH_SESSION') {
    return '현재 신뢰 세션이 유효하여 추가 OTP 없이 바로 주문을 실행할 수 있습니다.';
  }

  return '고위험 주문으로 분류되어 주문 실행 전에 OTP 인증이 필요합니다.';
};

const canonicalizeErrorCode = (code?: string) =>
  typeof code === 'string' && /^[A-Z]+_[0-9]{3}$/.test(code)
    ? code.replace(/_/g, '-')
    : code;

const getErrorCode = (error: unknown) =>
  typeof error === 'object' && error !== null && 'code' in error
    ? canonicalizeErrorCode((error as Partial<NormalizedApiError>).code)
    : undefined;

const isFinalResultStatus = (status?: string) =>
  status === 'COMPLETED'
  || status === 'FAILED'
  || status === 'CANCELED';

const isServerExpiredStatus = (status?: string) => status === 'EXPIRED';

const isPollingStatus = (status?: string) =>
  status === 'EXECUTING'
  || status === 'REQUERYING'
  || status === 'ESCALATED';

const isSessionExpiredError = (error: unknown) => {
  const code = getErrorCode(error);
  return code === 'ORD-008' || code === 'CHANNEL-001';
};

const resolveInFlightGuidance = (status?: string) => {
  if (status === 'EXECUTING') {
    return '주문을 거래소에 전송했습니다. 체결 결과를 확인하는 중입니다.';
  }

  if (status === 'REQUERYING') {
    return '체결 결과를 다시 확인하고 있습니다. 잠시만 기다려 주세요.';
  }

  if (status === 'ESCALATED') {
    return '처리 중 문제가 발생해 수동 확인이 필요합니다. 고객센터에 문의해 주세요.';
  }

  return null;
};

const resolveFinalResultGuidance = (session: OrderSessionResponse) => {
  if (session.status === 'FAILED') {
    return '주문이 최종 실패했습니다. 실패 사유를 확인한 뒤 새 주문을 시작해 주세요.';
  }

  if (session.status === 'CANCELED') {
    if (session.executionResult === 'PARTIAL_FILL_CANCEL') {
      return '일부 수량이 체결된 뒤 나머지 수량이 취소되었습니다.';
    }

    return '주문이 취소되었습니다.';
  }

  if (session.executionResult === 'PARTIAL_FILL') {
    return '주문이 일부 체결되었습니다. 잔여 수량을 확인해 주세요.';
  }

  if (session.executionResult === 'VIRTUAL_FILL') {
    return '주문이 승인 처리되었습니다. 주문 결과를 확인해 주세요.';
  }

  return '주문이 접수되었습니다. 주문 요약을 확인해 주세요.';
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
  const message = normalized.message ?? '';

  if (
    normalized.code === 'ORD-001'
    || /available cash|insufficient cash|매수 자금|가용 현금|cash/i.test(message)
  ) {
    return {
      fieldErrors: {},
      guidance: '매수 가능 금액을 확인하거나 수량을 조정한 뒤 다시 시도해 주세요.',
      inlineError: message,
    };
  }

  if (
    normalized.code === 'ORD-002'
    || /daily sell limit|매도 한도/i.test(message)
  ) {
    return {
      fieldErrors: {},
      guidance: '일일 매도 가능 한도를 확인한 뒤 다시 시도해 주세요.',
      inlineError: message,
    };
  }

  if (
    normalized.code === 'ORD-003'
    || /수량|quantity|position|가용/i.test(message)
  ) {
    return {
      fieldErrors: {
        quantity: message,
      },
      guidance: null,
      inlineError: null,
    };
  }

  if (/종목|symbol/i.test(message)) {
    return {
      fieldErrors: {
        symbol: message,
      },
      guidance: null,
      inlineError: null,
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
  const [serverFieldErrors, setServerFieldErrors] = useState<ExternalOrderFieldErrors>({});
  const [presentation, setPresentation] =
    useState<ExternalOrderErrorPresentation | null>(null);
  const [orderSession, setOrderSession] = useState<OrderSessionResponse | null>(null);
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

  const resetFlow = (options?: { keepPreset?: boolean; message?: string }) => {
    invalidatePendingOperations();
    clearPersistedSessionId();
    setStep('A');
    setOrderSession(null);
    setHasDetectedSessionExpiry(false);
    setOtpValueState('');
    clearServerFieldErrors();
    setPresentation(null);
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
    setHasDetectedSessionExpiry(false);
    setOtpValueState('');
    setPresentation(null);
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
    setFeedbackMessage(authorizationReasonMessage(orderSession.authorizationReason));
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
        setFeedbackMessage(authorizationReasonMessage(session.authorizationReason));
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
    if (!orderSession || !isPollingStatus(orderSession.status)) {
      return;
    }

    let cancelled = false;

    const pollOrderSession = async () => {
      try {
        const session = await getOrderSession(orderSession.orderSessionId);
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
        setInlineError('주문에 사용할 계좌 정보를 확인할 수 없습니다.');
        setPresentation(null);
        return;
      }

      clearTransientFeedback();
      clearServerFieldErrors();
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
        if (
          validationPresentation.fieldErrors.symbol
          || validationPresentation.fieldErrors.quantity
        ) {
          setServerFieldErrors(validationPresentation.fieldErrors);
          setInlineError(validationPresentation.inlineError);
          setFeedbackMessage(
            validationPresentation.guidance
            ?? buildServerValidationGuidance(validationPresentation.fieldErrors),
          );
          return;
        }

        if (validationPresentation.guidance || validationPresentation.inlineError) {
          setFeedbackMessage(validationPresentation.guidance);
          setInlineError(validationPresentation.inlineError);
          return;
        }

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
        setPresentation(resolveExternalOrderErrorPresentation(error));
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
    isSubmitting,
    isVerifyingOtp,
    isExecuting,
    isExtending,
    isRestoring,
    presentation,
    orderSession,
    hasDetectedSessionExpiry,
    otpValue,
    authorizationReasonMessage: authorizationReasonMessage(orderSession?.authorizationReason),
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
