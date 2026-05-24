import { describe, it, expect } from 'vitest';
import { pseudonymize } from '../../src/crypto/pseudonym';

const SECRET = 'test-secret-32-chars-long-enough!!';

describe('pseudonymize', () => {
  it('returns a hex string', () => {
    const result = pseudonymize('ak_live_abc', SECRET);
    expect(result).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic: same inputs produce same output', () => {
    expect(pseudonymize('ak_live_abc', SECRET)).toBe(pseudonymize('ak_live_abc', SECRET));
  });

  it('is sensitive to the key ID: different inputs produce different outputs', () => {
    expect(pseudonymize('ak_live_abc', SECRET)).not.toBe(pseudonymize('ak_live_xyz', SECRET));
  });

  it('is sensitive to the secret: same ID with different secret produces different output', () => {
    expect(pseudonymize('ak_live_abc', SECRET)).not.toBe(
      pseudonymize('ak_live_abc', 'different-secret-32-chars-enough!!'),
    );
  });
});
