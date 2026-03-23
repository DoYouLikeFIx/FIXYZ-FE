import type { AccountPosition } from '@/types/account';
import type { OrderFlowStep, OrderSessionResponse } from '@/types/order';
import type { ExternalOrderFieldErrors } from '@/order/external-order-recovery';
import type { ExternalOrderErrorPresentation } from '@/order/external-errors';
import type { OrderReasonCategory } from '@/order/order-error-category';

export interface OrderFlowState {
  step: OrderFlowStep;
  feedbackMessage: string | null;
  staleQuoteGuidance: string | null;
  inlineError: string | null;
  errorReasonCategory: OrderReasonCategory | null;
  serverFieldErrors: ExternalOrderFieldErrors;
  presentation: ExternalOrderErrorPresentation | null;
  orderSession: OrderSessionResponse | null;
  updatedPosition: AccountPosition | null;
  updatedPositionMessage: string | null;
  hasDetectedSessionExpiry: boolean;
  otpValue: string;
  isSubmitting: boolean;
  isVerifyingOtp: boolean;
  isExecuting: boolean;
  isRestoring: boolean;
  isExtending: boolean;
}

type BusyFlag =
  | 'isSubmitting'
  | 'isVerifyingOtp'
  | 'isExecuting'
  | 'isRestoring'
  | 'isExtending';

type OrderFlowAction =
  | {
      type: 'patch';
      payload: Partial<OrderFlowState>;
    }
  | {
      type: 'setBusyFlag';
      flag: BusyFlag;
      value: boolean;
    }
  | {
      type: 'setOtpValue';
      value: string;
    }
  | {
      type: 'clearTransientFeedback';
      preservePresentation?: boolean;
    }
  | {
      type: 'clearServerFieldErrors';
      targets?: Array<keyof ExternalOrderFieldErrors>;
    }
  | {
      type: 'reset';
      inlineError?: string | null;
    }
  | {
      type: 'discardDraftSessionContext';
    }
  | {
      type: 'goBackToDraft';
      feedbackMessage: string | null;
    }
  | {
      type: 'markSessionExpired';
      session: OrderSessionResponse;
    }
  | {
      type: 'syncSessionState';
      session: OrderSessionResponse;
      step: OrderFlowStep;
      feedbackMessage: string | null;
      preservePresentation?: boolean;
    };

export const initialOrderFlowState: OrderFlowState = {
  step: 'A',
  feedbackMessage: null,
  staleQuoteGuidance: null,
  inlineError: null,
  errorReasonCategory: null,
  serverFieldErrors: {},
  presentation: null,
  orderSession: null,
  updatedPosition: null,
  updatedPositionMessage: null,
  hasDetectedSessionExpiry: false,
  otpValue: '',
  isSubmitting: false,
  isVerifyingOtp: false,
  isExecuting: false,
  isRestoring: false,
  isExtending: false,
};

export const orderFlowReducer = (
  state: OrderFlowState,
  action: OrderFlowAction,
): OrderFlowState => {
  switch (action.type) {
    case 'patch':
      return {
        ...state,
        ...action.payload,
      };
    case 'setBusyFlag':
      return {
        ...state,
        [action.flag]: action.value,
      };
    case 'setOtpValue':
      return {
        ...state,
        otpValue: action.value,
      };
    case 'clearTransientFeedback':
      return {
        ...state,
        feedbackMessage: null,
        staleQuoteGuidance: null,
        inlineError: null,
        ...(action.preservePresentation
          ? null
          : {
              presentation: null,
              errorReasonCategory: null,
            }),
      };
    case 'clearServerFieldErrors':
      if (!action.targets || action.targets.length === 0) {
        return {
          ...state,
          serverFieldErrors: {},
        };
      }

      return {
        ...state,
        serverFieldErrors: action.targets.reduce<ExternalOrderFieldErrors>((next, target) => {
          delete next[target];
          return next;
        }, { ...state.serverFieldErrors }),
      };
    case 'reset':
      return {
        ...initialOrderFlowState,
        inlineError: action.inlineError ?? null,
      };
    case 'discardDraftSessionContext':
      return {
        ...state,
        orderSession: null,
        updatedPosition: null,
        updatedPositionMessage: null,
        hasDetectedSessionExpiry: false,
        otpValue: '',
        presentation: null,
        errorReasonCategory: null,
        inlineError: null,
        feedbackMessage: null,
        staleQuoteGuidance: null,
        isExtending: false,
      };
    case 'goBackToDraft':
      return {
        ...state,
        step: 'A',
        hasDetectedSessionExpiry: false,
        otpValue: '',
        isVerifyingOtp: false,
        feedbackMessage: action.feedbackMessage,
        staleQuoteGuidance: null,
        inlineError: null,
        presentation: null,
        errorReasonCategory: null,
      };
    case 'markSessionExpired':
      return {
        ...state,
        serverFieldErrors: {},
        presentation: null,
        updatedPosition: null,
        updatedPositionMessage: null,
        errorReasonCategory: null,
        feedbackMessage: null,
        staleQuoteGuidance: null,
        inlineError: null,
        orderSession: action.session,
        hasDetectedSessionExpiry: true,
        otpValue: '',
        isSubmitting: false,
        isVerifyingOtp: false,
        isExecuting: false,
        isExtending: false,
        step: action.session.challengeRequired ? 'B' : 'C',
      };
    case 'syncSessionState':
      return {
        ...state,
        orderSession: action.session,
        hasDetectedSessionExpiry: false,
        serverFieldErrors: {},
        step: action.step,
        feedbackMessage: action.feedbackMessage,
        staleQuoteGuidance: null,
        inlineError: null,
        ...(action.preservePresentation
          ? null
          : {
              presentation: null,
              errorReasonCategory: null,
            }),
      };
    default:
      return state;
  }
};
