import type { AccountPosition, QuoteSourceMode } from '@/types/account';
import { formatKRW } from '@/utils/formatters';

const quoteDateFormatter = new Intl.DateTimeFormat('ko-KR', {
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

type QuoteTone = {
  modeTone: 'live' | 'delayed' | 'replay' | 'neutral';
  stateLabel: string;
  statusNote: string;
};

const getQuoteTone = (quoteSourceMode: QuoteSourceMode | null | undefined): QuoteTone => {
  switch (quoteSourceMode) {
    case 'LIVE':
      return {
        modeTone: 'live',
        stateLabel: '직결 시세',
        statusNote: '실시간 기준',
      };
    case 'DELAYED':
      return {
        modeTone: 'delayed',
        stateLabel: '지연 호가',
        statusNote: '지연 도착 데이터',
      };
    case 'REPLAY':
      return {
        modeTone: 'replay',
        stateLabel: '리플레이 기준',
        statusNote: '재생 스냅샷',
      };
    default:
      return {
        modeTone: 'neutral',
        stateLabel: '미확인 시세',
        statusNote: '새 source mode',
      };
  }
};

const formatModeLabel = (quoteSourceMode: QuoteSourceMode | null | undefined) => {
  const normalized = typeof quoteSourceMode === 'string' ? quoteSourceMode.trim() : '';
  return normalized || 'UNKNOWN';
};

const formatFreshnessAge = (quoteAsOf: string, asOf: string) => {
  const quoteTime = new Date(quoteAsOf).getTime();
  const asOfTime = new Date(asOf).getTime();

  if (!Number.isFinite(quoteTime) || !Number.isFinite(asOfTime)) {
    return '시각 확인 필요';
  }

  const deltaMs = Math.abs(asOfTime - quoteTime);

  if (deltaMs < 60_000) {
    return '동일 시각';
  }

  const deltaMinutes = Math.round(deltaMs / 60_000);

  if (deltaMinutes < 60) {
    return `${deltaMinutes}분 차이`;
  }

  const hours = Math.floor(deltaMinutes / 60);
  const minutes = deltaMinutes % 60;

  return minutes > 0
    ? `${hours}시간 ${minutes}분 차이`
    : `${hours}시간 차이`;
};

interface DashboardQuoteTickerProps {
  position: AccountPosition;
}

export function DashboardQuoteTicker({ position }: DashboardQuoteTickerProps) {
  if (
    position.marketPrice === null
    || position.marketPrice === undefined
    || !position.quoteAsOf
    || !position.quoteSourceMode
  ) {
    return null;
  }

  const quoteTone = getQuoteTone(position.quoteSourceMode);
  const modeLabel = formatModeLabel(position.quoteSourceMode);
  const freshnessAge = formatFreshnessAge(position.quoteAsOf, position.asOf);

  return (
    <section
      className={`fix-dashboard-quote-ticker fix-dashboard-quote-ticker--${quoteTone.modeTone}`}
      data-testid="portfolio-dashboard-quote-ticker"
      aria-label="대시보드 시세 freshness"
    >
      <div className="fix-dashboard-quote-ticker__topline">
        <p className="fix-dashboard-quote-ticker__eyebrow">FIXYZ Quote Window</p>
        <span className="fix-dashboard-quote-ticker__board-id">Freshness panel</span>
      </div>

      <div className="fix-dashboard-quote-ticker__board">
        <div className="fix-dashboard-quote-ticker__price-panel">
          <div className="fix-dashboard-quote-ticker__symbol-row">
            <strong
              className="fix-dashboard-quote-ticker__symbol"
              data-testid="portfolio-dashboard-quote-ticker-symbol"
            >
              {position.symbol}
            </strong>
            <span className="fix-dashboard-quote-ticker__market-chip">KRX</span>
            <span className="fix-dashboard-quote-ticker__preview-chip">snapshot</span>
          </div>

          <div className="fix-dashboard-quote-ticker__price-row">
            <span className="fix-dashboard-quote-ticker__price-label">현재가</span>
            <strong
              className="fix-dashboard-quote-ticker__price"
              data-testid="portfolio-dashboard-quote-ticker-price"
            >
              {formatKRW(position.marketPrice)}
            </strong>
          </div>
        </div>

        <div className="fix-dashboard-quote-ticker__status-panel">
          <span
            className="fix-dashboard-quote-ticker__badge"
            data-testid="portfolio-dashboard-quote-ticker-mode"
          >
            {modeLabel}
          </span>
          <span
            className="fix-dashboard-quote-ticker__state"
            data-testid="portfolio-dashboard-quote-ticker-state"
          >
            {quoteTone.stateLabel}
          </span>
          <span
            className="fix-dashboard-quote-ticker__status-note"
            data-testid="portfolio-dashboard-quote-ticker-status-note"
          >
            {quoteTone.statusNote}
          </span>
        </div>
      </div>

      <div
        className="fix-dashboard-quote-ticker__chart"
        data-testid="portfolio-dashboard-quote-ticker-chart"
      >
        <div className="fix-dashboard-quote-ticker__freshness-panel">
          <div className="fix-dashboard-quote-ticker__freshness-item">
            <span className="fix-dashboard-quote-ticker__meta-label">시각 차이</span>
            <strong data-testid="portfolio-dashboard-quote-ticker-freshness-age">
              {freshnessAge}
            </strong>
            <span className="fix-dashboard-quote-ticker__freshness-helper">
              quoteAsOf 대비 조회 기준 차이
            </span>
          </div>
          <div className="fix-dashboard-quote-ticker__freshness-item">
            <span className="fix-dashboard-quote-ticker__meta-label">Source 해석</span>
            <strong>{quoteTone.statusNote}</strong>
            <span className="fix-dashboard-quote-ticker__freshness-helper">
              backend source mode를 그대로 보여줍니다.
            </span>
          </div>
          <div className="fix-dashboard-quote-ticker__freshness-item">
            <span className="fix-dashboard-quote-ticker__meta-label">표시 원칙</span>
            <strong>히스토리 차트 미사용</strong>
            <span className="fix-dashboard-quote-ticker__freshness-helper">
              실제 가격 흐름을 합성하지 않습니다.
            </span>
          </div>
        </div>
        <p className="fix-dashboard-quote-ticker__chart-footnote">
          서버가 내려준 quote freshness 메타데이터만 요약합니다.
        </p>
      </div>

      <div className="fix-dashboard-quote-ticker__meta-table">
        <div className="fix-dashboard-quote-ticker__meta-item">
          <span className="fix-dashboard-quote-ticker__meta-label">호가 기준 시각</span>
          <strong data-testid="portfolio-dashboard-quote-ticker-quote-as-of">
            {quoteDateFormatter.format(new Date(position.quoteAsOf))}
          </strong>
        </div>
        <div className="fix-dashboard-quote-ticker__meta-item">
          <span className="fix-dashboard-quote-ticker__meta-label">조회 기준</span>
          <strong>{quoteDateFormatter.format(new Date(position.asOf))}</strong>
        </div>
        <div className="fix-dashboard-quote-ticker__meta-item">
          <span className="fix-dashboard-quote-ticker__meta-label">Snapshot</span>
          <strong data-testid="portfolio-dashboard-quote-ticker-snapshot">
            {position.quoteSnapshotId ?? 'pending'}
          </strong>
        </div>
        <div className="fix-dashboard-quote-ticker__meta-item">
          <span className="fix-dashboard-quote-ticker__meta-label">시세 상태</span>
          <strong>{quoteTone.stateLabel}</strong>
        </div>
      </div>
    </section>
  );
}
