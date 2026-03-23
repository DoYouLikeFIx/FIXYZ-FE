import {
  buildExternalOrderDraftSummary,
  buildExternalOrderRequest,
  hasExternalOrderAccountId,
  matchPresetIdFromDraft,
  resolveExternalOrderDraftSelection,
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
        symbol: '005930',
        quantity: '1',
        orderType: 'LIMIT',
      }),
    ).toBeNull();
  });

  it('builds a market order request when the market preset is selected', () => {
    expect(
      buildExternalOrderRequest({
        accountId: '1',
        symbol: '005930',
        quantity: '3',
        orderType: 'MARKET',
      }),
    ).toMatchObject({
      accountId: 1,
      symbol: '005930',
      side: 'BUY',
      orderType: 'MARKET',
      quantity: 3,
      price: null,
    });
  });

  it('keeps manually entered 3-share drafts on the limit path by default', () => {
    expect(matchPresetIdFromDraft({
      symbol: '005930',
      quantity: '3',
    })).toBeNull();
    expect(
      buildExternalOrderRequest({
        accountId: '1',
        symbol: '005930',
        quantity: '3',
        orderType: 'LIMIT',
      }),
    ).toMatchObject({
      orderType: 'LIMIT',
      price: 70_100,
      quantity: 3,
    });
  });

  it('uses preset-specific limit prices when the draft matches a priced preset', () => {
    expect(
      buildExternalOrderRequest({
        accountId: '1',
        symbol: '005930',
        quantity: '5',
        orderType: 'LIMIT',
      }),
    ).toMatchObject({
      orderType: 'LIMIT',
      price: 70_300,
      quantity: 5,
    });
  });

  it('does not relabel restored 3-share limit drafts as market orders', () => {
    expect(matchPresetIdFromDraft({
      symbol: '005930',
      quantity: '3',
    }, {
      orderType: 'LIMIT',
    })).toBeNull();
    expect(
      buildExternalOrderDraftSummary(
        {
          symbol: '005930',
          quantity: '3',
        },
        {
          orderType: 'LIMIT',
        },
      ),
    ).toBe('005930 · 삼성전자 · 3주');
  });

  it('drops edited market drafts back to the deterministic limit path', () => {
    expect(resolveExternalOrderDraftSelection({
      symbol: '005930',
      quantity: '4',
    }, 'MARKET')).toEqual({
      presetId: null,
      orderType: 'LIMIT',
    });
    expect(
      buildExternalOrderDraftSummary(
        {
          symbol: '005930',
          quantity: '4',
        },
        {
          orderType: 'LIMIT',
        },
      ),
    ).toBe('005930 · 삼성전자 · 4주');
    expect(
      buildExternalOrderRequest({
        accountId: '1',
        symbol: '005930',
        quantity: '4',
        orderType: 'MARKET',
      }),
    ).toBeNull();
  });
});
