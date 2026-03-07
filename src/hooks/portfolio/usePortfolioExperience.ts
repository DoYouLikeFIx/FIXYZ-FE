import { useState } from 'react';

import { useAuthStore } from '@/store/useAuthStore';

type RangeKey = '1D' | '1W' | '1M' | '1Y';
type ProfileKey = '안정형' | '균형형' | '공격형';

interface RangeSnapshot {
  label: string;
  totalValue: string;
  delta: string;
  deltaTone: 'positive' | 'neutral';
  cash: string;
  rebalanceCue: string;
  focusLabel: string;
}

interface Holding {
  id: string;
  name: string;
  symbol: string;
  value: string;
  amount: string;
  allocation: number;
  delta: string;
  thesis: string;
  riskLabel: string;
  profileCue: Record<ProfileKey, string>;
  trend: Record<RangeKey, number[]>;
}

interface WatchItem {
  id: string;
  name: string;
  ticker: string;
  market: string;
  price: string;
  delta: string;
  signal: string;
  note: string;
  profileCue: Record<ProfileKey, string>;
}

const rangeOptions: RangeKey[] = ['1D', '1W', '1M', '1Y'];
const profileOptions: ProfileKey[] = ['안정형', '균형형', '공격형'];

const rangeSnapshots: Record<RangeKey, RangeSnapshot> = {
  '1D': {
    label: '오늘 흐름',
    totalValue: '₩248,320,000',
    delta: '+₩3,420,000 · +1.39%',
    deltaTone: 'positive',
    cash: '₩18,900,000',
    rebalanceCue: '장 마감 전 현금 5%만 추가 진입',
    focusLabel: '단기 모멘텀 집중',
  },
  '1W': {
    label: '최근 1주',
    totalValue: '₩251,870,000',
    delta: '+₩6,910,000 · +2.82%',
    deltaTone: 'positive',
    cash: '₩16,300,000',
    rebalanceCue: '알트 비중 2% 축소 검토',
    focusLabel: '이벤트 드리븐 대응',
  },
  '1M': {
    label: '최근 1개월',
    totalValue: '₩259,480,000',
    delta: '+₩18,640,000 · +7.74%',
    deltaTone: 'positive',
    cash: '₩13,100,000',
    rebalanceCue: '코어 자산 유지, 성장주 익절 구간 탐색',
    focusLabel: '코어 포지션 유지',
  },
  '1Y': {
    label: '최근 1년',
    totalValue: '₩312,900,000',
    delta: '+₩84,300,000 · +36.89%',
    deltaTone: 'positive',
    cash: '₩11,800,000',
    rebalanceCue: '성과 우수 자산 일부 차익실현',
    focusLabel: '장기 복리 성과',
  },
};

const holdings: Holding[] = [
  {
    id: 'btc',
    name: '비트코인',
    symbol: 'BTC',
    value: '₩92,480,000',
    amount: '0.842 BTC',
    allocation: 38,
    delta: '+2.8%',
    thesis: 'ETF 자금 유입과 온체인 수급 회복이 동시에 유지되는 구간입니다.',
    riskLabel: '변동성 상단 경계',
    profileCue: {
      안정형: '현금 비중을 2% 남기고 상승 추세만 추종합니다.',
      균형형: '코어 비중 유지 후 84M 위에서만 추매합니다.',
      공격형: '저항 돌파 시 단기 알트 로테이션의 기준 자산으로 봅니다.',
    },
    trend: {
      '1D': [18, 22, 21, 27, 25, 31, 34],
      '1W': [22, 24, 29, 31, 30, 36, 38],
      '1M': [16, 22, 25, 33, 31, 39, 44],
      '1Y': [8, 12, 18, 24, 28, 36, 47],
    },
  },
  {
    id: 'sol',
    name: '솔라나',
    symbol: 'SOL',
    value: '₩46,220,000',
    amount: '188.4 SOL',
    allocation: 18,
    delta: '+5.4%',
    thesis: '체인 활동성과 디앱 사용량이 높아져 공격형 비중 확대 후보입니다.',
    riskLabel: '고변동 성장 섹터',
    profileCue: {
      안정형: '비중 동결, 15% 이상 조정 시에만 분할 매수합니다.',
      균형형: '추세 유지 시 20% 한도로만 확대합니다.',
      공격형: '강세 구간에서는 모멘텀 선도 자산으로 적극 운용합니다.',
    },
    trend: {
      '1D': [14, 18, 17, 26, 24, 30, 36],
      '1W': [10, 14, 21, 20, 25, 30, 34],
      '1M': [7, 11, 15, 24, 28, 31, 39],
      '1Y': [4, 7, 11, 18, 25, 34, 42],
    },
  },
  {
    id: 'nvda',
    name: '엔비디아',
    symbol: 'NVDA',
    value: '₩39,760,000',
    amount: '34 주',
    allocation: 16,
    delta: '+1.2%',
    thesis: 'AI 인프라 수요가 지속되는 동안 성장주 포지션의 방아쇠 역할을 합니다.',
    riskLabel: '실적 이벤트 민감',
    profileCue: {
      안정형: '실적 전후 변동성 구간에서 비중을 잠시 줄입니다.',
      균형형: '중립 유지, 콜 스프레드 대체 전략에 적합합니다.',
      공격형: '신고가 돌파 시 레버리지 대체 자산으로 활용합니다.',
    },
    trend: {
      '1D': [19, 20, 22, 24, 23, 26, 27],
      '1W': [15, 18, 20, 24, 27, 29, 31],
      '1M': [13, 16, 21, 24, 26, 30, 33],
      '1Y': [9, 12, 17, 21, 28, 36, 41],
    },
  },
  {
    id: 'cash',
    name: '대기 자금',
    symbol: 'KRW',
    value: '₩13,100,000',
    amount: '현금성 자산',
    allocation: 8,
    delta: '0.0%',
    thesis: '조정 구간 재진입과 이벤트 대응을 위한 완충 자금입니다.',
    riskLabel: '방어 포지션',
    profileCue: {
      안정형: '비중을 유지해 변동성 구간의 체력으로 사용합니다.',
      균형형: '급락 시 코어 자산 추가 매수 재원으로 씁니다.',
      공격형: '상승 확신 구간에서 빠르게 위험 자산으로 이동합니다.',
    },
    trend: {
      '1D': [22, 22, 22, 22, 22, 22, 22],
      '1W': [22, 22, 22, 22, 22, 22, 22],
      '1M': [22, 22, 22, 22, 22, 22, 22],
      '1Y': [22, 22, 22, 22, 22, 22, 22],
    },
  },
];

