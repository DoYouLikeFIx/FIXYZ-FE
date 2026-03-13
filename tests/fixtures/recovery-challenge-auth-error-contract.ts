import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDir = dirname(fileURLToPath(import.meta.url));
const candidateFiles = [
  resolve(currentDir, '../../docs/contracts/recovery-challenge-auth-errors.json'),
  resolve(currentDir, '../../../docs/contracts/recovery-challenge-auth-errors.json'),
];
const file = candidateFiles.find((candidate) => existsSync(candidate));

if (!file) {
  throw new Error(
    `Missing recovery challenge auth error contract. Checked: ${candidateFiles.join(', ')}`,
  );
}

export interface RecoveryChallengeAuthErrorContractCase {
  codes: string[];
  semantic: string;
  recoveryAction: string;
  message: string;
}

export interface RecoveryChallengeAuthErrorContract {
  cases: RecoveryChallengeAuthErrorContractCase[];
}

export const recoveryChallengeAuthErrorContract = JSON.parse(
  readFileSync(file, 'utf8'),
) as RecoveryChallengeAuthErrorContract;
