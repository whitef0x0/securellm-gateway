import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import argon2 from 'argon2';
import type Redis from 'ioredis';
import { createApp } from '../../src/app';
import { ApiKey } from '../../src/models/apiKey';
import { AuditLog } from '../../src/models/auditLog';
import { PiiVault } from '../../src/models/piiVault';
import { encrypt } from '../../src/crypto/fieldCrypto';
import { getConfig } from '../../src/config';
import { connectRedis, disconnectRedis } from '../../src/redis';

const HASH_OPTS = { memoryCost: 1024, timeCost: 1, parallelism: 1 };

let mongod: MongoMemoryServer;
let redis: Redis;
let adminKey: string;
let adminNoScopeKey: string;
let clientKey: string;

async function makeKey(prefix: string, role: 'client' | 'admin', scopes: string[]) {
  const keyHash = await argon2.hash('secret', { type: argon2.argon2id, ...HASH_OPTS });
  await ApiKey.create({ keyIdPrefix: prefix, keyHash, role, scopes, active: true });
  return `${prefix}.secret`;
}

describe('GET /v1/audit', () => {
  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    await mongoose.connect(mongod.getUri());
    redis = await connectRedis('redis://localhost:6379');
    adminKey = await makeKey('ak_admin_aud1', 'admin', ['pii:reveal']);
    adminNoScopeKey = await makeKey('ak_admin_aud2', 'admin', []);
    clientKey = await makeKey('ak_live_aud3', 'client', []);
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongod.stop();
    await disconnectRedis(redis);
  });

  beforeEach(async () => {
    await AuditLog.deleteMany({});
    await PiiVault.deleteMany({});
    await redis.flushdb();
  });

  async function seedAudit(correlationId: string, status: 'allowed' | 'blocked', when: Date) {
    await AuditLog.create({
      correlationId,
      timestamp: when,
      apiKeyId: new mongoose.Types.ObjectId(),
      anonymizedKeyId: 'anon',
      requestHash: 'h',
      detectedThreats: [],
      patternSetVersion: '1.0.0',
      latencyMs: 1,
      status,
    });
  }

  it('client role is forbidden (403)', async () => {
    const app = createApp(redis);
    const res = await request(app).get('/v1/audit').set('x-api-key', clientKey);
    expect(res.status).toBe(403);
  });

  it('admin gets audit metadata, newest first, no raw PII fields', async () => {
    await seedAudit('c-old', 'allowed', new Date('2026-01-01'));
    await seedAudit('c-new', 'blocked', new Date('2026-02-01'));
    const app = createApp(redis);
    const res = await request(app).get('/v1/audit').set('x-api-key', adminKey);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data[0].correlationId).toBe('c-new'); // newest first
    expect(res.body.data).toHaveLength(2);
    // never expose vault/ciphertext-like fields
    expect(JSON.stringify(res.body)).not.toMatch(/ciphertext|authTag/);
  });

  it('honors since= and caps limit at 500', async () => {
    await seedAudit('c-old', 'allowed', new Date('2026-01-01'));
    await seedAudit('c-new', 'allowed', new Date('2026-03-01'));
    const app = createApp(redis);
    const res = await request(app)
      .get('/v1/audit?since=2026-02-01T00:00:00.000Z&limit=9999')
      .set('x-api-key', adminKey);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].correlationId).toBe('c-new');
  });

  it('reveal without pii:reveal scope is forbidden (403)', async () => {
    const app = createApp(redis);
    const res = await request(app)
      .get('/v1/audit?reveal=c-1')
      .set('x-api-key', adminNoScopeKey);
    expect(res.status).toBe(403);
  });

  it('reveal returns the decrypted token map and writes a second audit event', async () => {
    const tokenMap = { '[PII:email:uuid-1]': 'dana@example.com' };
    const { ciphertext, iv, authTag } = encrypt(JSON.stringify(tokenMap), getConfig().PII_ENCRYPTION_KEY);
    await PiiVault.create({ correlationId: 'c-pii', ciphertext, iv, authTag });
    await seedAudit('c-pii', 'allowed', new Date());

    const app = createApp(redis);
    const res = await request(app).get('/v1/audit?reveal=c-pii').set('x-api-key', adminKey);
    expect(res.status).toBe(200);
    expect(res.body.correlationId).toBe('c-pii');
    expect(res.body.tokenMap).toEqual(tokenMap);

    // A second audit event recording the reveal must exist (self-auditing).
    const revealEvents = await AuditLog.find({
      'detectedThreats.rule': 'PII_REVEAL',
    }).lean();
    expect(revealEvents.length).toBe(1);
  });

  it('reveal for an unknown correlationId returns 404', async () => {
    const app = createApp(redis);
    const res = await request(app).get('/v1/audit?reveal=nope').set('x-api-key', adminKey);
    expect(res.status).toBe(404);
  });
});
