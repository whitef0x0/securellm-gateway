import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import argon2 from 'argon2';
import type Redis from 'ioredis';
import { createApp } from '../../src/app';
import { ApiKey } from '../../src/models/apiKey';
import { connectRedis, disconnectRedis } from '../../src/redis';

const HASH_OPTS = { memoryCost: 1024, timeCost: 1, parallelism: 1 };

let mongod: MongoMemoryServer;
let redis: Redis;

async function createKey(prefix: string, rateLimitOverride?: number) {
  const keyHash = await argon2.hash('secret', { type: argon2.argon2id, ...HASH_OPTS });
  return ApiKey.create({ keyIdPrefix: prefix, keyHash, role: 'client', scopes: [], active: true, rateLimitOverride });
}

describe('rate limiter', () => {
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

  it('sets X-RateLimit-Limit and X-RateLimit-Remaining headers', async () => {
    const app = createApp(redis);
    await createKey('ak_live_rl01');
    const res = await request(app).get('/v1/audit').set('x-api-key', 'ak_live_rl01.secret');
    expect(res.headers['x-ratelimit-limit']).toBe('30');
    expect(parseInt(res.headers['x-ratelimit-remaining'])).toBe(29);
  });

  it('X-RateLimit-Remaining decrements on each request', async () => {
    const app = createApp(redis);
    await createKey('ak_live_rl02');
    const key = 'ak_live_rl02.secret';
    const r1 = await request(app).get('/v1/audit').set('x-api-key', key);
    const r2 = await request(app).get('/v1/audit').set('x-api-key', key);
    expect(parseInt(r1.headers['x-ratelimit-remaining'])).toBe(29);
    expect(parseInt(r2.headers['x-ratelimit-remaining'])).toBe(28);
  });

  it('returns 429 after exceeding per-key override limit', async () => {
    const app = createApp(redis);
    await createKey('ak_live_rl03', 2);
    const key = 'ak_live_rl03.secret';

    const r1 = await request(app).get('/v1/audit').set('x-api-key', key);
    expect(r1.status).toBe(403);
    expect(r1.headers['x-ratelimit-limit']).toBe('2');    // confirm override reached middleware
    expect(r1.headers['x-ratelimit-remaining']).toBe('1');

    const r2 = await request(app).get('/v1/audit').set('x-api-key', key);
    expect(r2.status).toBe(403);
    expect(r2.headers['x-ratelimit-remaining']).toBe('0');

    const r3 = await request(app).get('/v1/audit').set('x-api-key', key);
    expect(r3.status).toBe(429);
    expect(r3.headers['retry-after']).toBeTruthy();
    expect(r3.body).toMatchObject({ error: 'rate_limit_exceeded' });
  });

  it('sorted-set members are unique under concurrent requests', async () => {
    const app = createApp(redis);
    await createKey('ak_live_rl04', 5);
    const key = 'ak_live_rl04.secret';

    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        request(app).get('/v1/audit').set('x-api-key', key),
      ),
    );

    expect(results.every((r) => r.status !== 429)).toBe(true);

    const keys = await redis.keys('ratelimit:*');
    expect(keys.length).toBe(1);
    const count = await redis.zcard(keys[0]!);
    expect(count).toBe(5);
  });
});
