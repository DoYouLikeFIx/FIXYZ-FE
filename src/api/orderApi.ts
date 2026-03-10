import { api } from '@/lib/axios';
import type { ExternalOrderRequest } from '@/order/external-order-recovery';

export interface OrderSubmissionResponse {
  orderId: number;
  clOrdId: string;
  status: string;
  idempotent: boolean;
  orderQuantity: number;
}

const createFormBody = (payload: Record<string, string>) =>
  new URLSearchParams(payload);

export const submitExternalOrder = async (
  payload: ExternalOrderRequest,
): Promise<OrderSubmissionResponse> => {
  const response = await api.post<OrderSubmissionResponse>(
    '/api/v1/orders',
    createFormBody({
      accountId: String(payload.accountId),
      clOrdId: payload.clOrdId,
      symbol: payload.symbol,
      side: payload.side,
      quantity: String(payload.quantity),
      price: String(payload.price),
    }),
    {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-ClOrdID': payload.clOrdId,
      },
    },
  );

  return response.data;
};
