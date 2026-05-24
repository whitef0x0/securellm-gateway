import { describe, it, expect } from 'vitest';
import { redactPii, rehydratePii } from '../../src/detection/piiRedactor';

const TOKEN_RE = /\[PII:(email|phone|israeli_id):[0-9a-f-]{36}\]/g;

describe('PII redactor', () => {
  it('redacts email addresses', () => {
    const { text, tokenMap } = redactPii('Contact me at alice@example.com today.');
    expect(text).not.toContain('alice@example.com');
    expect(TOKEN_RE.test(text)).toBe(true);
    expect(Object.values(tokenMap)).toContain('alice@example.com');
  });

  it('redacts Israeli local mobile (05X-XXXXXXX)', () => {
    const { text, tokenMap } = redactPii('Call 050-1234567 please.');
    expect(text).not.toContain('050-1234567');
    expect(Object.values(tokenMap)).toContain('050-1234567');
  });

  it('redacts Israeli +972 mobile', () => {
    const { text, tokenMap } = redactPii('My number is +972-52-999-8888.');
    expect(text).not.toContain('+972-52-999-8888');
    expect(Object.values(tokenMap).some((v) => v.includes('+972'))).toBe(true);
  });

  it('redacts international E.164-like phone', () => {
    const { text, tokenMap } = redactPii('Reach me at +1-800-555-0199.');
    expect(text).not.toContain('+1-800-555-0199');
    expect(Object.values(tokenMap).some((v) => v.includes('+1'))).toBe(true);
  });

  it('redacts Israeli national ID by Teudat Zehut checksum', () => {
    // 039337423 passes the Israeli ID Luhn check
    const { text, tokenMap } = redactPii('ID: 039337423');
    expect(text).not.toContain('039337423');
    expect(Object.values(tokenMap)).toContain('039337423');
  });

  it('redacts Israeli national ID by context cue (ת.ז)', () => {
    const { text, tokenMap } = redactPii('ת.ז 123456780');
    expect(text).not.toContain('123456780');
    expect(Object.values(tokenMap)).toContain('123456780');
  });

  it('does not redact 9-digit number adjacent to math operator', () => {
    // 123456782 is a valid IL Teudat Zehut checksum but not a valid IL phone prefix,
    // so the only thing that could redact it is the ID detector — which we expect
    // to skip due to the math-adjacent guard.
    const { text } = redactPii('Result = 123456782 + 1');
    expect(text).toContain('123456782');
  });

  it('handles multiple PII types in one string', () => {
    const input = 'Email: bob@test.org, phone: 054-3333333, ID: 039337423';
    const { text, tokenMap } = redactPii(input);
    expect(text).not.toContain('bob@test.org');
    expect(text).not.toContain('054-3333333');
    expect(text).not.toContain('039337423');
    expect(Object.keys(tokenMap).length).toBe(3);
  });

  it('redacts PII inside JSON field values', () => {
    const input = JSON.stringify({ user: 'charlie@corp.io', note: 'call 050-7777777' });
    const { text } = redactPii(input);
    expect(text).not.toContain('charlie@corp.io');
    expect(text).not.toContain('050-7777777');
  });

  it('rehydrates redacted tokens back to original values', () => {
    const original = 'Send to dana@example.com';
    const { text, tokenMap } = redactPii(original);
    expect(rehydratePii(text, tokenMap)).toBe(original);
  });

  it('leaves unknown forged tokens unchanged on rehydration', () => {
    const fake = 'hi [PII:email:00000000-0000-0000-0000-000000000000] there';
    expect(rehydratePii(fake, {})).toBe(fake);
  });
});
