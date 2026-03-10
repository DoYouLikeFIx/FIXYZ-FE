import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDir = dirname(fileURLToPath(import.meta.url));
const file = resolve(currentDir, '../../../docs/contracts/external-order-error-ux.json');

export interface ExternalOrderErrorContractCase {
  codes?: string[];
  operatorCode?: string;
  retryAfterSeconds?: number;
  semantic: string;
  recoveryAction: string;
  severity: string;
  title: string;
  message: string;
  nextStep: string;
}

export interface ExternalOrderErrorContract {
  supportReferenceLabel: string;
  cases: ExternalOrderErrorContractCase[];
  unknownFallback: Omit<ExternalOrderErrorContractCase, 'codes'>;
}

export const externalOrderErrorContract = JSON.parse(
  readFileSync(file, 'utf8'),
) as ExternalOrderErrorContract;
