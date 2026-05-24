import { describe, it, expect } from 'vitest';
import { encrypt, decrypt } from '../../src/crypto/fieldCrypto';

// 32-byte key, base64-encoded
const KEY = Buffer.alloc(32, 0x42).toString('base64');

describe('fieldCrypto', () => {
  it('roundtrip: decrypt(encrypt(x)) === x', () => {
    const plaintext = JSON.stringify({ email: '[REDACTED]', token: 'tok_1' });
    const { ciphertext, iv, authTag } = encrypt(plaintext, KEY);
    expect(decrypt({ ciphertext, iv, authTag }, KEY)).toBe(plaintext);
  });

  it('uses a fresh random iv on each call', () => {
    const a = encrypt('test', KEY);
    const b = encrypt('test', KEY);
    expect(a.iv.equals(b.iv)).toBe(false);
  });

  it('ciphertext differs from plaintext', () => {
    const { ciphertext } = encrypt('hello', KEY);
    expect(ciphertext.toString()).not.toBe('hello');
  });

  it('throws when authTag is tampered', () => {
    const { ciphertext, iv, authTag } = encrypt('secret', KEY);
    authTag[0] ^= 0xff; // flip bits in auth tag
    expect(() => decrypt({ ciphertext, iv, authTag }, KEY)).toThrow();
  });
});
