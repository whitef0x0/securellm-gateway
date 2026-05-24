import { createHmac } from 'node:crypto';

export function pseudonymize(keyId: string, secret: string): string {
  return createHmac('sha256', secret).update(keyId).digest('hex');
}
