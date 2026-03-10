import {
  buildExternalOrderRequest,
  hasExternalOrderAccountId,
  resolveExternalOrderAccountId,
} from '@/order/external-order-recovery';

describe('external order recovery account id handling', () => {
  it('accepts canonical numeric order account ids', () => {
    expect(resolveExternalOrderAccountId('1')).toBe(1);
    expect(hasExternalOrderAccountId('1001')).toBe(true);
  });

  it('rejects non-numeric account ids instead of stripping trailing digits', () => {
    expect(resolveExternalOrderAccountId('ACC-001')).toBeNull();
    expect(resolveExternalOrderAccountId('BROKER-1')).toBeNull();
    expect(hasExternalOrderAccountId('ACC-001')).toBe(false);
  });

  it('does not build an external order request without a canonical order account id', () => {
    expect(
      buildExternalOrderRequest({
        accountId: 'ACC-001',
        presetId: 'krx-buy-1',
      }),
    ).toBeNull();
  });
});
