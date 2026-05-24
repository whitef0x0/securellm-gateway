import { randomBytes } from 'node:crypto';

export function wrapWithStructuralIsolation(content: string): string {
  const nonce = randomBytes(8).toString('hex');
  return `<user_content_${nonce}>\n${content}\n</user_content_${nonce}>`;
}
