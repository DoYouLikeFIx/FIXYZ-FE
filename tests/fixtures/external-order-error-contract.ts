import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDir = dirname(fileURLToPath(import.meta.url));
const candidateFiles = [
  resolve(currentDir, '../../docs/contracts/external-order-error-ux.json'),
  resolve(currentDir, '../../../docs/contracts/external-order-error-ux.json'),
];
const file = candidateFiles.find((candidate) => existsSync(candidate));

if (!file) {
  throw new Error(
    `Missing external order error contract. Checked: ${candidateFiles.join(', ')}`,
  );
}

export interface ExternalOrderErrorContractCase {
  codes?: string[];
  operatorCode?: string;
  retryAfterSeconds?: number;
  reasonCategory?: string;
  semantic: string;
  recoveryAction: string;
  severity: string;
  title: string;
  message: string;
  nextStep: string;
}

export interface ExternalOrderErrorContract {
  supportReferenceLabel: string;
  reasonCategories?: Array<{
    name: string;
    codeFamilies: string[];
    badgeLabel: string;
    guidanceTone: string;
    defaultNextAction: string;
    description: string;
  }>;
  cases: ExternalOrderErrorContractCase[];
  unknownFallback: Omit<ExternalOrderErrorContractCase, 'codes'>;
}

export const externalOrderErrorContract = JSON.parse(
  readFileSync(file, 'utf8'),
) as ExternalOrderErrorContract;
