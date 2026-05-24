/**
 * TRUE END-TO-END test: the brief + OWASP corpus through a real POST /v1/chat with
 * NOTHING mocked — real L3 classifier (DeBERTa), real L4 judge (Anthropic Haiku),
 * real Anthropic provider, real Mongo (in-memory) and Redis.
 *
 * Skipped by default. Requires a real key and a running local Redis. To run:
 *   ANTHROPIC_API_KEY=sk-ant-... RUN_E2E=1 npm test -- tests/integration/e2e_pipeline.test.ts
 *
 * First run downloads the L3 model (~440 MB). Each injection/benign case makes real
 * Anthropic calls (L4 judge and/or the chat completion), so the full run costs real
 * inference and takes a few minutes.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import argon2 from 'argon2';
import type Redis from 'ioredis';
import { createApp } from '../../src/app';
import { ApiKey } from '../../src/models/apiKey';
import { AuditLog } from '../../src/models/auditLog';
import { PiiVault } from '../../src/models/piiVault';
import { connectRedis, disconnectRedis } from '../../src/redis';
import { loadClassifier } from '../../src/detection/classifier';
import { getConfig } from '../../src/config';
import type { Express } from 'express';
import * as F from '../corpus/fixtures';
import type { InertFixture } from '../corpus/fixtures';

const SKIP = process.env.RUN_E2E !== '1' || !process.env.ANTHROPIC_API_KEY;

let mongod: MongoMemoryServer;
let redis: Redis;
let app: Express;
const KEY = 'ak_live_e2e.secret';

// Brief Appendix A + a couple OWASP fixtures. Every one must be blocked at input
// (400) by SOME layer (L2 regex, L3 classifier, or L4 judge) — none should reach a
// successful completion. We assert the outcome, not which layer fired.
const MUST_BLOCK: InertFixture[] = [
  F.BRIEF_INJ_A1, F.BRIEF_INJ_A2, F.BRIEF_INJ_A3,
  F.BRIEF_INJ_B1, F.BRIEF_INJ_B2, F.BRIEF_INJ_B3,
  F.BRIEF_INJ_C1, F.BRIEF_INJ_C2, F.BRIEF_INJ_C3,
  F.BRIEF_INJ_E1, F.BRIEF_INJ_E2, F.BRIEF_INJ_E3,
  F.LLM02_CREDENTIALS, F.LLM07_INTERNAL_AUDITOR,
];

const MUST_PASS: InertFixture[] = [F.BENIGN_1, F.BENIGN_2, F.BENIGN_3];

// PII fixtures must be forwarded to the model with spans redacted, recoverable only
// via the audit path (PiiVault). Raw PII must never reach the provider.
const PII_FIXTURES: { fixture: InertFixture; rawPii: string[] }[] = [
  { fixture: F.BRIEF_PII_D1, rawPii: ['yossi.cohen@example.com', '+972-50-555-0142'] },
  {
    fixture: F.BRIEF_PII_D2,
    rawPii: ['shira+work@example.co.il', 'shaul.barak@example.com', '03-555-0184'],
  },
  { fixture: F.BRIEF_PII_D3, rawPii: ['a.test@example.com', '+1-202-555-0143'] },
];

describe.skipIf(SKIP)('E2E: brief/OWASP corpus vs real POST /v1/chat (no mocks)', () => {
  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    await mongoose.connect(mongod.getUri());
    redis = await connectRedis(getConfig().REDIS_URL);
    await loadClassifier(getConfig().L3_CLASSIFIER_MODEL, getConfig().MODEL_CACHE_DIR);

    const keyHash = await argon2.hash('secret', { type: argon2.argon2id });
    await ApiKey.create({
      keyIdPrefix: 'ak_live_e2e',
      keyHash,
      role: 'client',
      scopes: [],
      active: true,
    });
    app = createApp(redis);
  }, 300_000);

  afterAll(async () => {
    await mongoose.disconnect();
    await mongod.stop();
    await disconnectRedis(redis);
  });

  it.each(MUST_BLOCK.map((f) => [f.label, f] as const))(
    '%s → blocked (400 or 503), audit recorded, no successful completion',
    async (_label, f) => {
      const res = await request(app)
        .post('/v1/chat')
        .set('x-api-key', KEY)
        .send({ model: 'claude-haiku-4-5-20251001', messages: [{ role: 'user', content: f.input }] });

      expect([400, 503], `${f.label} got ${res.status}`).toContain(res.status);
      expect(res.body.content, `${f.label} leaked content`).toBeUndefined();

      const audit = await AuditLog.findOne({ correlationId: res.body.correlationId }).lean();
      expect(audit, `${f.label} missing audit`).not.toBeNull();
      expect(audit!.status).not.toBe('allowed');
    },
    60_000,
  );

  it.each(MUST_PASS.map((f) => [f.label, f] as const))(
    '%s → 200 with a real model completion',
    async (_label, f) => {
      const res = await request(app)
        .post('/v1/chat')
        .set('x-api-key', KEY)
        .send({ model: 'claude-haiku-4-5-20251001', messages: [{ role: 'user', content: f.input }] });

      expect(res.status, `${f.label} got ${res.status}`).toBe(200);
      expect(typeof res.body.content).toBe('string');
      expect(res.body.content.length).toBeGreaterThan(0);

      const audit = await AuditLog.findOne({ correlationId: res.body.correlationId }).lean();
      expect(audit!.status).toBe('allowed');
    },
    60_000,
  );

  it.each(PII_FIXTURES.map((p) => [p.fixture.label, p] as const))(
    '%s → 200, redacted before the model, raw PII only recoverable via audit (PiiVault)',
    async (_label, { fixture, rawPii }) => {
      const res = await request(app)
        .post('/v1/chat')
        .set('x-api-key', KEY)
        .send({ model: 'claude-haiku-4-5-20251001', messages: [{ role: 'user', content: fixture.input }] });

      expect(res.status, `${fixture.label} got ${res.status}`).toBe(200);

      const audit = await AuditLog.findOne({ correlationId: res.body.correlationId }).lean();
      expect(audit!.status).toBe('allowed');

      // PiiVault row exists (raw PII encrypted, recoverable only via the audit reveal path).
      const vault = await PiiVault.findOne({ correlationId: res.body.correlationId }).lean();
      expect(vault, `${fixture.label} expected PiiVault row`).not.toBeNull();

      // The model's reply must not contain raw PII values from the request.
      for (const raw of rawPii) {
        expect(res.body.content, `${fixture.label} leaked ${raw} in response`).not.toContain(raw);
      }
    },
    60_000,
  );

  it('rate limits /v1/chat after the per-key window is exhausted (429 + Retry-After)', async () => {
    // Dedicated key with a tiny override so we don't burn 30 real Anthropic calls.
    const keyHash = await argon2.hash('secret', { type: argon2.argon2id });
    await ApiKey.create({
      keyIdPrefix: 'ak_live_rl_e2e',
      keyHash,
      role: 'client',
      scopes: [],
      active: true,
      rateLimitOverride: 2,
    });
    const rlKey = 'ak_live_rl_e2e.secret';
    // A benign body so the only thing that can stop the 3rd request is the rate limiter.
    const body = { model: 'claude-haiku-4-5-20251001', messages: [{ role: 'user', content: 'hi' }] };

    const r1 = await request(app).post('/v1/chat').set('x-api-key', rlKey).send(body);
    const r2 = await request(app).post('/v1/chat').set('x-api-key', rlKey).send(body);
    const r3 = await request(app).post('/v1/chat').set('x-api-key', rlKey).send(body);

    // First two are within the limit (200 if benign passed, or a detection code — either
    // way NOT 429). The third must be rejected by the rate limiter.
    expect(r1.status).not.toBe(429);
    expect(r2.status).not.toBe(429);
    expect(r3.status).toBe(429);
    expect(r3.headers['retry-after']).toBeTruthy();
    expect(r3.body.error).toBe('rate_limit_exceeded');
  }, 60_000);
});
