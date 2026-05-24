import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { writeAudit, hashContent } from '../../src/services/auditLogger';
import { AuditLog } from '../../src/models/auditLog';
import { PiiVault } from '../../src/models/piiVault';
import { decrypt } from '../../src/crypto/fieldCrypto';
import { getConfig } from '../../src/config';

let mongod: MongoMemoryServer;

const baseParams = {
  correlationId: 'test-corr-1',
  apiKeyId: new mongoose.Types.ObjectId(),
  anonymizedKeyId: 'anon-key-hex',
  llmModel: 'claude-haiku-4-5-20251001',
  requestHash: 'abc123',
  detectedThreats: [],
  latencyMs: 42,
  status: 'allowed' as const,
};

describe('auditLogger', () => {
  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    await mongoose.connect(mongod.getUri());
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongod.stop();
  });

  beforeEach(async () => {
    await AuditLog.deleteMany({});
    await PiiVault.deleteMany({});
  });

  it('writes an AuditLog record with correct fields', async () => {
    await writeAudit(baseParams);
    const doc = await AuditLog.findOne({ correlationId: 'test-corr-1' }).lean();
    expect(doc).not.toBeNull();
    expect(doc!.status).toBe('allowed');
    expect(doc!.latencyMs).toBe(42);
    expect(doc!.anonymizedKeyId).toBe('anon-key-hex');
  });

  it('does not write PiiVault when tokenMap is empty', async () => {
    await writeAudit({ ...baseParams, tokenMap: {} });
    const count = await PiiVault.countDocuments();
    expect(count).toBe(0);
  });

  it('writes PiiVault encrypted when tokenMap is non-empty', async () => {
    const tokenMap = { '[PII:email:uuid-1]': 'user@example.com' };
    await writeAudit({ ...baseParams, correlationId: 'test-corr-2', tokenMap });
    const vault = await PiiVault.findOne({ correlationId: 'test-corr-2' });
    expect(vault).not.toBeNull();
    const plaintext = decrypt(
      { ciphertext: vault!.ciphertext, iv: vault!.iv, authTag: vault!.authTag },
      getConfig().PII_ENCRYPTION_KEY,
    );
    expect(JSON.parse(plaintext)).toEqual(tokenMap);
  });

  it('hashContent returns consistent sha256 hex', () => {
    const h = hashContent('hello');
    expect(h).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
    expect(hashContent('hello')).toBe(h);
  });
});
