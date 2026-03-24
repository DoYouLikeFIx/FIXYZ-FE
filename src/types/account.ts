export type QuoteSourceMode = 'LIVE' | 'DELAYED' | 'REPLAY' | (string & {});
export type ValuationStatus = 'FRESH' | 'STALE' | 'UNAVAILABLE' | (string & {});
export type ValuationUnavailableReason =
  | 'STALE_QUOTE'
  | 'QUOTE_MISSING'
  | 'PROVIDER_UNAVAILABLE'
  | (string & {});

interface AccountHoldingBase {
  accountId: number;
  memberId: number;
  symbol: string;
  quantity: number;
  availableQuantity: number;
  availableQty: number;
  balance: number;
  availableBalance: number;
  currency: string;
  asOf: string;
}

export type AccountSummary = AccountHoldingBase;

export interface AccountPosition extends AccountHoldingBase {
  avgPrice?: number | null;
  marketPrice?: number | null;
  quoteSnapshotId?: string | null;
  quoteAsOf?: string | null;
  quoteSourceMode?: QuoteSourceMode | null;
  unrealizedPnl?: number | null;
  realizedPnlDaily?: number | null;
  valuationStatus?: ValuationStatus | null;
  valuationUnavailableReason?: ValuationUnavailableReason | null;
}

export interface AccountOrderHistoryItem {
  symbol: string;
  symbolName: string;
  side: string;
  qty: number;
  unitPrice: number;
  totalAmount: number;
  status: string;
  clOrdId: string;
  createdAt: string;
}

export interface AccountOrderHistoryPage {
  content: AccountOrderHistoryItem[];
  totalElements: number;
  totalPages: number;
  number: number;
  size: number;
}
