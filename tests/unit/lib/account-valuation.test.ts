import {
  resolveValuationGuidance,
  resolveValuationStatus,
  resolveValuationStatusLabel,
} from '@/lib/account-valuation';

describe('account valuation helpers', () => {
  it('prefers the explicit backend valuation status over local heuristics', () => {
    expect(resolveValuationStatus({
      marketPrice: 70_100,
      quoteAsOf: '2026-03-24T09:00:00Z',
      quoteSourceMode: 'LIVE',
      valuationStatus: 'STALE',
    })).toBe('STALE');
  });

  it('does not infer freshness when the backend omits valuation status', () => {
    expect(resolveValuationStatus({
      marketPrice: 70_100,
      quoteAsOf: '2026-03-24T09:00:00Z',
      quoteSourceMode: 'LIVE',
    })).toBeNull();
    expect(resolveValuationStatus({
      quoteSnapshotId: 'quote-001',
      quoteAsOf: '2026-03-24T09:00:00Z',
      quoteSourceMode: 'REPLAY',
    })).toBeNull();
  });

  it('keeps unknown status presentation neutral and maps unavailable guidance explicitly', () => {
    expect(resolveValuationStatusLabel(null)).toBe('상태 확인 필요');
    expect(resolveValuationGuidance('UNAVAILABLE', 'PROVIDER_UNAVAILABLE')).toContain(
      '시세 제공자가 응답하지 않아',
    );
  });
});
