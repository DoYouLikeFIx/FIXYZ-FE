import { useEffect, useMemo, useRef, useState } from 'react';

import {
  fetchAccountOrderHistory,
  fetchAccountPositions,
  fetchAccountSummary,
} from '@/api/accountApi';
import {
  getAccountDashboardErrorPresentation,
  type AccountDashboardErrorPresentation,
} from '@/lib/account-dashboard-errors';
import { useAuth } from '@/hooks/auth/useAuth';
import { maskAccountNumber } from '@/lib/account-masking';
import type {
  AccountOrderHistoryPage,
  AccountPosition,
  AccountSummary,
} from '@/types/account';

export type PortfolioTab = 'dashboard' | 'history';

interface AsyncState<T> {
  data: T | null;
  error: AccountDashboardErrorPresentation | null;
  loading: boolean;
  scopeKey: string | null;
}

interface ScopedHistoryPageState {
  page: number;
  scopeMarker: symbol;
}

export const HISTORY_PAGE_SIZE_OPTIONS = [5, 10, 20] as const;

const createAsyncState = <T,>(
  scopeKey: string | null,
  loading = false,
): AsyncState<T> => ({
  data: null,
  error: null,
  loading,
  scopeKey,
});

const hasNumericAccountId = (value?: string) =>
  typeof value === 'string' && /^\d+$/.test(value);