const watchItems: WatchItem[] = [
  {
    id: 'sk-hynix',
    name: 'SK하이닉스',
    ticker: '000660',
    market: 'KRX',
    price: '₩208,500',
    delta: '+3.1%',
    signal: '실적 모멘텀',
    note: '메모리 업사이클과 HBM 수요가 겹치는 구간입니다.',
    profileCue: {
      안정형: '분할 관찰만 유지하고 확정 돌파 후 반응합니다.',
      균형형: '주도 섹터 대체 포지션으로 편입 후보입니다.',
      공격형: '실적 시즌 전 단기 트레이딩 우선 후보입니다.',
    },
  },
  {
    id: 'tesla',
    name: 'Tesla',
    ticker: 'TSLA',
    market: 'NASDAQ',
    price: '$228.40',
    delta: '-1.4%',
    signal: '낙폭 반등 관찰',
    note: '거래량이 붙는 반등 초입인지 확인이 필요한 구간입니다.',
    profileCue: {
      안정형: '아직은 관찰만 유지합니다.',
      균형형: '저항 회복 시 소규모 시딩이 가능합니다.',
      공격형: '변동성 플레이 대상으로 가장 빠르게 반응합니다.',
    },
  },
  {
    id: 'kodex-ai',
    name: 'KODEX AI반도체',
    ticker: '483200',
    market: 'KRX ETF',
    price: '₩14,920',
    delta: '+0.9%',
    signal: '테마 압축',
    note: '국내 반도체 모멘텀을 한 번에 담는 보조 카드입니다.',
    profileCue: {
      안정형: '직접 종목 대신 ETF 노출로 리스크를 낮춥니다.',
      균형형: '기존 반도체 개별주 대비 완충재 역할을 합니다.',
      공격형: '테마 회전이 빠른 날 단기 보조 포지션으로 적합합니다.',
    },
  },
];

const buildChartPolyline = (points: number[]) => {
  const width = 340;
  const height = 168;
  const padding = 14;
  const max = Math.max(...points);
  const min = Math.min(...points);
  const safeRange = max - min || 1;

  return points
    .map((point, index) => {
      const x = padding + (index * (width - padding * 2)) / (points.length - 1);
      const normalized = (point - min) / safeRange;
      const y = height - padding - normalized * (height - padding * 2);

      return `${x},${y}`;
    })
    .join(' ');
};

export const usePortfolioExperience = () => {
  const member = useAuthStore((state) => state.member);

  const [selectedRange, setSelectedRange] = useState<RangeKey>('1M');
  const [selectedProfile, setSelectedProfile] = useState<ProfileKey>('균형형');
  const [selectedHoldingId, setSelectedHoldingId] = useState(holdings[0].id);
  const [selectedWatchId, setSelectedWatchId] = useState(watchItems[0].id);

  const selectedSnapshot = rangeSnapshots[selectedRange];
  const selectedHolding =
    holdings.find((item) => item.id === selectedHoldingId) ?? holdings[0];
  const selectedWatch =
    watchItems.find((item) => item.id === selectedWatchId) ?? watchItems[0];
  const chartPolyline = buildChartPolyline(selectedHolding.trend[selectedRange]);

  return {
    viewer: member,
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
  };
};
