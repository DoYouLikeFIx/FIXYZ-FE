import { maskAccountNumber } from '@/lib/account-masking';

describe('maskAccountNumber', () => {
  it('applies the canonical mask to full account numbers', () => {
    expect(maskAccountNumber('110123456789')).toBe('110-****-6789');
  });

  it('keeps short identifiers masked instead of exposing the raw value', () => {
    expect(maskAccountNumber('1')).toBe('***-***1');
  });

  it('returns the pending copy when no account identifier is available', () => {
    expect(maskAccountNumber(undefined)).toBe('계좌 연동 대기');
  });
});
