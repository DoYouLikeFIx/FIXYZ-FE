import type { AccountPosition, QuoteSourceMode } from '@/types/account';
import { formatKRW } from '@/utils/formatters';

const quoteDateFormatter = new Intl.DateTimeFormat('ko-KR', {
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

const PREVIEW_CANDLE_COUNT = 18;

interface PreviewCandle {
  open: number;
  close: number;
  high: number;
  low: number;
}

const normalizePrice = (value: number) => Math.max(10, Math.round(value / 10) * 10);

const hashKey = (input: string) =>
  input.split('').reduce((accumulator, character) => (
    (accumulator * 31 + character.charCodeAt(0)) % 2_147_483_647
  ), 7);

const createSeededRandom = (seed: number) => {
  let value = seed % 2_147_483_647;

  if (value <= 0) {
    value += 2_147_483_646;
  }

  return () => {
    value = (value * 16_807) % 2_147_483_647;
    return (value - 1) / 2_147_483_646;
  };
};

const getChartTone = (quoteSourceMode: QuoteSourceMode | null | undefined) => {
  switch (quoteSourceMode) {
    case 'DELAYED':
      return {
        bullishCandles: 8,
        modeTone: 'delayed',
        stateLabel: '지연 호가',
        volatilityRatio: 0.0036,
      } as const;
    case 'REPLAY':
      return {
        bullishCandles: 6,
        modeTone: 'replay',
        stateLabel: '리플레이 기준',
        volatilityRatio: 0.0028,
      } as const;
    case 'LIVE':
    default:
      return {
        bullishCandles: 11,
        modeTone: 'live',
        stateLabel: '직결 시세',
        volatilityRatio: 0.0048,
      } as const;
  }
};

const buildPreviewCandles = (
  marketPrice: number,
  symbol: string,
  quoteSourceMode: QuoteSourceMode | null | undefined,
) => {
  const chartTone = getChartTone(quoteSourceMode);
  const random = createSeededRandom(hashKey(`${symbol}:${quoteSourceMode ?? 'UNKNOWN'}`));
  const closes = Array.from({ length: PREVIEW_CANDLE_COUNT }, (_, index) => {
    const progress = index / Math.max(PREVIEW_CANDLE_COUNT - 1, 1);
    const wave = Math.sin(progress * Math.PI * 1.7 + random() * 0.6);
    const drift = (progress - 0.5) * marketPrice * chartTone.volatilityRatio * 1.6;
    const jitter = (random() - 0.5) * marketPrice * chartTone.volatilityRatio * 0.75;

    return marketPrice + wave * marketPrice * chartTone.volatilityRatio + drift + jitter;
  });
  const shift = marketPrice - closes[closes.length - 1];

  return closes.map((closeValue, index) => {
    const previousClose = index === 0
      ? closeValue + shift - marketPrice * chartTone.volatilityRatio * 0.65
      : closes[index - 1] + shift;
    const driftBias = index < chartTone.bullishCandles ? 1 : -1;
    const bodyOffset =
      driftBias * marketPrice * chartTone.volatilityRatio * (0.16 + random() * 0.18);
    const close = normalizePrice(closeValue + shift);
    const open = normalizePrice(previousClose - bodyOffset);
    const high = normalizePrice(
      Math.max(open, close) + marketPrice * chartTone.volatilityRatio * (0.14 + random() * 0.2),
    );
    const low = normalizePrice(
      Math.min(open, close) - marketPrice * chartTone.volatilityRatio * (0.14 + random() * 0.2),
    );

    return {
      close,
      high,
      low,
      open,
    };
  });
};

const buildChartMetrics = (candles: PreviewCandle[]) => {
  const max = Math.max(...candles.map((candle) => candle.high));
  const min = Math.min(...candles.map((candle) => candle.low));
  const safeRange = max - min || 1;

  return {
    max,
    min,
    toPercent: (value: number) => ((value - min) / safeRange) * 100,
  };
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

  const chartTone = getChartTone(position.quoteSourceMode);
  const candles = buildPreviewCandles(
    position.marketPrice,
    position.symbol,
    position.quoteSourceMode,
  );
  const chartMetrics = buildChartMetrics(candles);

  return (
    <section
      className={`dashboard-quote-ticker dashboard-quote-ticker--${chartTone.modeTone}`}
      data-testid="portfolio-dashboard-quote-ticker"
      aria-label="대시보드 시세 chart"
    >
      <div className="dashboard-quote-ticker__topline">
        <p className="dashboard-quote-ticker__eyebrow">FIXYZ Quote Window</p>
        <span className="dashboard-quote-ticker__board-id">1D preview</span>
      </div>

      <div className="dashboard-quote-ticker__board">
        <div className="dashboard-quote-ticker__price-panel">
          <div className="dashboard-quote-ticker__symbol-row">
            <strong
              className="dashboard-quote-ticker__symbol"
              data-testid="portfolio-dashboard-quote-ticker-symbol"
            >
              {position.symbol}
            </strong>
            <span className="dashboard-quote-ticker__market-chip">KRX</span>
            <span className="dashboard-quote-ticker__preview-chip">candles</span>
          </div>

          <div className="dashboard-quote-ticker__price-row">
            <span className="dashboard-quote-ticker__price-label">현재가</span>
            <strong
              className="dashboard-quote-ticker__price"
              data-testid="portfolio-dashboard-quote-ticker-price"
            >
              {formatKRW(position.marketPrice)}
            </strong>
          </div>
        </div>

        <div className="dashboard-quote-ticker__status-panel">
          <span
            className="dashboard-quote-ticker__badge"
            data-testid="portfolio-dashboard-quote-ticker-mode"
          >
            {position.quoteSourceMode}
          </span>
          <span
            className="dashboard-quote-ticker__state"
            data-testid="portfolio-dashboard-quote-ticker-state"
          >
            {chartTone.stateLabel}
          </span>
          <span className="dashboard-quote-ticker__status-note">
            snapshot-seeded preview
          </span>
        </div>
      </div>

      <div
        className="dashboard-quote-ticker__chart"
        data-testid="portfolio-dashboard-quote-ticker-chart"
      >
        <div className="dashboard-quote-ticker__chart-board">
          <div className="dashboard-quote-ticker__chart-grid" aria-hidden="true">
            {Array.from({ length: 4 }, (_, index) => (
              <span
                key={`grid-line-${index + 1}`}
                className="dashboard-quote-ticker__grid-line"
              />
            ))}
          </div>

          <div className="dashboard-quote-ticker__candle-strip" aria-hidden="true">
            {candles.map((candle, index) => {
              const openPercent = chartMetrics.toPercent(candle.open);
              const closePercent = chartMetrics.toPercent(candle.close);
              const highPercent = chartMetrics.toPercent(candle.high);
              const lowPercent = chartMetrics.toPercent(candle.low);
              const upperBodyPercent = Math.max(openPercent, closePercent);
              const lowerBodyPercent = Math.min(openPercent, closePercent);
              const isBullish = candle.close >= candle.open;

              return (
                <div
                  key={`candle-${index + 1}`}
                  className={`dashboard-quote-ticker__candle ${
                    isBullish
                      ? 'dashboard-quote-ticker__candle--bullish'
                      : 'dashboard-quote-ticker__candle--bearish'
                  }`}
                  data-testid="portfolio-dashboard-quote-ticker-candle"
                >
                  <span
                    className="dashboard-quote-ticker__wick"
                    style={{
                      bottom: `${lowPercent}%`,
                      top: `${100 - highPercent}%`,
                    }}
                  />
                  <span
                    className="dashboard-quote-ticker__body"
                    style={{
                      bottom: `${lowerBodyPercent}%`,
                      top: `${100 - upperBodyPercent}%`,
                    }}
                  />
                </div>
              );
            })}
          </div>

          <div className="dashboard-quote-ticker__chart-scale">
            <span>{formatKRW(chartMetrics.max)}</span>
            <span>{formatKRW(position.marketPrice)}</span>
            <span>{formatKRW(chartMetrics.min)}</span>
          </div>
        </div>

        <div className="dashboard-quote-ticker__chart-axis">
          <span>open</span>
          <span>mid</span>
          <span>now</span>
        </div>
      </div>

      <div className="dashboard-quote-ticker__meta-table">
        <div className="dashboard-quote-ticker__meta-item">
          <span className="dashboard-quote-ticker__meta-label">호가 기준 시각</span>
          <strong data-testid="portfolio-dashboard-quote-ticker-quote-as-of">
            {quoteDateFormatter.format(new Date(position.quoteAsOf))}
          </strong>
        </div>
        <div className="dashboard-quote-ticker__meta-item">
          <span className="dashboard-quote-ticker__meta-label">조회 기준</span>
          <strong>{quoteDateFormatter.format(new Date(position.asOf))}</strong>
        </div>
        <div className="dashboard-quote-ticker__meta-item">
          <span className="dashboard-quote-ticker__meta-label">Snapshot</span>
          <strong data-testid="portfolio-dashboard-quote-ticker-snapshot">
            {position.quoteSnapshotId ?? 'pending'}
          </strong>
        </div>
        <div className="dashboard-quote-ticker__meta-item">
          <span className="dashboard-quote-ticker__meta-label">시세 상태</span>
          <strong>{chartTone.stateLabel}</strong>
        </div>
      </div>
    </section>
  );
}
