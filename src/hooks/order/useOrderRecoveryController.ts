import { useEffect, useEffectEvent, useRef, useState } from 'react';

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
  type ExternalOrderPresetId,
  type ExternalOrderFieldErrors,
  validateExternalOrderDraft,
} from '@/order/external-order-recovery';
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

interface UseOrderRecoveryControllerInput {
  accountId?: string;
}

const authorizationReasonMessage = (reason?: string) => {
  if (reason === 'RECENT_LOGIN_MFA' || reason === 'TRUSTED_AUTH_SESSION') {
    return '현재 신뢰 세션이 유효하여 추가 OTP 없이 바로 주문을 실행할 수 있습니다.';
  }

  return '고위험 주문으로 분류되어 주문 실행 전에 OTP 인증이 필요합니다.';
};

const isTerminalStatus = (status?: string) =>
  status === 'COMPLETED'
  || status === 'FAILED'
  || status === 'CANCELED'
  || status === 'EXPIRED';

const formatOtpError = (error: NormalizedApiError) => {
  if (error.code === 'CHANNEL-002' && typeof error.remainingAttempts === 'number') {
    return `OTP 코드가 일치하지 않습니다. 남은 시도 ${error.remainingAttempts}회`;
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
  const [selectedPresetId, setSelectedPresetId] = useState<ExternalOrderPresetId | null>(
    externalOrderPresetOptions[0].id,
  );
  const [draft, setDraft] = useState(createInitialExternalOrderDraft);
  const [step, setStep] = useState<OrderFlowStep>('A');
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null);
  const [inlineError, setInlineError] = useState<string | null>(null);
  const [serverFieldErrors, setServerFieldErrors] = useState<ExternalOrderFieldErrors>({});
  const [presentation, setPresentation] =
    useState<ExternalOrderErrorPresentation | null>(null);
  const [orderSession, setOrderSession] = useState<OrderSessionResponse | null>(null);
  const [otpValue, setOtpValueState] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isVerifyingOtp, setIsVerifyingOtp] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const [isExtending, setIsExtending] = useState(false);
  const operationVersionRef = useRef(0);
  const fieldErrors = validateExternalOrderDraft(draft);
  const mergedFieldErrors: ExternalOrderFieldErrors = {
    symbol: fieldErrors.symbol ?? serverFieldErrors.symbol,
    quantity: fieldErrors.quantity ?? serverFieldErrors.quantity,
  };
  const isInteractionLocked =
    isSubmitting || isVerifyingOtp || isExecuting || isRestoring || isExtending;
  const canSubmit =
    !mergedFieldErrors.symbol
    && !mergedFieldErrors.quantity
    && !isInteractionLocked;

  const clearTransientFeedback = () => {
    setFeedbackMessage(null);
    setInlineError(null);
    setPresentation(null);
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
      setDraft(createInitialExternalOrderDraft());
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

  const applySessionState = (session: OrderSessionResponse, options?: { restoring?: boolean }) => {
    setOrderSession(session);
    clearServerFieldErrors();
    setDraft({
      symbol: session.symbol,
      quantity: String(session.qty),
    });
    setSelectedPresetId(matchPresetIdFromDraft({
      symbol: session.symbol,
      quantity: String(session.qty),
    }));
    persistSessionId(session.orderSessionId);
    clearTransientFeedback();

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

    if (session.status === 'COMPLETED') {
      setStep('COMPLETE');
      setFeedbackMessage('주문이 접수되었습니다. 주문 요약을 확인해 주세요.');
      clearPersistedSessionId();
      return;
    }

    if (isTerminalStatus(session.status)) {
      resetFlow({
        keepPreset: true,
        message: '이 주문 세션은 더 이상 유효하지 않습니다. 새 주문을 시작해 주세요.',
      });
      return;
    }

    setStep('A');
  };
  const applySessionStateEvent = useEffectEvent(applySessionState);
  const resetFlowEvent = useEffectEvent(resetFlow);

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

  const handleSubmit = async () => {
    if (isSubmitting || isVerifyingOtp || isExecuting) {
      return;
    }

    if (mergedFieldErrors.symbol || mergedFieldErrors.quantity) {
      setInlineError(null);
      setPresentation(null);
      return;
    }

    const request = buildExternalOrderRequest({
      accountId,
      symbol: draft.symbol,
      quantity: draft.quantity,
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
      setInlineError(formatOtpError(normalized));
    } finally {
      if (operationVersion === operationVersionRef.current) {
        setIsVerifyingOtp(false);
      }
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

      if (isVisibleExternalOrderError(error)) {
        setPresentation(resolveExternalOrderErrorPresentation(error));
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
      setDraft(draftFromPreset(presetId));
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
      const nextDraft = {
        ...draft,
        symbol: value,
      };
      setDraft(nextDraft);
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
      setDraft(nextDraft);
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
