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
});
