import { Link } from 'react-router-dom';

import { usePortfolioExperience } from '@/hooks/portfolio/usePortfolioExperience';
import { hasExternalOrderAccountId } from '@/order/external-order-recovery';

export function PortfolioPage() {
  const {
    viewer,
    rangeOptions,
    profileOptions,
    holdings,
    watchItems,
    selectedRange,
    selectedProfile,
    selectedHolding,
    selectedWatch,
    selectedSnapshot,
    chartPolyline,
    setSelectedRange,
    setSelectedProfile,
    setSelectedHoldingId,
    setSelectedWatchId,
  } = usePortfolioExperience();
  const hasOrderAccount = hasExternalOrderAccountId(viewer?.accountId);

  return (
    <section className="portfolio-grid">
      <section className="portfolio-hero">
        <article className="portfolio-surface portfolio-surface--hero">
          <div className="portfolio-hero__copy">
            <p className="status-kicker">Interactive portfolio</p>
            <h2 data-testid="protected-area-title">Portfolio overview</h2>
            <p className="portfolio-hero__description">
              FIX 플랫폼의 포트폴리오 화면을 대시보드 형태로 재구성했습니다.
              기간별 추세, 자산 선택, 관심 종목 시나리오를 한 화면에서 검토할 수 있습니다.
            </p>
          </div>

          <div className="portfolio-hero__controls">
            <div
              className="portfolio-segmented"
              aria-label="포트폴리오 기간 선택"
              role="tablist"
            >
              {rangeOptions.map((range) => (
                <button
                  key={range}
                  type="button"
                  role="tab"
                  aria-selected={selectedRange === range}
                  className={`portfolio-segmented__button ${
                    selectedRange === range ? 'portfolio-segmented__button--active' : ''
                  }`}
                  data-testid={`portfolio-range-${range}`}
                  onClick={() => setSelectedRange(range)}
                >
                  {range}
                </button>
              ))}
            </div>

            <div className="portfolio-profile-switch" aria-label="전략 강도 선택">
              {profileOptions.map((profile) => (
                <button
                  key={profile}
                  type="button"
                  className={`portfolio-profile-switch__button ${
                    selectedProfile === profile
                      ? 'portfolio-profile-switch__button--active'
                      : ''
                  }`}
                  data-testid={`portfolio-profile-${profile}`}
                  onClick={() => setSelectedProfile(profile)}
                >
                  {profile}
                </button>
              ))}
            </div>
          </div>
        </article>

        <article className="portfolio-surface portfolio-surface--summary">
          <p className="portfolio-summary__eyebrow">{selectedSnapshot.label}</p>
          <h3 className="portfolio-summary__value" data-testid="portfolio-total-value">
            {selectedSnapshot.totalValue}
          </h3>
          <p
            className={`portfolio-summary__delta ${
              selectedSnapshot.deltaTone === 'positive'
                ? 'portfolio-summary__delta--positive'
                : ''
            }`}
          >
            {selectedSnapshot.delta}
          </p>

          <dl className="portfolio-summary__stats">
            <div>
              <dt>현금 비중</dt>
              <dd>{selectedSnapshot.cash}</dd>
            </div>
            <div>
              <dt>집중 포인트</dt>
              <dd>{selectedSnapshot.focusLabel}</dd>
            </div>
            <div>
              <dt>리밸런싱 큐</dt>
              <dd>{selectedSnapshot.rebalanceCue}</dd>
            </div>
          </dl>

          <div className="portfolio-summary__actions">
            {hasOrderAccount ? (
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
            <button
              type="button"
              className="portfolio-action portfolio-action--secondary"
              data-testid="portfolio-demo-transfer"
              disabled
            >
              입출금 연동 준비 중
            </button>
          </div>
        </article>
      </section>

      <section className="portfolio-dashboard">
        <article className="portfolio-surface portfolio-surface--chart">
          <header className="portfolio-card__header">
            <div>
              <p className="status-kicker">Performance</p>
              <h3>{selectedHolding.name} 흐름</h3>
            </div>
            <span className="portfolio-card__chip" data-testid="portfolio-selected-holding">
              {selectedHolding.name}
            </span>
          </header>

          <div className="portfolio-chart">
            <svg
              aria-label={`${selectedHolding.name} 성과 차트`}
              className="portfolio-chart__svg"
              data-testid="portfolio-performance-chart"
              viewBox="0 0 340 168"
            >
              <defs>
                <linearGradient id="portfolio-line" x1="0%" x2="100%" y1="0%" y2="0%">
                  <stop offset="0%" stopColor="#f08400" />
                  <stop offset="100%" stopColor="#0b63ce" />
                </linearGradient>
              </defs>
              <path
                d="M 14 154 H 326"
                className="portfolio-chart__baseline"
              />
              <polyline
                className="portfolio-chart__line"
                fill="none"
                points={chartPolyline}
                stroke="url(#portfolio-line)"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="4"
              />
            </svg>

            <div className="portfolio-chart__meta">
              <div>
                <p className="portfolio-chart__label">선택 기간</p>
                <strong data-testid="portfolio-selected-range">{selectedRange}</strong>
              </div>
              <div>
                <p className="portfolio-chart__label">포지션 메모</p>
                <strong>{selectedHolding.riskLabel}</strong>
              </div>
              <div>
                <p className="portfolio-chart__label">전략 가이드</p>
                <strong>{selectedHolding.profileCue[selectedProfile]}</strong>
              </div>
            </div>
          </div>
        </article>

        <article className="portfolio-surface portfolio-surface--holdings">
          <header className="portfolio-card__header">
            <div>
              <p className="status-kicker">Holdings</p>
              <h3>보유 자산</h3>
            </div>
            <span className="portfolio-card__meta">{viewer?.accountId ?? '계좌 연동 대기'}</span>
          </header>

          <div className="portfolio-holdings">
            {holdings.map((holding) => {
              const isActive = holding.id === selectedHolding.id;

              return (
                <button
                  key={holding.id}
                  type="button"
                  className={`portfolio-holding-card ${
                    isActive ? 'portfolio-holding-card--active' : ''
                  }`}
                  data-testid={`portfolio-holding-${holding.id}`}
                  onClick={() => setSelectedHoldingId(holding.id)}
                >
                  <div className="portfolio-holding-card__topline">
                    <div>
                      <strong>{holding.name}</strong>
                      <span>{holding.symbol}</span>
                    </div>
                    <span className="portfolio-holding-card__delta">{holding.delta}</span>
                  </div>
                  <p className="portfolio-holding-card__value">{holding.value}</p>
                  <div className="portfolio-holding-card__bar">
                    <span style={{ width: `${holding.allocation}%` }} />
                  </div>
                  <div className="portfolio-holding-card__foot">
                    <span>{holding.amount}</span>
                    <span>{holding.allocation}%</span>
                  </div>
                </button>
              );
            })}
          </div>
        </article>

        <article className="portfolio-surface portfolio-surface--insight">
          <header className="portfolio-card__header">
            <div>
              <p className="status-kicker">Position memo</p>
              <h3>{selectedHolding.name} 메모</h3>
            </div>
            <span className="portfolio-card__chip">{selectedProfile}</span>
          </header>

          <p className="portfolio-insight__body" data-testid="portfolio-position-thesis">
            {selectedHolding.thesis}
          </p>

          <dl className="portfolio-insight__stats">
            <div>
              <dt>전략 강도</dt>
              <dd>{selectedHolding.profileCue[selectedProfile]}</dd>
            </div>
            <div>
              <dt>현재 비중</dt>
              <dd>{selectedHolding.allocation}%</dd>
            </div>
            <div>
              <dt>담당자</dt>
              <dd>{viewer?.name ?? 'FIX Demo Desk'}</dd>
            </div>
          </dl>
        </article>

        <article className="portfolio-surface portfolio-surface--watchlist">
          <header className="portfolio-card__header">
            <div>
              <p className="status-kicker">Watchlist</p>
              <h3>관심 종목</h3>
            </div>
            <span className="portfolio-card__meta" data-testid="portfolio-selected-watch">
              {selectedWatch.name}
            </span>
          </header>

          <div className="portfolio-watchlist">
            {watchItems.map((item) => {
              const isActive = item.id === selectedWatch.id;

              return (
                <button
                  key={item.id}
                  type="button"
                  className={`portfolio-watch-item ${
                    isActive ? 'portfolio-watch-item--active' : ''
                  }`}
                  data-testid={`portfolio-watch-${item.id}`}
                  onClick={() => setSelectedWatchId(item.id)}
                >
                  <div>
                    <strong>{item.name}</strong>
                    <span>{item.market}</span>
                  </div>
                  <div className="portfolio-watch-item__meta">
                    <span>{item.price}</span>
                    <span>{item.delta}</span>
                  </div>
                </button>
              );
            })}
          </div>

          <section className="portfolio-watch-spotlight">
            <p className="portfolio-watch-spotlight__signal">{selectedWatch.signal}</p>
            <h4>{selectedWatch.name}</h4>
            <p>{selectedWatch.note}</p>
            <dl>
              <div>
                <dt>티커</dt>
                <dd>{selectedWatch.ticker}</dd>
              </div>
              <div>
                <dt>전략 메모</dt>
                <dd>{selectedWatch.profileCue[selectedProfile]}</dd>
              </div>
            </dl>
            <button
              type="button"
              className="portfolio-action portfolio-action--secondary"
              data-testid="portfolio-watch-cta"
              disabled
            >
              실거래 알림 준비 중
            </button>
          </section>
        </article>
      </section>
    </section>
  );
}
