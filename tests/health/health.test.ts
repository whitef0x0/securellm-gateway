import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import type Redis from 'ioredis';
import { createApp } from '../../src/app';
import { connectRedis, disconnectRedis } from '../../src/redis';

let mongod: MongoMemoryServer;
let redis: Redis;

describe('health + liveness endpoints', () => {
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

  it('GET /livez returns 200 and alive status', async () => {
    const app = createApp(redis);
    const res = await request(app).get('/livez');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'alive' });
  });

  it('GET /healthz returns 200 with status field only (no component internals)', async () => {
    const app = createApp(redis);
    const res = await request(app).get('/healthz');
    expect(res.status).toBe(200);
    // status is either 'healthy' (key configured) or 'degraded' (no Anthropic key);
    // tests run without a real ANTHROPIC_API_KEY so we expect degraded here. Either
    // way is a 200 and only the status field is exposed.
    expect(res.body.status).toMatch(/^(healthy|degraded)$/);
    expect(Object.keys(res.body)).toEqual(['status']);
  });

  it('GET /healthz returns 503 unhealthy when redis dependency is missing', async () => {
    const app = createApp(); // no redis passed → datastore dep unavailable
    const res = await request(app).get('/healthz');
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ status: 'unhealthy' });
  });

  it('HEAD /healthz returns 200 with no body', async () => {
    const app = createApp(redis);
    const res = await request(app).head('/healthz');
    expect(res.status).toBe(200);
  });

  it('attaches an X-Request-Id correlation header', async () => {
    const app = createApp(redis);
    const res = await request(app).get('/livez');
    expect(res.headers['x-request-id']).toBeTruthy();
  });
});
