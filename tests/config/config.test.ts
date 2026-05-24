import { describe, it, expect } from 'vitest';
import { loadConfig } from '../../src/config';

describe('config loader', () => {
  it('applies safe defaults when env is empty', () => {
    const cfg = loadConfig({});
    expect(cfg.NODE_ENV).toBe('development');
    expect(cfg.PORT).toBe(3000);
    expect(cfg.BODY_SIZE_LIMIT).toBe('4mb');
    expect(cfg.LOG_LEVEL).toBe('info');
  });

  it('coerces PORT from a string', () => {
    expect(loadConfig({ PORT: '8080' }).PORT).toBe(8080);
  });

  it('rejects a non-numeric PORT', () => {
    expect(() => loadConfig({ PORT: 'nope' })).toThrow();
  });

  it('rejects an unknown NODE_ENV', () => {
    expect(() => loadConfig({ NODE_ENV: 'staging' })).toThrow();
  });

  it('applies safe defaults for datastore URLs', () => {
    const cfg = loadConfig({});
    expect(cfg.MONGO_URI).toBe('mongodb://localhost:27017/securellm');
    expect(cfg.REDIS_URL).toBe('redis://localhost:6379');
  });

  it('accepts explicit datastore URLs', () => {
    const cfg = loadConfig({
      MONGO_URI: 'mongodb://mongo:27017/securellm',
      REDIS_URL: 'redis://redis:6379',
    });
    expect(cfg.MONGO_URI).toBe('mongodb://mongo:27017/securellm');
    expect(cfg.REDIS_URL).toBe('redis://redis:6379');
  });
});
