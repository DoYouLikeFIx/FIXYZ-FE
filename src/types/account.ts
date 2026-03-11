export interface AccountPosition {
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
