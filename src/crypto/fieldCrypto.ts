import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGO = 'aes-256-gcm';
const IV_BYTES = 12; // 96-bit nonce recommended for GCM

export interface EncryptedField {
  ciphertext: Buffer;
  iv: Buffer;
  authTag: Buffer;
}

export function encrypt(plaintext: string, keyBase64: string): EncryptedField {
  const key = Buffer.from(keyBase64, 'base64');
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return { ciphertext, iv, authTag };
}

export function decrypt(field: EncryptedField, keyBase64: string): string {
  const key = Buffer.from(keyBase64, 'base64');
  const decipher = createDecipheriv(ALGO, key, field.iv);
  decipher.setAuthTag(field.authTag);
  return decipher.update(field.ciphertext) + decipher.final('utf8');
}
