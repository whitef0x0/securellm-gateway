import { describe, it, expect } from 'vitest';
import { loadConfig } from '../../src/config';

// Minimum valid env: only the fields that have no defaults
const minEnv = {
  LOG_PSEUDONYM_SECRET: 'a'.repeat(32),
  PII_ENCRYPTION_KEY: Buffer.alloc(32).toString('base64'),
};

describe('config loader', () => {
  it('applies safe defaults when only required secrets are supplied', () => {
    const cfg = loadConfig(minEnv);
    expect(cfg.NODE_ENV).toBe('development');
    expect(cfg.PORT).toBe(3000);
    expect(cfg.BODY_SIZE_LIMIT).toBe('4mb');
    expect(cfg.LOG_LEVEL).toBe('info');
    expect(cfg.MONGO_URI).toBe('mongodb://localhost:27017/securellm');
    expect(cfg.REDIS_URL).toBe('redis://localhost:6379');
    expect(cfg.AUDIT_LOG_TTL_DAYS).toBe(90);
    expect(cfg.PII_VAULT_TTL_DAYS).toBe(30);
  });

  it('coerces PORT from a string', () => {
    expect(loadConfig({ ...minEnv, PORT: '8080' }).PORT).toBe(8080);
  });

  it('rejects a non-numeric PORT', () => {
    expect(() => loadConfig({ ...minEnv, PORT: 'nope' })).toThrow();
  });

  it('rejects an unknown NODE_ENV', () => {
    expect(() => loadConfig({ ...minEnv, NODE_ENV: 'staging' })).toThrow();
  });

  it('rejects missing LOG_PSEUDONYM_SECRET', () => {
    expect(() => loadConfig({ PII_ENCRYPTION_KEY: minEnv.PII_ENCRYPTION_KEY })).toThrow();
  });

  it('rejects LOG_PSEUDONYM_SECRET shorter than 32 chars', () => {
    expect(() => loadConfig({ ...minEnv, LOG_PSEUDONYM_SECRET: 'tooshort' })).toThrow();
  });

  it('rejects missing PII_ENCRYPTION_KEY', () => {
    expect(() => loadConfig({ LOG_PSEUDONYM_SECRET: minEnv.LOG_PSEUDONYM_SECRET })).toThrow();
  });

  it('accepts explicit datastore URLs', () => {
    const cfg = loadConfig({
      ...minEnv,
      MONGO_URI: 'mongodb://mongo:27017/securellm',
      REDIS_URL: 'redis://redis:6379',
    });
    expect(cfg.MONGO_URI).toBe('mongodb://mongo:27017/securellm');
    expect(cfg.REDIS_URL).toBe('redis://redis:6379');
  });

  it('ANTHROPIC_API_KEY is optional (degraded mode)', () => {
    const cfg = loadConfig(minEnv);
    expect(cfg.ANTHROPIC_API_KEY).toBeUndefined();
  });
});
