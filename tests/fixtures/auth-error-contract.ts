import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDir = dirname(fileURLToPath(import.meta.url));
const candidateFiles = [
  resolve(currentDir, '../../docs/contracts/auth-error-standardization.json'),
  resolve(currentDir, '../../../docs/contracts/auth-error-standardization.json'),
];
const file = candidateFiles.find((candidate) => existsSync(candidate));

if (!file) {
  throw new Error(
    `Missing auth error contract. Checked: ${candidateFiles.join(', ')}`,
  );
}

export interface AuthErrorContractCase {
  codes: string[];
  semantic: string;
  recoveryAction: string;
  message: string;
}

export interface AuthErrorContract {
  supportReferenceLabel: string;
  cases: AuthErrorContractCase[];
  unknownFallback: {
    semantic: string;
    recoveryAction: string;
    message: string;
  };
}

export const authErrorContract = JSON.parse(
  readFileSync(file, 'utf8'),
) as AuthErrorContract;
