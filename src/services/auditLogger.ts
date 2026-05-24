import { createHash } from 'node:crypto';
import type { Types } from 'mongoose';
import { AuditLog, type DetectedThreat } from '../models/auditLog';
import { PiiVault } from '../models/piiVault';
import { encrypt } from '../crypto/fieldCrypto';
import { getConfig } from '../config';
import type { TokenMap } from '../detection/piiRedactor';

const PATTERN_SET_VERSION = '1.0.0';

export interface AuditParams {
  correlationId: string;
  apiKeyId: Types.ObjectId;
  anonymizedKeyId: string;
  llmModel?: string;
  requestHash: string;
  responseHash?: string;
  detectedThreats: DetectedThreat[];
  latencyMs: number;
  status: 'allowed' | 'blocked' | 'error';
  errorCode?: string;
  tokenMap?: TokenMap;
}

export function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

export async function writeAudit(params: AuditParams): Promise<void> {
  const { tokenMap, ...rest } = params;

  await AuditLog.create({
    ...rest,
    timestamp: new Date(),
    patternSetVersion: PATTERN_SET_VERSION,
  });

  if (tokenMap && Object.keys(tokenMap).length > 0) {
    const { PII_ENCRYPTION_KEY } = getConfig();
    const { ciphertext, iv, authTag } = encrypt(JSON.stringify(tokenMap), PII_ENCRYPTION_KEY);
    await PiiVault.create({ correlationId: params.correlationId, ciphertext, iv, authTag });
  }
}