export const useAccountDashboard = () => {
  const member = useAuth((state) => state.member);
  const accountId = member?.accountId;
  const hasLinkedAccount = hasNumericAccountId(accountId);
  const currentScopeKey = hasLinkedAccount && accountId ? accountId : null;
  const maskedAccountNumber = useMemo(
    () => maskAccountNumber(accountId),
    [accountId],
  );
  const [activeTab, setActiveTabState] = useState<PortfolioTab>('dashboard');
  const [preferredSymbol, setPreferredSymbol] = useState<string | null>(null);
  const currentHistoryScopeMarker = useMemo(
    () => Symbol(currentScopeKey ?? 'history-scope'),
    [currentScopeKey],
  );
  const [historyPageState, setHistoryPageState] = useState<ScopedHistoryPageState>(() => ({
    page: 0,
    scopeMarker: currentHistoryScopeMarker,
  }));
  const [historyPageSize, setHistoryPageSizeState] = useState<number>(
    HISTORY_PAGE_SIZE_OPTIONS[1],
  );
  const [summaryState, setSummaryState] = useState<AsyncState<AccountSummary>>(() =>
    createAsyncState<AccountSummary>(currentScopeKey, Boolean(currentScopeKey)),
  );
  const [positionsState, setPositionsState] = useState<AsyncState<AccountPosition[]>>(() =>
    createAsyncState<AccountPosition[]>(currentScopeKey, Boolean(currentScopeKey)),
  );
  const [historyState, setHistoryState] = useState<AsyncState<AccountOrderHistoryPage>>(() =>
    createAsyncState<AccountOrderHistoryPage>(currentScopeKey),
  );
  const [summaryReloadKey, setSummaryReloadKey] = useState(0);
  const [positionsReloadKey, setPositionsReloadKey] = useState(0);
  const [historyReloadKey, setHistoryReloadKey] = useState(0);
  const summaryRequestIdRef = useRef(0);
  const positionsRequestIdRef = useRef(0);
  const historyRequestIdRef = useRef(0);
  const historyPage =
    historyPageState.scopeMarker === currentHistoryScopeMarker
      ? historyPageState.page
      : 0;

  useEffect(() => {
    if (!currentScopeKey) {
      return;
    }

    const requestId = ++summaryRequestIdRef.current;
    let cancelled = false;

    void fetchAccountSummary({
      accountId: currentScopeKey,
    })
      .then((data) => {
        if (cancelled || requestId !== summaryRequestIdRef.current) {
          return;
        }

        setSummaryState({
          data,
          error: null,
          loading: false,
          scopeKey: currentScopeKey,
        });
      })
      .catch((error: unknown) => {
        if (cancelled || requestId !== summaryRequestIdRef.current) {
          return;
        }

        setSummaryState({
          data: null,
          error: getAccountDashboardErrorPresentation(error),
          loading: false,
          scopeKey: currentScopeKey,
        });
      });

    return () => {
      cancelled = true;
    };
  }, [currentScopeKey, summaryReloadKey]);

  useEffect(() => {
    if (!currentScopeKey) {
      return;
    }

    const requestId = ++positionsRequestIdRef.current;
    let cancelled = false;

    void fetchAccountPositions({
      accountId: currentScopeKey,
    })
      .then((data) => {
        if (cancelled || requestId !== positionsRequestIdRef.current) {
          return;
        }

        setPositionsState({
          data,
          error: null,
          loading: false,
          scopeKey: currentScopeKey,
        });
      })
      .catch((error: unknown) => {
        if (cancelled || requestId !== positionsRequestIdRef.current) {
          return;
        }

        setPositionsState({
          data: null,
          error: getAccountDashboardErrorPresentation(error),
          loading: false,
          scopeKey: currentScopeKey,
        });
      });

    return () => {
      cancelled = true;
    };
  }, [currentScopeKey, positionsReloadKey]);

  useEffect(() => {
    if (!currentScopeKey || activeTab !== 'history') {
      return;
    }

    const requestId = ++historyRequestIdRef.current;
    let cancelled = false;

    void fetchAccountOrderHistory({
      accountId: currentScopeKey,
      page: historyPage,
      size: historyPageSize,
    })
      .then((data) => {
        if (cancelled || requestId !== historyRequestIdRef.current) {
          return;
        }

        setHistoryState({
          data,
          error: null,
          loading: false,
          scopeKey: currentScopeKey,
        });
      })
      .catch((error: unknown) => {
        if (cancelled || requestId !== historyRequestIdRef.current) {
          return;
        }

        setHistoryState({
          data: null,
          error: getAccountDashboardErrorPresentation(error),
          loading: false,
          scopeKey: currentScopeKey,
        });
      });

    return () => {
      cancelled = true;
    };
  }, [
    activeTab,
    currentScopeKey,
    historyPage,
    historyPageSize,
    historyReloadKey,
  ]);

  const summary =
    summaryState.scopeKey === currentScopeKey ? summaryState.data : null;
  const summaryError =
    summaryState.scopeKey === currentScopeKey ? summaryState.error : null;
  const positionItems = useMemo(
    () => (positionsState.scopeKey === currentScopeKey ? positionsState.data ?? [] : []),
    [currentScopeKey, positionsState.data, positionsState.scopeKey],
  );
  const symbolOptionsError =
    positionsState.scopeKey === currentScopeKey ? positionsState.error : null;
  const summaryLoading = Boolean(currentScopeKey) && (
    summaryState.loading || summaryState.scopeKey !== currentScopeKey
  );
  const positionsLoading = Boolean(currentScopeKey) && (
    positionsState.loading || positionsState.scopeKey !== currentScopeKey
  );
  const positionLoading = Boolean(currentScopeKey) && (
    summaryState.loading
    || positionsState.loading
    || summaryState.scopeKey !== currentScopeKey
    || positionsState.scopeKey !== currentScopeKey
  );
  const selectedSymbol = useMemo(() => {
    if (positionItems.length === 0) {
      return null;
    }

    if (
      preferredSymbol
      && positionItems.some((item) => item.symbol === preferredSymbol)
    ) {
      return preferredSymbol;
    }

    return positionItems[0].symbol;
  }, [positionItems, preferredSymbol]);
  const selectedPosition = useMemo(
    () => positionItems.find((item) => item.symbol === selectedSymbol) ?? null,
    [positionItems, selectedSymbol],
  );
  const holdingPosition = selectedPosition ?? summary;
  const valuationPosition = selectedPosition;
  const symbolOptions = useMemo(
    () => positionItems.map((item) => item.symbol),
    [positionItems],
  );

  const historyItems = currentScopeKey && historyState.scopeKey === currentScopeKey
    ? historyState.data?.content ?? []
    : [];
  const historyError =
    historyState.scopeKey === currentScopeKey ? historyState.error : null;
  const historyLoading = Boolean(currentScopeKey) && activeTab === 'history' && (
    historyState.loading || historyState.scopeKey !== currentScopeKey
  );

  return {
    activeTab,
    hasLinkedAccount,
    historyError,
    historyItems,
    historyLoading,
    historyPage,
    historyPageSize,
    historyTotalElements:
      currentScopeKey && historyState.scopeKey === currentScopeKey
        ? historyState.data?.totalElements ?? 0
        : 0,
    historyTotalPages:
      currentScopeKey && historyState.scopeKey === currentScopeKey
        ? historyState.data?.totalPages ?? 0
        : 0,
    maskedAccountNumber,
    member,
    holdingPosition,
    summary,
    summaryError,
    summaryLoading,
    positionsLoading,
    valuationPosition,
    positionLoading,
    retryHistory: () => {
      if (!currentScopeKey) {
        return;
      }

      setHistoryState((current) => ({
        ...current,
        error: null,
        loading: true,
        scopeKey: currentScopeKey,
      }));
      setHistoryReloadKey((current) => current + 1);
    },
    retryPosition: () => {
      if (!currentScopeKey) {
        return;
      }

      setSummaryState((current) => ({
        ...current,
        error: null,
        loading: true,
        scopeKey: currentScopeKey,
      }));
      setPositionsState((current) => ({
        ...current,
        error: null,
        loading: true,
        scopeKey: currentScopeKey,
      }));
      setSummaryReloadKey((current) => current + 1);
      setPositionsReloadKey((current) => current + 1);
    },
    selectedSymbol,
    setActiveTab: (nextTab: PortfolioTab) => {
      if (nextTab === 'history' && currentScopeKey) {
        setHistoryState((current) => ({
          ...current,
          error: null,
          loading: true,
          scopeKey: currentScopeKey,
        }));
      }
      setActiveTabState(nextTab);
    },
    setHistoryPage: (page: number) => {
      if (!currentScopeKey) {
        return;
      }

      setHistoryState((current) => ({
        ...current,
        error: null,
        loading: true,
        scopeKey: currentScopeKey,
      }));
      setHistoryPageState({
        page,
        scopeMarker: currentHistoryScopeMarker,
      });
    },
    setHistoryPageSize: (size: number) => {
      if (!currentScopeKey) {
        return;
      }

      setHistoryState((current) => ({
        ...current,
        error: null,
        loading: true,
        scopeKey: currentScopeKey,
      }));
      setHistoryPageState({
        page: 0,
        scopeMarker: currentHistoryScopeMarker,
      });
      setHistoryPageSizeState(size);
    },
    setSelectedSymbol: (symbol: string) => {
      setPreferredSymbol(symbol);
    },
    symbolOptions,
    symbolOptionsError,
  };
};
