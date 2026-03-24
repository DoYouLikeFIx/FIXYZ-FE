import { Link } from 'react-router-dom';

import {
  HISTORY_PAGE_SIZE_OPTIONS,
  useAccountDashboard,
} from '@/hooks/portfolio/useAccountDashboard';
import { DashboardQuoteTicker } from '@/components/portfolio/DashboardQuoteTicker';
import {
  isFreshValuationStatus,
  resolveValuationGuidance,
  resolveValuationStatus,
  resolveValuationStatusLabel,
  VALUATION_UNAVAILABLE_LABEL,
} from '@/lib/account-valuation';
import { formatKRW, formatQuantity, formatSignedKRW } from '@/utils/formatters';
import type { AccountPosition } from '@/types/account';

const dateFormatter = new Intl.DateTimeFormat('ko-KR', {
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

const NO_HOLDING_LABEL = '보유 없음';

const formatQuoteTimestamp = (value: string | null | undefined) => {
  if (!value) {
    return null;
  }

  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) {
    return null;
  }

  return dateFormatter.format(new Date(timestamp));
};

const formatDashboardTimestamp = (value: string | null | undefined) => {
  if (!value) {
    return VALUATION_UNAVAILABLE_LABEL;
  }

  return formatQuoteTimestamp(value) ?? '시각 확인 필요';
};

const formatOptionalQuoteSource = (value: string | null | undefined) =>
  typeof value === 'string' && value.trim() ? value : VALUATION_UNAVAILABLE_LABEL;

const formatMarketDerivedKRW = (
  value: number | null | undefined,
  valuationStatus: AccountPosition['valuationStatus'],
) => {
  if (
    !isFreshValuationStatus(valuationStatus)
    || value === null
    || value === undefined
  ) {
    return VALUATION_UNAVAILABLE_LABEL;
  }

  return formatKRW(value);
};

const formatPnlValue = (
  value: number | null | undefined,
  valuationStatus: AccountPosition['valuationStatus'],
) => {
  if (
    !isFreshValuationStatus(valuationStatus)
    || value === null
    || value === undefined
  ) {
    return VALUATION_UNAVAILABLE_LABEL;
  }

  return formatSignedKRW(value);
};

const getPnlToneClassName = (
  value: number | null | undefined,
  valuationStatus: AccountPosition['valuationStatus'],
) => {
  if (
    !isFreshValuationStatus(valuationStatus)
    || value === null
    || value === undefined
    || value === 0
  ) {
    return 'account-summary-cell__value--neutral';
  }

  return value > 0
    ? 'account-summary-cell__value--positive'
    : 'account-summary-cell__value--negative';
};

const formatAveragePriceValue = (position: AccountPosition) => {
  if (position.avgPrice === null || position.avgPrice === undefined) {
    return position.quantity === 0 ? NO_HOLDING_LABEL : VALUATION_UNAVAILABLE_LABEL;
  }

  return formatKRW(position.avgPrice);
};

export function PortfolioPage() {
  const {
    activeTab,
    holdingPosition,
    hasLinkedAccount,
    historyError,
    historyItems,
    historyLoading,
    historyPage,
    historyPageSize,
    historyTotalElements,
    historyTotalPages,
    maskedAccountNumber,
    member,
    positionsLoading,
    retryHistory,
    retryPosition,
    selectedSymbol,
    setActiveTab,
    setHistoryPage,
    setHistoryPageSize,
    setSelectedSymbol,
    summary,
    summaryError,
    summaryLoading,
    symbolOptions,
    symbolOptionsError,
    valuationPosition,
  } = useAccountDashboard();
  const valuationStatus = resolveValuationStatus(valuationPosition);
  const valuationGuidance = resolveValuationGuidance(
    valuationStatus,
    valuationPosition?.valuationUnavailableReason ?? null,
  );

  return (
    <section className="account-dashboard-shell">
      <header className="account-dashboard-hero">
        <div>
          <p className="status-kicker">Account dashboard</p>
          <h2 data-testid="protected-area-title">Portfolio overview</h2>
          <p className="account-dashboard-hero__description">
            계좌 잔고와 대표 보유 종목을 확인하고, 서버 기준 페이지네이션으로 최근 주문
            이력을 다시 조회할 수 있습니다.
          </p>
        </div>

        <div className="account-dashboard-hero__actions">
          {hasLinkedAccount ? (
            <Link
              to="/orders"
              className="portfolio-action portfolio-action--primary"
              data-testid="portfolio-demo-order"
            >
              주문 경계 열기
            </Link>
          ) : (
            <button
              type="button"
              className="portfolio-action portfolio-action--primary"
              data-testid="portfolio-demo-order-unavailable"
              disabled
            >
              주문 계좌 연동 필요
            </button>
          )}

          <div className="account-dashboard-pill">
            <span>대표 계좌</span>
            <strong data-testid="portfolio-masked-account">{maskedAccountNumber}</strong>
          </div>
        </div>
      </header>

      <section className="account-dashboard-tabs" role="tablist" aria-label="계좌 화면 탭">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'dashboard'}
          className={`account-dashboard-tab ${
            activeTab === 'dashboard' ? 'account-dashboard-tab--active' : ''
          }`}
          data-testid="portfolio-tab-dashboard"
          onClick={() => setActiveTab('dashboard')}
        >
          대시보드
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'history'}
          className={`account-dashboard-tab ${
            activeTab === 'history' ? 'account-dashboard-tab--active' : ''
          }`}
          data-testid="portfolio-tab-history"
          onClick={() => setActiveTab('history')}
        >
          주문 내역
        </button>
      </section>

      <section className="account-symbol-panel">
        <div>
          <p className="status-kicker">Owned positions</p>
          <h3>보유 종목 조회</h3>
          <p className="account-symbol-panel__description">
            백엔드가 반환한 보유 종목 리스트를 그대로 사용해 대표 종목과 요약을 구성합니다.
          </p>
        </div>

        {!hasLinkedAccount ? (
          <p className="account-symbol-panel__hint" data-testid="portfolio-symbol-unavailable">
            연결된 계좌가 없어 보유 종목 리스트를 불러올 수 없습니다.
          </p>
        ) : null}

        {hasLinkedAccount && symbolOptions.length > 0 ? (
          <div className="account-symbol-selector" aria-label="대표 종목 조회">
            {symbolOptions.map((symbol) => (
              <button
                key={symbol}
                type="button"
                className={`account-history-toolbar__button ${
                  selectedSymbol === symbol
                    ? 'account-history-toolbar__button--active'
                    : ''
                }`}
                data-testid={`portfolio-symbol-${symbol}`}
                onClick={() => setSelectedSymbol(symbol)}
              >
                {symbol}
              </button>
            ))}
          </div>
        ) : null}

        {hasLinkedAccount && !positionsLoading && symbolOptionsError ? (
          <div className="account-state-panel" data-testid="portfolio-symbol-error">
            <strong>보유 종목 리스트를 불러오지 못했습니다</strong>
            <p>{symbolOptionsError.message}</p>
            <p>{symbolOptionsError.nextStep}</p>
            <button
              type="button"
              className="portfolio-action portfolio-action--secondary"
              data-testid="portfolio-symbol-retry"
              onClick={retryPosition}
            >
              다시 시도
            </button>
          </div>
        ) : null}

        {hasLinkedAccount
        && !positionsLoading
        && !symbolOptionsError
        && symbolOptions.length === 0 ? (
          <p className="account-symbol-panel__hint" data-testid="portfolio-symbol-empty">
            아직 보유 중인 종목이 없습니다.
          </p>
        ) : null}

        {hasLinkedAccount && selectedSymbol ? (
          <p className="account-symbol-panel__hint">
            현재 조회 종목 <strong>{selectedSymbol}</strong>
          </p>
        ) : null}
      </section>

      {activeTab === 'dashboard' ? (
        <section className="account-dashboard-grid">
          <article className="account-card">
            <header className="account-card__header">
              <div>
                <p className="status-kicker">Balance</p>
                <h3>계좌 요약</h3>
              </div>
              <span className="account-card__meta">
                {member?.name ?? '사용자'} / {maskedAccountNumber}
              </span>
            </header>

            {!hasLinkedAccount ? (
              <div className="account-state-panel" data-testid="portfolio-summary-unavailable">
                <strong>계좌 요약을 조회할 수 없습니다</strong>
                <p>연결된 계좌가 없어 계좌 요약을 불러올 수 없습니다.</p>
              </div>
            ) : null}

            {hasLinkedAccount && summaryLoading ? (
              <p className="account-state-copy" data-testid="portfolio-summary-loading">
                계좌 요약을 불러오는 중입니다.
              </p>
            ) : null}

            {hasLinkedAccount && !summaryLoading && summaryError ? (
              <div className="account-state-panel" data-testid="portfolio-summary-error">
                <strong>계좌 요약을 불러오지 못했습니다</strong>
                <p>{summaryError.message}</p>
                <p>{summaryError.nextStep}</p>
                <button
                  type="button"
                  className="portfolio-action portfolio-action--secondary"
                  data-testid="portfolio-summary-retry"
                  onClick={retryPosition}
                >
                  다시 시도
                </button>
              </div>
            ) : null}

            {hasLinkedAccount && !summaryLoading && !summaryError && summary ? (
              <div className="account-summary-grid">
                {valuationPosition ? (
                  <DashboardQuoteTicker position={valuationPosition} />
                ) : null}
                <div className="account-summary-cell">
                  <span className="account-summary-cell__label">예수금</span>
                  <strong
                    className="account-summary-cell__value"
                    data-testid="portfolio-total-balance"
                  >
                    {formatKRW(summary.balance)}
                  </strong>
                </div>
                <div className="account-summary-cell">
                  <span className="account-summary-cell__label">가용 수량</span>
                  <strong data-testid="portfolio-available-quantity">
                    {formatQuantity(holdingPosition?.availableQuantity ?? summary.availableQuantity)}주
                  </strong>
                </div>
                <div className="account-summary-cell">
                  <span className="account-summary-cell__label">보유 수량</span>
                  <strong>{formatQuantity(holdingPosition?.quantity ?? summary.quantity)}주</strong>
                </div>
                <div className="account-summary-cell">
                  <span className="account-summary-cell__label">조회 기준</span>
                  <strong data-testid="portfolio-summary-as-of">
                    {formatDashboardTimestamp(summary.asOf)}
                  </strong>
                </div>
                {valuationPosition ? (
                  <>
                    <div className="account-summary-cell">
                      <span className="account-summary-cell__label">평가 상태</span>
                      <strong data-testid="portfolio-valuation-status">
                        {resolveValuationStatusLabel(valuationStatus)}
                      </strong>
                    </div>
                    <div className="account-summary-cell">
                      <span className="account-summary-cell__label">평균 단가</span>
                      <strong data-testid="portfolio-avg-price">
                        {formatAveragePriceValue(valuationPosition)}
                      </strong>
                    </div>
                    <div className="account-summary-cell">
                      <span className="account-summary-cell__label">평가 단가</span>
                      <strong data-testid="portfolio-market-price">
                        {formatMarketDerivedKRW(
                          valuationPosition.marketPrice,
                          valuationStatus,
                        )}
                      </strong>
                    </div>
                    <div className="account-summary-cell">
                      <span className="account-summary-cell__label">미실현 손익</span>
                      <strong
                        className={`account-summary-cell__value ${getPnlToneClassName(
                          valuationPosition.unrealizedPnl,
                          valuationStatus,
                        )}`}
                        data-testid="portfolio-unrealized-pnl"
                      >
                        {formatPnlValue(valuationPosition.unrealizedPnl, valuationStatus)}
                      </strong>
                    </div>
                    <div className="account-summary-cell">
                      <span className="account-summary-cell__label">당일 실현 손익</span>
                      <strong
                        className={`account-summary-cell__value ${getPnlToneClassName(
                          valuationPosition.realizedPnlDaily,
                          valuationStatus,
                        )}`}
                        data-testid="portfolio-realized-pnl-daily"
                      >
                        {formatPnlValue(valuationPosition.realizedPnlDaily, valuationStatus)}
                      </strong>
                    </div>
                    <div className="account-summary-cell">
                      <span className="account-summary-cell__label">호가 기준 시각</span>
                      <strong data-testid="portfolio-quote-as-of">
                        {formatDashboardTimestamp(valuationPosition.quoteAsOf)}
                      </strong>
                    </div>
                    <div className="account-summary-cell">
                      <span className="account-summary-cell__label">호가 source</span>
                      <strong data-testid="portfolio-quote-source-mode">
                        {formatOptionalQuoteSource(valuationPosition.quoteSourceMode)}
                      </strong>
                    </div>
                    {valuationGuidance ? (
                      <div
                        className="account-state-panel account-summary-grid__guidance"
                        data-testid="portfolio-valuation-guidance"
                      >
                        <strong>{resolveValuationStatusLabel(valuationStatus)}</strong>
                        <p>{valuationGuidance}</p>
                        <p>
                          quoteAsOf {formatDashboardTimestamp(valuationPosition.quoteAsOf)} / source{' '}
                          {formatOptionalQuoteSource(valuationPosition.quoteSourceMode)}
                        </p>
                      </div>
                    ) : null}
                  </>
                ) : null}
              </div>
            ) : null}

            {hasLinkedAccount && !summaryLoading && !summaryError && !summary ? (
              <p className="account-state-copy" data-testid="portfolio-summary-empty">
                아직 보유 중인 종목이 없어 계좌 요약을 표시할 수 없습니다.
              </p>
            ) : null}
          </article>

          <article className="account-card">
            <header className="account-card__header">
              <div>
                <p className="status-kicker">Contract</p>
                <h3>조회 원칙</h3>
              </div>
            </header>

            <ul className="account-guidance-list">
              <li>예수금은 backend canonical balance 값을 그대로 노출합니다.</li>
              <li>계좌 식별자는 웹 화면 전체에서 동일한 마스킹 규칙을 사용합니다.</li>
              <li>주문 내역은 page/size 계약 변경 시마다 서버에서 다시 조회합니다.</li>
            </ul>
          </article>
        </section>
      ) : (
        <section className="account-card">
          <header className="account-card__header">
            <div>
              <p className="status-kicker">Order history</p>
              <h3>최근 주문 이력</h3>
            </div>
            <span className="account-card__meta">
              {historyTotalElements}건 / {maskedAccountNumber}
            </span>
          </header>

          <div className="account-history-toolbar">
            <div className="account-history-toolbar__sizes" aria-label="페이지 크기 선택">
              {HISTORY_PAGE_SIZE_OPTIONS.map((size) => (
                <button
                  key={size}
                  type="button"
                  className={`account-history-toolbar__button ${
                    historyPageSize === size
                      ? 'account-history-toolbar__button--active'
                      : ''
                  }`}
                  data-testid={`portfolio-history-size-${size}`}
                  disabled={!hasLinkedAccount || historyLoading}
                  onClick={() => setHistoryPageSize(size)}
                >
                  {size}건
                </button>
              ))}
            </div>

            <div className="account-history-toolbar__pager">
              <button
                type="button"
                className="account-history-toolbar__button"
                data-testid="portfolio-history-prev"
                disabled={!hasLinkedAccount || historyPage === 0 || historyLoading}
                onClick={() => setHistoryPage(Math.max(0, historyPage - 1))}
              >
                이전
              </button>
              <span data-testid="portfolio-history-page-indicator">
                {historyTotalPages === 0 ? 0 : historyPage + 1} / {historyTotalPages}
              </span>
              <button
                type="button"
                className="account-history-toolbar__button"
                data-testid="portfolio-history-next"
                disabled={
                  !hasLinkedAccount
                  || historyLoading
                  || historyTotalPages === 0
                  || historyPage + 1 >= historyTotalPages
                }
                onClick={() => setHistoryPage(historyPage + 1)}
              >
                다음
              </button>
            </div>
          </div>

          {!hasLinkedAccount ? (
            <div className="account-state-panel" data-testid="portfolio-history-unavailable">
              <strong>주문 내역을 조회할 수 없습니다</strong>
              <p>연결된 계좌가 없어 주문 내역을 조회할 수 없습니다.</p>
            </div>
          ) : null}

          {hasLinkedAccount && historyLoading ? (
            <p className="account-state-copy" data-testid="portfolio-history-loading">
              주문 내역을 조회하는 중입니다.
            </p>
          ) : null}

          {hasLinkedAccount && !historyLoading && historyError ? (
            <div className="account-state-panel" data-testid="portfolio-history-error">
              <strong>주문 내역을 불러오지 못했습니다</strong>
              <p>{historyError.message}</p>
              <p>{historyError.nextStep}</p>
              <button
                type="button"
                className="portfolio-action portfolio-action--secondary"
                data-testid="portfolio-history-retry"
                onClick={retryHistory}
              >
                다시 시도
              </button>
            </div>
          ) : null}

          {hasLinkedAccount && !historyLoading && !historyError && historyItems.length === 0 ? (
            <p className="account-state-copy" data-testid="order-list-empty">
              아직 주문 내역이 없습니다.
            </p>
          ) : null}

          {hasLinkedAccount && !historyLoading && !historyError && historyItems.length > 0 ? (
            <div className="account-history-list" data-testid="order-list">
              {historyItems.map((item) => (
                <article
                  key={item.clOrdId}
                  className="account-history-row"
                  data-testid={`order-row-${item.clOrdId}`}
                >
                  <div>
                    <strong>{item.symbolName}</strong>
                    <p>{item.symbol}</p>
                  </div>
                  <div>
                    <strong>{item.side}</strong>
                    <p>{formatQuantity(item.qty)}주</p>
                  </div>
                  <div data-testid={`order-amount-${item.clOrdId}`}>
                    <strong>{formatKRW(item.totalAmount)}</strong>
                    <p>{formatKRW(item.unitPrice)}</p>
                  </div>
                  <div data-testid={`order-status-${item.clOrdId}`}>
                    <strong>{item.status}</strong>
                    <p>{dateFormatter.format(new Date(item.createdAt))}</p>
                    <p data-testid={`order-cl-ord-id-${item.clOrdId}`}>{item.clOrdId}</p>
                  </div>
                </article>
              ))}
            </div>
          ) : null}
        </section>
      )}
    </section>
  );
}
