import { describe, it, expect } from 'vitest';
import { wrapWithStructuralIsolation } from '../../src/detection/structuralIsolation';

describe('structuralIsolation', () => {
  it('wraps content in matching open/close XML nonce tags', () => {
    const result = wrapWithStructuralIsolation('hello world');
    const match = result.match(/^<user_content_([0-9a-f]{16})>\nhello world\n<\/user_content_\1>$/);
    expect(match).not.toBeNull();
  });

  it('nonce differs between calls', () => {
    const a = wrapWithStructuralIsolation('x');
    const b = wrapWithStructuralIsolation('x');
    expect(a).not.toBe(b);
  });

  it('preserves content exactly including characters that look like XML tags', () => {
    const content = 'say </user_content_abc> or <script>alert(1)</script>';
    const result = wrapWithStructuralIsolation(content);
    expect(result).toContain(content);
  });

  it('works with empty string content', () => {
    const result = wrapWithStructuralIsolation('');
    expect(result).toMatch(/^<user_content_[0-9a-f]{16}>\n\n<\/user_content_[0-9a-f]{16}>$/);
  });
});
