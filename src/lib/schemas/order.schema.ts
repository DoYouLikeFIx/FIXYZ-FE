import { z } from 'zod';
import {
  isSupportedExternalOrderSymbol,
  normalizeExternalOrderSymbol,
  parseExternalOrderQuantity,
} from '@/order/external-order-recovery';

const externalOrderSymbolSchema = z.string()
  .min(1, '종목코드를 입력해 주세요.')
  .regex(/^\d{6}$/, '종목코드는 숫자 6자리여야 합니다.')
  .refine(isSupportedExternalOrderSymbol, '지원하지 않는 종목코드입니다.');

const externalOrderQuantitySchema = z.string()
  .trim()
  .min(1, '수량을 입력해 주세요.')
  .regex(/^\d+$/, '수량은 1 이상의 정수여야 합니다.')
  .refine(
    (value) => parseExternalOrderQuantity(value) !== null,
    '수량은 1 이상의 정수여야 합니다.',
  );

export const externalOrderDraftSchema = z.object({
  symbol: z.string()
    .transform(normalizeExternalOrderSymbol)
    .pipe(externalOrderSymbolSchema),
  quantity: externalOrderQuantitySchema,
});

export type ExternalOrderDraftFormValues = z.infer<typeof externalOrderDraftSchema>;
