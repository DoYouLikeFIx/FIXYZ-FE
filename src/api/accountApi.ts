import { api } from '@/lib/axios';
import type {
  AccountOrderHistoryPage,
  AccountPosition,
} from '@/types/account';

export interface AccountPositionQuery {
  accountId: string;
  symbol: string;
}

export interface AccountPositionsQuery {
  accountId: string;
}

export interface AccountSummaryQuery {
  accountId: string;
}

export interface AccountOrderHistoryQuery {
  accountId: string;
  page: number;
  size: number;
}

export const fetchAccountPosition = async (
  query: AccountPositionQuery,
): Promise<AccountPosition> => {
  const response = await api.get<AccountPosition>(
    `/api/v1/accounts/${query.accountId}/positions`,
    {
      params: {
        symbol: query.symbol,
      },
    },
  );

  return response.data;
};

export const fetchAccountPositions = async (
  query: AccountPositionsQuery,
): Promise<AccountPosition[]> => {
  const response = await api.get<AccountPosition[]>(
    `/api/v1/accounts/${query.accountId}/positions/list`,
  );

  return response.data;
};

export const fetchAccountSummary = async (
  query: AccountSummaryQuery,
): Promise<AccountPosition> => {
  const response = await api.get<AccountPosition>(
    `/api/v1/accounts/${query.accountId}/summary`,
  );

  return response.data;
};

export const fetchAccountOrderHistory = async (
  query: AccountOrderHistoryQuery,
): Promise<AccountOrderHistoryPage> => {
  const response = await api.get<AccountOrderHistoryPage>(
    `/api/v1/accounts/${query.accountId}/orders`,
    {
      params: {
        page: query.page,
        size: query.size,
      },
    },
  );

  return response.data;
};
