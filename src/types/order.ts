export type KnownOrderSessionStatus =
  | 'PENDING_NEW'
  | 'AUTHED'
  | 'EXECUTING'
  | 'REQUERYING'
  | 'ESCALATED'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELED'
  | 'EXPIRED';

export type KnownOrderAuthorizationReason =
  | 'ELEVATED_ORDER_RISK'
  | 'TRUSTED_AUTH_SESSION'
  | 'RECENT_LOGIN_MFA';

export type KnownOrderExecutionResult =
  | 'FILLED'
  | 'PARTIAL_FILL'
  | 'VIRTUAL_FILL'
  | 'CANCELED'
  | 'PARTIAL_FILL_CANCEL';

export type KnownOrderFailureReason =
  | 'OTP_EXCEEDED'
  | 'MARKET_CLOSED'
  | 'ESCALATED_MANUAL_REVIEW';

export type OrderSessionStatus = KnownOrderSessionStatus | (string & {});
export type OrderAuthorizationReason = KnownOrderAuthorizationReason | (string & {});
export type OrderExecutionResult = KnownOrderExecutionResult | (string & {});
export type OrderFailureReason = KnownOrderFailureReason | (string & {});
export type OrderFlowStep = 'A' | 'B' | 'C' | 'COMPLETE';

export interface OrderSessionResponse {
  orderSessionId: string;
  clOrdId: string;
  status: OrderSessionStatus;
  challengeRequired: boolean;
  authorizationReason: OrderAuthorizationReason;
  accountId: number;
  symbol: string;
  side: string;
  orderType: string;
  qty: number;
  price: number | null;
  executionResult?: OrderExecutionResult | null;
  executedQty?: number | null;
  leavesQty?: number | null;
  executedPrice?: number | null;
  externalOrderId?: string | null;
  failureReason?: OrderFailureReason | null;
  executedAt?: string | null;
  canceledAt?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  expiresAt: string | null;
  remainingSeconds?: number | null;
}
