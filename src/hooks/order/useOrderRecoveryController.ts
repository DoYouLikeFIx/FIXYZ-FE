import { useReducer } from 'react';

import { submitExternalOrder } from '@/api/orderApi';
import { getErrorMessage } from '@/lib/errors';
import {
  buildExternalOrderRequest,
  externalOrderPresetOptions,
  type ExternalOrderPresetId,
} from '@/order/external-order-recovery';
import {
  isVisibleExternalOrderError,
  resolveExternalOrderErrorPresentation,
  type ExternalOrderErrorPresentation,
} from '@/order/external-errors';

interface OrderRecoveryState {
  feedbackMessage: string | null;
  isSubmitting: boolean;
  presentation: ExternalOrderErrorPresentation | null;
  selectedPresetId: ExternalOrderPresetId;
}

type OrderRecoveryAction =
  | {
      type: 'select-preset';
      presetId: ExternalOrderPresetId;
    }
  | {
      type: 'submit-start';
    }
  | {
      type: 'submit-success';
      message: string;
    }
  | {
      type: 'submit-external-error';
      presentation: ExternalOrderErrorPresentation;
    }
  | {
      type: 'submit-inline-error';
      message: string;
    }
  | {
      type: 'clear';
    };

const initialState: OrderRecoveryState = {
  feedbackMessage: null,
  isSubmitting: false,
  presentation: null,
  selectedPresetId: externalOrderPresetOptions[0].id,
};

const reducer = (
  state: OrderRecoveryState,
  action: OrderRecoveryAction,
): OrderRecoveryState => {
  switch (action.type) {
    case 'select-preset':
      return {
        ...state,
        feedbackMessage: null,
        presentation: null,
        selectedPresetId: action.presetId,
      };
    case 'submit-start':
      return {
        ...state,
        feedbackMessage: null,
        isSubmitting: true,
        presentation: null,
      };
    case 'submit-success':
      return {
        ...state,
        feedbackMessage: action.message,
        isSubmitting: false,
        presentation: null,
      };
    case 'submit-external-error':
      return {
        ...state,
        feedbackMessage: null,
        isSubmitting: false,
        presentation: action.presentation,
      };
    case 'submit-inline-error':
      return {
        ...state,
        feedbackMessage: action.message,
        isSubmitting: false,
        presentation: null,
      };
    case 'clear':
      return {
        ...state,
        feedbackMessage: null,
        presentation: null,
      };
    default:
      return state;
  }
};

interface UseOrderRecoveryControllerInput {
  accountId?: string;
}

export const useOrderRecoveryController = ({
  accountId,
}: UseOrderRecoveryControllerInput) => {
  const [state, dispatch] = useReducer(reducer, initialState);

  const handleSubmit = async () => {
    if (state.isSubmitting) {
      return;
    }

    const request = buildExternalOrderRequest({
      accountId,
      presetId: state.selectedPresetId,
    });

    if (!request) {
      dispatch({
        type: 'submit-inline-error',
        message: '주문에 사용할 계좌 정보를 확인할 수 없습니다.',
      });
      return;
    }

    dispatch({ type: 'submit-start' });

    try {
      const result = await submitExternalOrder(request);
      dispatch({
        type: 'submit-success',
        message: `주문 요청이 접수되었습니다. 상태: ${result.status}`,
      });
    } catch (error) {
      if (isVisibleExternalOrderError(error)) {
        dispatch({
          type: 'submit-external-error',
          presentation: resolveExternalOrderErrorPresentation(error),
        });
        return;
      }

      dispatch({
        type: 'submit-inline-error',
        message: getErrorMessage(error),
      });
    }
  };

  return {
    feedbackMessage: state.feedbackMessage,
    isSubmitting: state.isSubmitting,
    presentation: state.presentation,
    presets: externalOrderPresetOptions,
    selectedPresetId: state.selectedPresetId,
    clear: () => {
      dispatch({ type: 'clear' });
    },
    selectPreset: (presetId: ExternalOrderPresetId) => {
      dispatch({
        type: 'select-preset',
        presetId,
      });
    },
    submit: handleSubmit,
  };
};
