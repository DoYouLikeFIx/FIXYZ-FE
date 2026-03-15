import { api } from '@/lib/axios';
import type { ExternalOrderRequest } from '@/order/external-order-recovery';
import type { OrderSessionResponse } from '@/types/order';

export type { OrderSessionResponse } from '@/types/order';

interface OrderSessionOtpVerifyResponse {
  otpCode: string;
}

const createOrderSessionBody = (payload: ExternalOrderRequest) => ({
  accountId: payload.accountId,
  symbol: payload.symbol,
  side: payload.side,
  orderType: 'LIMIT',
  qty: payload.quantity,
  price: payload.price,
});

export const createOrderSession = async (
  payload: ExternalOrderRequest,
): Promise<OrderSessionResponse> => {
  const response = await api.post<OrderSessionResponse>(
    '/api/v1/orders/sessions',
    createOrderSessionBody(payload),
    {
      headers: {
        'Content-Type': 'application/json',
        'X-ClOrdID': payload.clOrdId,
      },
    },
  );

  return response.data;
};

export const verifyOrderSessionOtp = async (
  orderSessionId: string,
  otpCode: string,
): Promise<OrderSessionResponse> => {
  const response = await api.post<OrderSessionResponse>(
    `/api/v1/orders/sessions/${orderSessionId}/otp/verify`,
    {
      otpCode,
    } satisfies OrderSessionOtpVerifyResponse,
  );

  return response.data;
};

export const extendOrderSession = async (
  orderSessionId: string,
): Promise<OrderSessionResponse> => {
  const response = await api.post<OrderSessionResponse>(
    `/api/v1/orders/sessions/${orderSessionId}/extend`,
    {},
  );

  return response.data;
};

export const executeOrderSession = async (
  orderSessionId: string,
): Promise<OrderSessionResponse> => {
  const response = await api.post<OrderSessionResponse>(
    `/api/v1/orders/sessions/${orderSessionId}/execute`,
    {},
  );

  return response.data;
};

export const getOrderSession = async (
  orderSessionId: string,
): Promise<OrderSessionResponse> => {
  const response = await api.get<OrderSessionResponse>(
    `/api/v1/orders/sessions/${orderSessionId}`,
  );

  return response.data;
};
