import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import argon2 from 'argon2';
import type Redis from 'ioredis';
import { createApp } from '../../src/app';
import { ApiKey } from '../../src/models/apiKey';
import { connectRedis, disconnectRedis } from '../../src/redis';

const TEST_HASH_OPTS = { memoryCost: 1024, timeCost: 1, parallelism: 1 };

let mongod: MongoMemoryServer;
let redis: Redis;

async function createTestKey(opts: {
  prefix: string;
  secret: string;
  role: 'client' | 'admin';
  scopes?: string[];
  active?: boolean;
}) {
  const keyHash = await argon2.hash(opts.secret, { type: argon2.argon2id, ...TEST_HASH_OPTS });
  return ApiKey.create({
    keyIdPrefix: opts.prefix,
    keyHash,
    role: opts.role,
    scopes: opts.scopes ?? [],
    active: opts.active ?? true,
  });
}

describe('auth middleware + admin gate', () => {
  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    await mongoose.connect(mongod.getUri());
    redis = await connectRedis('redis://localhost:6379');
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongod.stop();
    await disconnectRedis(redis);
  });

  beforeEach(async () => {
    await ApiKey.deleteMany({});
    await redis.flushdb();
  });

  it('missing x-api-key → 401', async () => {
    const app = createApp(redis);
    const res = await request(app).get('/v1/audit');
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ error: 'unauthorized' });
    expect(res.body.correlationId).toBeTruthy();
  });

  it('malformed key (no dot) → 401', async () => {
    const app = createApp(redis);
    const res = await request(app).get('/v1/audit').set('x-api-key', 'nodothere');
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ error: 'unauthorized' });
  });

  it('unknown prefix → 401 (no DB lookup)', async () => {
    const app = createApp(redis);
    const res = await request(app).get('/v1/audit').set('x-api-key', 'bad_prefix_abc.secret');
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ error: 'unauthorized' });
  });

  it('unknown key ID → 401', async () => {
    const app = createApp(redis);
    const res = await request(app).get('/v1/audit').set('x-api-key', 'ak_live_unknown.secret');
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ error: 'unauthorized' });
  });

  it('wrong secret → 401', async () => {
    const app = createApp(redis);
    await createTestKey({ prefix: 'ak_live_t01', secret: 'correctsecret', role: 'client' });
    const res = await request(app).get('/v1/audit').set('x-api-key', 'ak_live_t01.wrongsecret');
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ error: 'unauthorized' });
  });

  it('inactive key → 401', async () => {
    const app = createApp(redis);
    await createTestKey({ prefix: 'ak_live_t02', secret: 'mysecret', role: 'client', active: false });
    const res = await request(app).get('/v1/audit').set('x-api-key', 'ak_live_t02.mysecret');
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ error: 'unauthorized' });
  });

  it('valid client key on admin route → 403', async () => {
    const app = createApp(redis);
    await createTestKey({ prefix: 'ak_live_t03', secret: 'clientsec', role: 'client' });
    const res = await request(app).get('/v1/audit').set('x-api-key', 'ak_live_t03.clientsec');
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ error: 'forbidden' });
  });

  it('valid admin key can call /v1/audit → 200', async () => {
    const app = createApp(redis);
    await createTestKey({ prefix: 'ak_admin_t04', secret: 'adminsec', role: 'admin' });
    const res = await request(app).get('/v1/audit').set('x-api-key', 'ak_admin_t04.adminsec');
    expect(res.status).toBe(200);
  });

  it('admin without pii:reveal cannot reveal → 403', async () => {
    const app = createApp(redis);
    await createTestKey({ prefix: 'ak_admin_t05', secret: 'adminsec', role: 'admin', scopes: [] });
    const res = await request(app)
      .get('/v1/audit?reveal=someid')
      .set('x-api-key', 'ak_admin_t05.adminsec');
    expect(res.status).toBe(403);
  });

  it('admin with pii:reveal passes the scope gate (404 for unknown id, not 403)', async () => {
    const app = createApp(redis);
    await createTestKey({
      prefix: 'ak_admin_t06',
      secret: 'adminsec',
      role: 'admin',
      scopes: ['pii:reveal'],
    });
    const res = await request(app)
      .get('/v1/audit?reveal=someid')
      .set('x-api-key', 'ak_admin_t06.adminsec');
    // Authorized through the scope gate; the record doesn't exist so the route 404s.
    // (Full reveal-with-data behavior is covered in tests/audit/auditRoute.test.ts.)
    expect(res.status).toBe(404);
  });
});
